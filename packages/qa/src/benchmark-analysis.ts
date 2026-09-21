/**
 * Analysing one reference film into a profile the corpus can retrieve from.
 *
 * TWO READINGS, NEITHER STANDING IN FOR THE OTHER. The instrument measures
 * shot boundaries, motion, loudness and palette; the model watches the film and
 * describes what it saw and when. They answer different questions and this runs
 * both, because a corpus with only measurements cannot say what a film DOES and
 * one with only readings cannot say whether any of it is true.
 *
 * WHY EACH HALF FAILS SEPARATELY. The obvious structure is to run both and
 * throw if either fails, and it is wrong: a reference whose model reading
 * failed still has usable measurements, and losing it entirely because one
 * provider had a bad minute shrinks a corpus that is already small. So each
 * half is settled on its own and the result says which half is missing —
 * `partial` exists for exactly this and it is a state an operator can act on
 * by pressing re-analyse.
 *
 * THE EMPTY READING IS THE DANGEROUS CASE. A model can return a perfectly
 * well-formed reading that describes nothing, and such a film sits in the
 * corpus looking analysed while contributing nothing to any query. One of the
 * first three films was in that state and nobody noticed until a retrieval was
 * run by hand. A reading with no described moments is `partial`, never
 * `analysed`, however successful the call was.
 */
import type { VideoAnalyst, CallContext } from '@act-one/providers';
import { analyseFilm } from './reference.ts';

export type BenchmarkAnalysis = {
  measured: Record<string, unknown> | null;
  reading: Record<string, unknown> | null;
  /** Described moments in the reading. Zero is why `partial` exists. */
  mechanismCount: number;
  durationSeconds: number;
  status: 'analysed' | 'partial' | 'failed';
  /** What is missing or wrong, in one line an operator can act on. */
  note: string;
  costUsd: number;
};

/** Every array in a reading that carries described, timed moments. */
const MOMENT_KEYS = [
  'boundaries', 'beats', 'typography', 'ui', 'camera',
  'transitions', 'audio', 'sync', 'heroMoments', 'objectTransformations',
] as const;

/**
 * How many moments a reading actually describes.
 *
 * Counts entries that have BOTH a time and a description, because those are the
 * only ones retrieval can use. A reading full of empty objects is not a reading,
 * and counting its length would report a healthy film that answers no query.
 */
export function countMoments(reading: Record<string, unknown> | null): number {
  if (!reading) return 0;
  let total = 0;
  for (const key of MOMENT_KEYS) {
    for (const entry of (reading[key] as Record<string, unknown>[] | undefined) ?? []) {
      const at = Number(entry?.['at'] ?? entry?.['atSeconds'] ?? NaN);
      const said = String(entry?.['mechanism'] ?? entry?.['what'] ?? entry?.['description'] ?? '').trim();
      if (Number.isFinite(at) && said !== '') total += 1;
    }
  }
  return total;
}

export async function analyseBenchmark(
  filePath: string,
  analyst: VideoAnalyst | null,
  context: CallContext,
  options: { signal?: AbortSignal } = {},
): Promise<BenchmarkAnalysis> {
  const gaps: string[] = [];
  let costUsd = 0;

  const measuredResult = await Promise.allSettled([
    analyseFilm(filePath, options.signal ? { signal: options.signal } : {}),
  ]);
  const measured = measuredResult[0].status === 'fulfilled'
    ? (measuredResult[0].value as unknown as Record<string, unknown>)
    : null;
  if (measuredResult[0].status === 'rejected') {
    gaps.push(`Deterministic analysis failed: ${(measuredResult[0].reason as Error).message.slice(0, 200)}`);
  }

  let reading: Record<string, unknown> | null = null;
  if (!analyst) {
    gaps.push('No video analyst is configured, so the film was measured but never watched.');
  } else {
    try {
      const answer = await analyst.analyse(
        { source: filePath, depth: 'deep' },
        context,
      );
      reading = answer as unknown as Record<string, unknown>;
      costUsd += Number((answer as unknown as { costUsd?: number }).costUsd ?? 0);
    } catch (error) {
      gaps.push(`The model could not watch it: ${(error as Error).message.slice(0, 200)}`);
    }
  }

  const mechanismCount = countMoments(reading);
  if (reading && mechanismCount === 0) {
    gaps.push('The reading came back with no described moments in it, so this film answers no query.');
  }

  const durationSeconds = Number(measured?.['durationSeconds'] ?? 0);

  // Nothing at all is a failure. Anything usable, with a gap, is partial.
  const status = !measured && !reading ? 'failed' : gaps.length > 0 ? 'partial' : 'analysed';

  return {
    measured, reading, mechanismCount, durationSeconds, status,
    note: gaps.join(' '), costUsd,
  };
}
