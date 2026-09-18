import { rename } from 'node:fs/promises';
import { LUFS_TOLERANCE, TRUE_PEAK_CEILING } from '@act-one/core';
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

/** What a BS.1770 meter says about a file. */
export type LoudnessMeasurement = { integratedLufs: number; truePeakDb: number; lra: number };

/**
 * Measures a file, through the same meter that normalises it.
 *
 * `loudnorm`'s analysis pass reports the input's own figures, so running it
 * against a finished master is how we find out what we actually shipped rather
 * than what we asked for.
 */
export async function measureLoudness(
  source: string,
  options: { timeoutMs?: number } = {},
): Promise<LoudnessMeasurement | null> {
  const result = await runFfmpeg(
    ['-i', source, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
    { timeoutMs: options.timeoutMs ?? 5 * 60_000 },
  );
  if (!result.ok) return null;

  const analysis = parseLoudnormJson(result.stderr);
  if (!analysis) return null;
  return {
    integratedLufs: Number(analysis.input_i),
    truePeakDb: Number(analysis.input_tp),
    lra: Number(analysis.input_lra),
  };
}

export async function masterLoudness(options: MasterOptions): Promise<LoudnessMeasurement | null> {
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
  const filter = `${normalise},${limiter(truePeak)}`;

  const outputArgs = options.outputArgs ?? ['-c:a', 'pcm_s16le'];
  const write = async (from: string, to: string, chain: string) => {
    const result = await runFfmpeg(
      ['-y', '-i', from, '-af', chain, '-ar', '48000', '-ac', '2', ...outputArgs, to],
      { ...signal, timeoutMs },
    );
    if (!result.ok) {
      throw new Error(`Mastering ${to} failed: ${result.stderr.slice(-400)}`);
    }
  };

  await write(options.source, options.target, filter);

  /*
   * Then check what actually landed, and correct it if it missed.
   *
   * `loudnorm` cannot honour `linear=true` when the source's own loudness range
   * exceeds the range it is asked for: it falls back to dynamic mode without
   * saying so, and lands wherever that puts it. A nineteen-second film came out
   * at −14.2 LUFS against a −16 target — nearly two decibels out, which is
   * twice the tolerance EBU R 128 allows for a whole programme.
   *
   * The correction is a flat gain, so it cannot change the loudness range or
   * undo the normalisation; it only finishes it. The limiter runs again behind
   * it because a positive correction would otherwise lift the peaks back over
   * the ceiling.
   */
  const landed = await measureLoudness(options.target, { timeoutMs });
  const drift = correctionFor(landed, options.lufs);
  if (drift === null) return landed;

  const corrected = `${options.target}.corrected${options.target.slice(options.target.lastIndexOf('.'))}`;
  await write(options.target, corrected, `volume=${drift.toFixed(2)}dB,${limiter(truePeak)}`);
  await rename(corrected, options.target);

  return await measureLoudness(options.target, { timeoutMs });
}

/** The ceiling, below the true-peak target: see masterLoudness. */
function limiter(truePeakDb: number): string {
  return `alimiter=limit=${dbToAmplitude(truePeakDb - 0.5).toFixed(4)}:attack=5:release=50:level=disabled`;
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

/**
 * The gain that would put a measured master on target, or null when it already is.
 *
 * Separated from the mastering itself so the rule is legible: a master inside
 * EBU R 128's tolerance is left alone, and one outside it is corrected by
 * exactly the difference. An unmeasurable result — silence, a meter that
 * failed — is left alone too, because guessing at a correction for a file we
 * could not measure is how a quiet film becomes a loud one.
 */
export function correctionFor(
  measured: LoudnessMeasurement | null,
  targetLufs: number,
  tolerance = LUFS_TOLERANCE,
): number | null {
  if (!measured || !Number.isFinite(measured.integratedLufs)) return null;
  const drift = targetLufs - measured.integratedLufs;
  return Math.abs(drift) <= tolerance ? null : drift;
}
