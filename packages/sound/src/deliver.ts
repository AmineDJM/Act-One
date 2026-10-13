import { rm } from 'node:fs/promises';
import { TRUE_PEAK_CEILING } from '@act-one/core';
import { runFfmpeg } from './ffmpeg.ts';
import { dbToAmplitude, measureLoudness, type LoudnessMeasurement } from './master.ts';
import { muxArgs } from './mix.ts';

export type Delivery = {
  /** Whether a file with sound was written to the output. */
  ok: boolean;
  /** What the delivered file measures: what was actually shipped. */
  measured: LoudnessMeasurement | null;
  /** Muxes it took to land under the ceiling, or to give up trying. */
  passes: number;
  stderr: string;
};

/**
 * How far under the ceiling a tightened master aims, for the encode's own
 * variation: the overshoot does not fall in step with the master's peaks
 * (limited 0.5 dB lower, one master's encode came out 0.4 dB higher).
 */
const ENCODE_MARGIN_DB = 1;

/**
 * The picture and its master put together, and the file that leaves measured.
 *
 * Mastering leaves the sound under the true-peak ceiling as a WAV, but the one
 * AAC encode every film gets can raise its peaks — at the encoder's defaults
 * the KDE film went from −2.0 to −0.3 dBTP, over EBU R 128's −1 — and nothing
 * measured the file that was delivered. The encode is now set so it barely
 * moves them (see `muxArgs`); the delivery is measured all the same, and while
 * it is over, the master's peaks are held lower by what the encode added and
 * the film is muxed again from it. Only peaks move: a limiter on a mastered
 * programme leaves its loudness where the master put it, to a tenth of a unit.
 */
export async function deliverWithinCeiling(options: {
  video: string;
  master: string;
  output: string;
  /** The picture's length: the sound is padded to it so the film keeps every frame (see `muxArgs`). */
  pictureSeconds?: number;
  ceilingDb?: number;
  maxPasses?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Delivery> {
  const ceiling = options.ceilingDb ?? TRUE_PEAK_CEILING;
  const maxPasses = Math.max(1, options.maxPasses ?? 3);
  const run = { timeoutMs: options.timeoutMs ?? 300_000, ...(options.signal ? { signal: options.signal } : {}) };
  const temporaries: string[] = [];
  let source = options.master;
  let measured: LoudnessMeasurement | null = null;
  let sourcePeak: number | null = null;
  let passes = 0;
  try {
    while (passes < maxPasses) {
      passes += 1;
      const muxed = await runFfmpeg(muxArgs(options.video, source, options.output, options.pictureSeconds), run);
      if (!muxed.ok) return { ok: false, measured, passes, stderr: muxed.stderr };
      measured = await measureLoudness(options.output, run);
      const over = measured ? measured.truePeakDb - ceiling : 0;
      if (!measured || !Number.isFinite(over) || over <= 0 || passes >= maxPasses) break;

      // What the encode added on top of the master it was given, taken off the master's peaks.
      sourcePeak ??= (await measureLoudness(source, run))?.truePeakDb ?? null;
      if (sourcePeak === null || !Number.isFinite(sourcePeak)) break;
      sourcePeak = sourcePeak - over - ENCODE_MARGIN_DB;
      const tighter = `${options.master}.within-${passes}.wav`;
      temporaries.push(tighter);
      const limited = await runFfmpeg(
        [
          '-y', '-hide_banner', '-loglevel', 'error', '-i', options.master,
          '-af', `alimiter=limit=${dbToAmplitude(sourcePeak).toFixed(4)}:attack=5:release=50:level=disabled`,
          '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', tighter,
        ],
        run,
      );
      if (!limited.ok) break;
      source = tighter;
    }
    return { ok: true, measured, passes, stderr: '' };
  } finally {
    for (const file of temporaries) await rm(file, { force: true });
  }
}
