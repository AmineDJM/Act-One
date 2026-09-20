import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { resolveFfmpeg } from '@act-one/sound';

/**
 * What a film measurably does.
 *
 * Everything in here was read off the file by a program: boundary times,
 * optical-flow magnitudes, element trajectories, audio onsets, the offset
 * between a sound and the movement it belongs to. Nothing in here is an
 * opinion, and nothing in here carries a confidence score, because a measured
 * number that needs one is a measurement that was not made.
 *
 * This is deliberately one half of a pair. The other half — what the film is
 * doing and why, read by a model that watched it — lives in the analysis
 * provider, and the two are fused without being mixed in `film-reading.ts`.
 * Keeping them apart is the whole point: "optical-flow peak at 12.42s" and
 * "three cards accelerate into the hero transition" are different kinds of
 * claim, they fail in different ways, and a reader that cannot tell them apart
 * will end up treating a model's guess as an instrument reading.
 *
 * The measuring itself is the Python in `scripts/analysis`, run as a child
 * process rather than reimplemented here. It is real OpenCV work — dense
 * optical flow, element tracking, homography-based camera/object separation,
 * trajectory-fitted easing — and there is no version of that in TypeScript
 * worth maintaining. What this module owns is the contract: the shape that
 * comes back, what happens when the tooling is absent, and the refusal to
 * report a measurement that was not taken.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the analysis scripts live, walking up from this file to the repo root.
 *
 * Resolved rather than configured because the scripts ship with the code and
 * move with it; an environment variable for this would be one more thing to
 * set correctly on a render host.
 */
function scriptPath(name: string): string {
  for (let up = 2; up <= 6; up += 1) {
    const candidate = path.resolve(HERE, ...Array(up).fill('..'), 'scripts', 'analysis', name);
    if (existsSync(candidate)) return candidate;
  }
  return path.resolve(HERE, '../../..', 'scripts', 'analysis', name);
}

// ---------------------------------------------------------------------------
// The shape the analyser returns.
// ---------------------------------------------------------------------------

/**
 * A boundary, in seconds, with what the measurement was that found it.
 *
 * The four kinds are four different decisions, and the reason the analyser
 * separates them is that counting only hard cuts reported a seventy-second
 * motion-design film as three shots — true, and useless. A film of this class
 * changes its idea many times while cutting rarely.
 */
export const MeasuredBoundary = z.object({
  at: z.number(),
  /** Whether the picture was actually replaced there, or the film changed without cutting. */
  withCut: z.boolean().default(false),
});
export type MeasuredBoundary = z.infer<typeof MeasuredBoundary>;

export const MeasuredBoundaries = z.object({
  shot: z.array(MeasuredBoundary).default([]),
  scene: z.array(MeasuredBoundary).default([]),
  creativeBeat: z.array(MeasuredBoundary).default([]),
  transformation: z.array(MeasuredBoundary).default([]),
  /** How much of the frame the dominant colour field holds, median over the film. */
  fieldShareMedian: z.number().optional(),
});
export type MeasuredBoundaries = z.infer<typeof MeasuredBoundaries>;

/**
 * One tracked thing, and what it did.
 *
 * `easing` is null where the trajectory was too short or too noisy to fit, and
 * that is reported rather than defaulted — a fitted `linear` and an unfittable
 * curve are different findings, and `easingFit` says which this is.
 */
export const MeasuredElement = z.object({
  id: z.number().optional(),
  kind: z.string(),
  enterAt: z.number(),
  exitAt: z.number().optional(),
  seconds: z.number(),
  fromXY: z.tuple([z.number(), z.number()]).optional(),
  toXY: z.tuple([z.number(), z.number()]).optional(),
  /** Distance travelled as a fraction of the frame. */
  travel: z.number().optional(),
  scale: z.number().default(1),
  directionDeg: z.number().optional(),
  /** The easing family fitted to the trajectory, which is where easing lives. */
  easing: z.string().nullable().default(null),
  /** How well the fit held. A low number means the family named is a guess. */
  easingFit: z.number().optional(),
});
export type MeasuredElement = z.infer<typeof MeasuredElement>;

/** What the soundtrack is made of, measured off the audio stream. */
export const MeasuredAudio = z.object({
  voiceSpans: z.array(z.tuple([z.number(), z.number()])).default([]),
  voiceShareOfRuntime: z.number().default(0),
  silentSeconds: z.number().default(0),
  longestSilence: z.number().default(0),
  rangeDb: z.number().default(0),
  bpm: z.number().nullable().default(null),
  onsets: z.array(z.number()).default([]),
  impacts: z.array(z.number()).default([]),
  risers: z.array(z.number()).default([]),
  sectionsAt: z.array(z.number()).default([]),
});
export type MeasuredAudio = z.infer<typeof MeasuredAudio>;

