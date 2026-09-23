import type { EvidenceType, Provenance, Ref } from './schema/primitives.ts';

/**
 * Constructors for values that know where they came from.
 *
 * The compiler builds the document out of these and nothing else, which is
 * what makes "every value has provenance" a property of the code rather than
 * a hope about it. `unknown` is as easy to write as `measured`, on purpose:
 * the cheapest thing to write must never be a guess.
 */
export type Evidenced<T> = Provenance & { value: T | null; lowerBound?: T; upperBound?: T; unit?: string };

type Extra<T> = { lowerBound?: T; upperBound?: T; unit?: string; note?: string };

function make<T>(
  evidenceType: EvidenceType,
  value: T | null,
  confidence: number,
  method: string,
  sourceRefs: readonly Ref[],
  extra: Extra<T> = {},
): Evidenced<T> {
  const out: Evidenced<T> = {
    evidenceType,
    confidence: clamp01(confidence),
    method,
    sourceRefs: [...sourceRefs],
    value,
  };
  if (extra.lowerBound !== undefined) out.lowerBound = extra.lowerBound;
  if (extra.upperBound !== undefined) out.upperBound = extra.upperBound;
  if (extra.unit !== undefined) out.unit = extra.unit;
  if (extra.note !== undefined) out.note = extra.note;
  return out;
}

export function sourceExact<T>(value: T, method: string, refs: readonly Ref[], extra?: Extra<T>): Evidenced<T> {
  return make('SOURCE_EXACT', value, 1, method, refs, extra);
}

export function measured<T>(value: T, method: string, refs: readonly Ref[], confidence = 1, extra?: Extra<T>): Evidenced<T> {
  return make('MEASURED', value, confidence, method, refs, extra);
}

export function estimated<T>(value: T, method: string, refs: readonly Ref[], confidence: number, extra?: Extra<T>): Evidenced<T> {
  return make('ESTIMATED', value, confidence, method, refs, extra);
}

export function inferred<T>(value: T, method: string, refs: readonly Ref[], confidence: number, extra?: Extra<T>): Evidenced<T> {
  return make('INFERRED', value, confidence, method, refs, extra);
}

export function recommended<T>(value: T, method: string, refs: readonly Ref[], confidence: number, extra?: Extra<T>): Evidenced<T> {
  return make('RECOMMENDED_RECONSTRUCTION', value, confidence, method, refs, extra);
}

/** Not enough evidence. The reason goes in the note, so "unknown" is never unexplained. */
export function unknown<T>(method: string, reason: string, refs: readonly Ref[] = []): Evidenced<T> {
  return make<T>('UNKNOWN', null, 0, method, refs, { note: reason });
}

export function provenance(
  evidenceType: EvidenceType,
  method: string,
  refs: readonly Ref[],
  confidence = evidenceType === 'SOURCE_EXACT' || evidenceType === 'MEASURED' ? 1 : 0.5,
  note?: string,
): Provenance {
  const out: Provenance = { evidenceType, confidence: clamp01(confidence), method, sourceRefs: [...refs] };
  if (note !== undefined) out.note = note;
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}
