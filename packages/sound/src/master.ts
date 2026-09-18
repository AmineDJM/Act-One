import { TRUE_PEAK_CEILING } from '@act-one/core';
import { runFfmpeg } from './ffmpeg.ts';

/**
 * Loudness mastering, in the only form that actually hits its target.
 *
 * One pass of `loudnorm` is a dynamic normaliser working from a running
 * estimate; it lands a decibel or two away, which is most of the tolerance
 * EBU R 128 allows for a whole programme, spent before anything else has had a
 * chance to drift. The two-pass form measures first and applies a known linear
 * gain, which is exact and — being linear — leaves the dynamics of the mix
 * alone rather than compressing them on the way out.
 *
 * Shared by the library builder and by the film mix. Two implementations of
 * "make this the right loudness" is how a library mastered to one standard ends
 * up inside films mastered to another.
 */
export type MasterOptions = {
  source: string;
  target: string;
  /** Integrated loudness to hit, in LUFS. */
  lufs: number;
  /**
   * True-peak ceiling, dBTP. Defaults half a decibel inside EBU R 128's, as
   * headroom for the encoder: inter-sample peaks rise on the way into AAC, so a
   * master that only just clears the ceiling as a WAV can be over it as the
   * file anybody plays.
   */
  truePeak?: number;
  /** Extra FFmpeg output arguments, e.g. a codec for the second pass. */
  outputArgs?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function masterLoudness(options: MasterOptions): Promise<void> {
  const truePeak = options.truePeak ?? TRUE_PEAK_CEILING - 0.5;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const common = `I=${options.lufs}:TP=${truePeak}:LRA=11`;
  const signal = options.signal ? { signal: options.signal } : {};

  const measured = await runFfmpeg(
    ['-i', options.source, '-af', `loudnorm=${common}:print_format=json`, '-f', 'null', '-'],
    { ...signal, timeoutMs },
  );
  if (!measured.ok) {
    throw new Error(`Measuring ${options.source} failed: ${measured.stderr.slice(-400)}`);
  }

  const analysis = parseLoudnormJson(measured.stderr);
  const normalise = analysis
    ? `loudnorm=${common}:linear=true:measured_I=${analysis.input_i}` +
      `:measured_TP=${analysis.input_tp}:measured_LRA=${analysis.input_lra}` +
      `:measured_thresh=${analysis.input_thresh}:offset=${analysis.target_offset}`
    : // No measurement to read back: one pass is still far better than none, and
      // failing because FFmpeg moved a JSON block is worse than half a decibel.
      `loudnorm=${common}`;

  /*
   * An explicit ceiling after the normaliser.
   *
   * `loudnorm` only limits true peak in its dynamic mode; `linear=true`, which
   * is what preserves the dynamics of a piece written to have them, applies a
   * flat gain and lets the peaks land where they land. A master aimed at
   * −1.5 dBTP measured −0.9 — over EBU R 128's −1 dBTP — and stayed there
   * however many encodes were removed from the chain, because nothing in it
   * was limiting.
   *
   * Sample-peak limited a little under the true-peak target, since inter-sample
   * peaks sit above sample peaks and AAC adds its own. The margin is verified
   * by measuring the finished file, not assumed.
   */
  const ceiling = dbToAmplitude(truePeak - 0.5);
  const filter = `${normalise},alimiter=limit=${ceiling.toFixed(4)}:attack=5:release=50:level=disabled`;

  const written = await runFfmpeg(
    [
      '-y',
      '-i', options.source,
      '-af', filter,
      '-ar', '48000',
      '-ac', '2',
      ...(options.outputArgs ?? ['-c:a', 'pcm_s16le']),
      options.target,
    ],
    { ...signal, timeoutMs },
  );
  if (!written.ok) {
    throw new Error(`Mastering ${options.target} failed: ${written.stderr.slice(-400)}`);
  }
}

export type LoudnormAnalysis = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

/**
 * Pulls loudnorm's measurement out of FFmpeg's stderr.
 *
 * It prints a JSON object after everything else it has to say, so the last
 * balanced braces in the stream are the measurement. Returns null rather than
 * throwing when the shape is not what we expect — FFmpeg's output is not an API.
 */
export function parseLoudnormJson(stderr: string): LoudnormAnalysis | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return null;

  try {
    const parsed: unknown = JSON.parse(stderr.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const;
    for (const key of keys) {
      const value = record[key];
      // loudnorm reports "-inf" for silence, which the second pass cannot use.
      if (typeof value !== 'string' || !Number.isFinite(Number(value))) return null;
    }
    return Object.fromEntries(keys.map((key) => [key, record[key]])) as LoudnormAnalysis;
  } catch {
    return null;
  }
}

/**
 * Levelling for material too short to have a loudness.
 *
 * BS.1770 integrates over gated 400ms blocks, so an 0.18s click has no
 * integrated loudness at all: measuring one reports −70 LUFS, the silence
 * floor, for a file that peaks near full scale. So for short material the
 * target is read as an RMS level, which is defined at any length and close to
 * loudness for broadband content — and the result is held under the true-peak
 * ceiling, because a sample that must choose between its level and its ceiling
 * keeps the ceiling.
 */
export async function levelShortSample(options: {
  source: string;
  target: string;
  /** Mean level to hit, in dBFS RMS. */
  rmsDb: number;
  truePeak?: number;
  timeoutMs?: number;
}): Promise<void> {
  const ceiling = options.truePeak ?? TRUE_PEAK_CEILING - 0.5;
  const timeoutMs = options.timeoutMs ?? 2 * 60_000;

  const measured = await runFfmpeg(['-i', options.source, '-af', 'volumedetect', '-f', 'null', '-'], {
    timeoutMs,
  });
  if (!measured.ok) {
    throw new Error(`Measuring ${options.source} failed: ${measured.stderr.slice(-400)}`);
  }

  const levels = parseVolumeDetect(measured.stderr);
  // Unmeasurable means genuinely empty here: these are short, dense samples.
  if (!levels) throw new Error(`${options.source} has no signal in it.`);

  const gainDb = Math.min(options.rmsDb - levels.meanDb, ceiling - levels.maxDb);

  const written = await runFfmpeg(
    [
      '-y',
      '-i', options.source,
      '-af', `volume=${gainDb.toFixed(2)}dB`,
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      options.target,
    ],
    { timeoutMs },
  );
  if (!written.ok) {
    throw new Error(`Levelling ${options.target} failed: ${written.stderr.slice(-400)}`);
  }
}

/** Mean and max level, in dBFS, from FFmpeg's volumedetect. */
export function parseVolumeDetect(stderr: string): { meanDb: number; maxDb: number } | null {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!mean || !max) return null;
  const meanDb = Number(mean[1]);
  const maxDb = Number(max[1]);
  if (!Number.isFinite(meanDb) || !Number.isFinite(maxDb)) return null;
  return { meanDb, maxDb };
}

/** dBFS to linear amplitude, for filters that take a 0..1 limit. */
export function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}