export const FilmMeasurement = z.object({
  durationSeconds: z.number(),
  boundaries: MeasuredBoundaries,
  counts: z.object({
    shot: z.number(),
    scene: z.number(),
    creativeBeat: z.number(),
    transformation: z.number(),
  }),
  /** Fraction of frame pairs with essentially no movement. */
  staticShare: z.number(),
  meanFlow: z.number(),
  cameraVsObject: z.object({
    cameraFrames: z.number(),
    objectFrames: z.number(),
    /** How much of the moving material is explained by the frame moving. */
    cameraShare: z.number(),
    /** Frames carrying two depths moving at different rates. */
    parallaxShare: z.number(),
  }),
  elements: z.array(MeasuredElement).default([]),
  elementCounts: z.record(z.string(), z.number()).default({}),
  /** Siblings entering together: the measurement Act One under-uses most. */
  staggerGroups: z.array(z.unknown()).default([]),
  /**
   * Null only when the file carries no audio stream at all.
   *
   * Worth being exact about, because a model watching the film reported "no
   * audio present" for a film with a 253kb/s AAC track on it. An absence the
   * instrument confirms and an absence a model asserts are not the same claim.
   */
  audio: MeasuredAudio.nullable().default(null),
  /** A sonic event against the element movement it belongs to, in milliseconds. */
  soundToElement: z
    .array(z.object({ kind: z.string(), enterAt: z.number(), soundOffsetMs: z.number() }))
    .default([]),
});
export type FilmMeasurement = z.infer<typeof FilmMeasurement>;

export type MeasureOptions = {
  /** Frames per second to decode at. Higher reads fast motion and costs time. */
  fps?: number;
  /** Working width in pixels. The analysis is on shape, not on detail. */
  width?: number;
  /** Wall-clock ceiling. A ninety-second film at 15fps takes about a minute. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Raised when the measuring tools are not installed, as opposed to failing. */
export class MeasurementUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementUnavailable';
  }
}

/**
 * Whether this host can measure a film at all.
 *
 * Asked before the work rather than discovered during it, because "no numbers"
 * and "numbers that say nothing happened" are opposite findings and a caller
 * must never read the first as the second. A film that could not be measured
 * has no measurement; it does not have a measurement of zero.
 */
export async function measurementAvailable(): Promise<{ ready: boolean; reason: string }> {
  if (!existsSync(scriptPath('film_grammar.py'))) {
    return { ready: false, reason: 'The analysis scripts are not present in this deployment.' };
  }
  try {
    await resolveFfmpeg();
  } catch {
    return { ready: false, reason: 'FFmpeg is not available on this host.' };
  }
  const probe = await run('python3', ['-c', 'import cv2, numpy'], 20_000).catch(() => null);
  if (!probe || probe.code !== 0) {
    return {
      ready: false,
      reason:
        'Python with OpenCV and NumPy is not available on this host (pip install opencv-python-headless numpy).',
    };
  }
  return { ready: true, reason: '' };
}

/**
 * Measures a film: boundaries, motion, elements, camera, sound.
 *
 * Throws `MeasurementUnavailable` when the host cannot do it, and a plain
 * error when it could and did not. The distinction matters to every caller —
 * one is a deployment gap to report, the other is a film to look at.
 */
export async function measureFilmGrammar(
  filePath: string,
  options: MeasureOptions = {},
): Promise<FilmMeasurement> {
  const ready = await measurementAvailable();
  if (!ready.ready) throw new MeasurementUnavailable(ready.reason);

  const script = scriptPath('film_grammar.py');
  const out = path.join(tmpdir(), `act-one-measure-${randomUUID()}.json`);
  const ffmpeg = await resolveFfmpeg();

  const args = [script, path.resolve(filePath), out];
  if (options.fps) args.push('--fps', String(options.fps));
  if (options.width) args.push('--width', String(options.width));

  try {
    const result = await run(
      'python3',
      args,
      options.timeoutMs ?? 10 * 60_000,
      {
        // The scripts read the same variable the rest of the system does, so one
        // host with an unusual FFmpeg is configured once.
        ACT_ONE_FFMPEG_PATH: ffmpeg,
      },
      options.signal,
    );

    if (result.code !== 0) {
      throw new Error(
        `The film could not be measured: ${result.stderr.slice(-400) || `exit ${result.code}`}`,
      );
    }
    const raw = JSON.parse(await readFile(out, 'utf8')) as unknown;
    return FilmMeasurement.parse(raw);
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    // Bounded: a decode that goes wrong can write a great deal, and holding
    // all of it to report the last line is how a measurement takes the worker
    // down with it.
    const cap = (existing: string, chunk: string) => (existing + chunk).slice(-16_000);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Measuring timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk) => {
      stdout = cap(stdout, String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
      stderr = cap(stderr, String(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
