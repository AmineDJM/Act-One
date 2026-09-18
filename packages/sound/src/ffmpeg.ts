import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Locating FFmpeg.
 *
 * Resolution order is explicit config, then the bundled static build, then
 * whatever is on PATH. The bundled build is there so a render host does not
 * need FFmpeg installed — a worker that silently produces silent films because
 * the binary is missing is a bad failure mode, so a missing binary is an error
 * rather than a fallback to "no audio".
 */
let cached: string | null = null;

export async function resolveFfmpeg(): Promise<string> {
  if (cached) return cached;

  const configured = process.env.ACT_ONE_FFMPEG_PATH;
  if (configured && (await isExecutable(configured))) {
    cached = configured;
    return cached;
  }

  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default?: string };
    const bundled = mod.default;
    if (bundled && (await isExecutable(bundled))) {
      cached = bundled;
      return cached;
    }
  } catch {
    // Not installed in this deployment; fall through to PATH.
  }

  if (await onPath('ffmpeg')) {
    cached = 'ffmpeg';
    return cached;
  }

  throw new Error(
    'FFmpeg was not found. Set ACT_ONE_FFMPEG_PATH, install ffmpeg-static, or put ffmpeg on PATH.',
  );
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * FFmpeg's output, kept on success as well as on failure.
 *
 * Some filters report through stderr rather than through the file they write —
 * `loudnorm` prints its measurement there, and a two-pass normalisation is
 * impossible without reading it back.
 */
export type FfmpegResult =
  | { ok: true; stderr: string }
  | { ok: false; code: number | null; stderr: string };

/**
 * Runs FFmpeg with an argv array.
 *
 * Never through a shell: these arguments carry customer project names and
 * storage paths, and shell interpolation would turn a project called
 * `"; rm -rf /` into an incident.
 */
export async function runFfmpeg(
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FfmpegResult> {
  const binary = await resolveFfmpeg();

  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      : null;

    const onAbort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk: Buffer) => {
      // Bounded: a failing filter graph can emit megabytes, and none of it is
      // more useful than the last few lines.
      stderr = (stderr + chunk.toString()).slice(-8000);
    });

    child.on('error', (error) => {
      cleanup();
      resolve({ ok: false, code: null, stderr: error.message });
    });

    child.on('exit', (code) => {
      cleanup();
      resolve(code === 0 ? { ok: true, stderr } : { ok: false, code, stderr });
    });

    function cleanup() {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  });
}
