import { spawn } from 'node:child_process';
import { access, constants, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlenderScript } from './script.ts';
import { estimateRenderSeconds, normaliseScene, type ThreeDScene } from './rigs.ts';

/**
 * Blender, headless.
 *
 * Invoked with an argv array and `--factory-startup`, which ignores any add-ons
 * or startup file present on the host. A render worker that behaves differently
 * because somebody once installed a plugin is not reproducible, and
 * reproducibility is the entire reason 3D is in-house rather than a vendor call.
 */
export type BlenderResult =
  | {
      ok: true;
      frameDir: string;
      frameCount: number;
      /**
       * The frames as ffmpeg wants them: an absolute path with `%04d` where
       * the number goes, carrying the extension Blender actually wrote.
       *
       * Returned rather than left for the caller to assemble, because the
       * caller assembled it wrong: the pipeline encoded `frame_%04d.png`
       * against a directory of `.exr`, so every 3D shot rendered in full,
       * failed to encode, and logged a line nobody was reading. Minutes of
       * Cycles per shot, thrown away, and the scene fell back to typography —
       * which looks exactly like a film made by somebody who does not do 3D.
       */
      framePattern: string;
      /** Whether those frames are linear-light with an alpha channel. */
      linear: boolean;
      elapsedMs: number;
    }
  | { ok: false; error: string; elapsedMs: number };

/**
 * What Blender writes, and why it is not a PNG.
 *
 * EXR keeps the linear float values and the alpha, which is what lets a shot
 * be composited over the brand's own canvas rather than over whatever grey the
 * renderer guessed. It costs an extra conversion on the way to h264 and is
 * worth it.
 */
export const FRAME_EXTENSION = 'exr';

/**
 * Where Blender is, without anybody having to say.
 *
 * The same order ffmpeg resolves in, for the same reason: a host that ships
 * its own wins, then the copy the build downloaded, then whatever is on PATH
 * for a developer who installed it themselves. Configuration is the fallback
 * here rather than the mechanism, because a worker that needs an environment
 * variable set to do 3D is a worker that silently does no 3D the first time
 * somebody forgets.
 */
const INSTALLED = path.join(
  path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  'node_modules',
  '.blender',
  'blender',
);

/** Only the filesystem probe is remembered; the environment stays live. */
let downloaded: string | false | null = null;

export async function resolveBlender(override?: string): Promise<string> {
  if (override) return override;

  const configured = process.env.ACT_ONE_BLENDER_PATH;
  if (configured) return configured;

  if (downloaded === null) {
    try {
      await access(INSTALLED, constants.X_OK);
      downloaded = INSTALLED;
    } catch {
      // Not downloaded in this deployment; fall through to PATH.
      downloaded = false;
    }
  }

  return downloaded === false ? 'blender' : downloaded;
}

export type RenderOptions = {
  scene: unknown;
  /** Where frames land. Created if absent; caller owns cleanup. */
  outputDir?: string;
  blenderPath?: string;
  /** Hard ceiling. A runaway 3D job can consume a worker for hours. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { frame: number; total: number }) => void;
};

export async function renderThreeDScene(options: RenderOptions): Promise<BlenderResult> {
  const started = Date.now();
  const { scene, adjustments } = normaliseScene(options.scene);
  if (adjustments.length > 0) {
    console.warn('[three-d] adjusted scene:', adjustments.join(' '));
  }

  const blender = await resolveBlender(options.blenderPath);
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-3d-'));
  const outputDir = options.outputDir ?? path.join(workDir, 'frames');
  const scriptPath = path.join(workDir, 'scene.py');

  // A sanity ceiling derived from the scene itself: a request that would take
  // twenty minutes is refused rather than discovered twenty minutes later.
  const estimated = estimateRenderSeconds(scene);
  const timeoutMs = options.timeoutMs ?? Math.min(45 * 60_000, Math.max(120_000, estimated * 2500));

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      scriptPath,
      buildBlenderScript(scene, { outputPattern: path.join(outputDir, 'frame_') }),
      'utf8',
    );

    const result = await run(
      blender,
      [
        '--background',
        // Ignores host add-ons and startup files, so the render is the same
        // everywhere.
        '--factory-startup',
        '--python-exit-code',
        '1',
        // The script renders: it knows what to do when the build cannot
        // denoise, and the command line does not.
        '--python',
        scriptPath,
      ],
      { timeoutMs, ...(options.signal ? { signal: options.signal } : {}), ...(options.onProgress ? { onProgress: options.onProgress } : {}) },
    );

    if (!result.ok) {
      return { ok: false, error: result.error, elapsedMs: Date.now() - started };
    }

    const frames = (await readdir(outputDir).catch(() => [])).filter((file) =>
      file.startsWith('frame_'),
    );

    if (frames.length === 0) {
      return {
        ok: false,
        error: 'Blender exited cleanly but produced no frames.',
        elapsedMs: Date.now() - started,
      };
    }

    // Read off the frames themselves rather than assumed, so a Blender that
    // writes something else cannot silently break the encode downstream.
    const extension = path.extname(frames[0]!).replace('.', '') || FRAME_EXTENSION;
    return {
      ok: true,
      frameDir: outputDir,
      frameCount: frames.length,
      framePattern: path.join(outputDir, `frame_%04d.${extension}`),
      linear: extension === 'exr',
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message, elapsedMs: Date.now() - started };
  } finally {
    // The script is disposable; frames are not, so only the script directory
    // goes when the caller supplied its own output location.
    if (!options.outputDir) {
      // Caller gets the frames, so nothing is removed here.
    } else {
      await rm(scriptPath, { force: true }).catch(() => undefined);
    }
  }
}

function run(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal; onProgress?: RenderOptions['onProgress'] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    // No shell. These arguments carry filesystem paths derived from tenant ids.
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `Blender exceeded ${options.timeoutMs}ms and was killed.` });
    }, options.timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
      finish({ ok: false, error: 'Render cancelled.' });
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!options.onProgress) return;
      // Blender writes "Fra:12 Mem:..." per frame; it is the only progress
      // signal it offers without a Python callback.
      for (const match of chunk.toString().matchAll(/Fra:(\d+)/g)) {
        options.onProgress({ frame: Number(match[1]), total: 0 });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        error:
          error.message.includes('ENOENT')
            ? 'Blender was not found. Set ACT_ONE_BLENDER_PATH or install Blender on the render host.'
            : error.message,
      });
    });

    child.on('exit', (code) => {
      finish(code === 0 ? { ok: true } : { ok: false, error: stderr.slice(-1500) || `Blender exited ${code}` });
    });

    function finish(result: { ok: true } | { ok: false; error: string }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }
  });
}

export async function isBlenderAvailable(blenderPath?: string): Promise<boolean> {
  const command = await resolveBlender(blenderPath);
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
