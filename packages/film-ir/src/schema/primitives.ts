import { z } from 'zod';
import { compareTime, isInt64String } from '../time.ts';

/**
 * The vocabulary every other part of the document is written in: exact time,
 * where a value came from, and curves.
 */

export const Int64String = z
  .string()
  .refine(isInt64String, { message: 'must be a decimal int64' })
  .describe('A 64-bit integer written in decimal, so JSON cannot round it.');

export const RationalTime = z
  .object({
    ticks: Int64String,
    timescale: z.number().int().positive().max(2 ** 31 - 1),
  })
  .describe('ticks / timescale seconds. The timescale is the clock the value was observed on.');
export type RationalTime = z.infer<typeof RationalTime>;

export const TimeRange = z
  .object({ start: RationalTime, end: RationalTime })
  .refine((range) => compareTime(range.start, range.end) <= 0, { message: 'a range ends at or after it starts' })
  .describe('Half-open: [start, end).');
export type TimeRange = z.infer<typeof TimeRange>;

/** An inclusive span of frame indices in the frame table. */
export const FrameSpan = z
  .object({ first: z.number().int().nonnegative(), last: z.number().int().nonnegative() })
  .refine((span) => span.first <= span.last, { message: 'a frame span ends at or after it starts' });
export type FrameSpan = z.infer<typeof FrameSpan>;

/**
 * Where a value came from.
 *
 *  SOURCE_EXACT  read from the file: container, stream, timestamp.
 *  MEASURED      computed deterministically from the decoded pixels or samples.
 *  ESTIMATED     reconstructed mathematically from measurements (a fit, a model of them).
 *  INFERRED      a semantic or directorial interpretation, by a model or a person.
 *  UNKNOWN       not enough evidence. Always preferred to a guess.
 *  RECOMMENDED_RECONSTRUCTION  what an executor should do to reproduce what was observed.
 *  SPECIFIED     authored intent. Only in a plan: a film that does not exist yet has
 *                nothing to measure, and its values are decisions, not observations.
 */
export const EvidenceType = z.enum([
  'SOURCE_EXACT',
  'MEASURED',
  'ESTIMATED',
  'INFERRED',
  'UNKNOWN',
  'RECOMMENDED_RECONSTRUCTION',
  'SPECIFIED',
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/**
 * A pointer into the document or into the source.
 *
 * `frame:120`, `frames:120-144`, `sample:48000`, `stream:v0`, `producer:forensics`,
 * `pass:p05_audio`, `obj:text.0003`, `evt:0042`, `shot:003`, `word:0017`, `series:audio.rms_db`.
 * The validator resolves every one; a reference to nothing is a defect.
 */
export const Ref = z.string().regex(/^[a-z_]+:[A-Za-z0-9_.:\-/]+$/, 'a ref is kind:id');
export type Ref = z.infer<typeof Ref>;

export const MethodId = z.string().regex(/^[a-z0-9_.-]+$/, 'a method id is lower-case, dotted');

export const Confidence = z.number().min(0).max(1);

export const Provenance = z.object({
  evidenceType: EvidenceType,
  confidence: Confidence,
  method: MethodId,
  sourceRefs: z.array(Ref).default([]),
  note: z.string().max(600).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

/** A value that knows where it came from. `value` is null exactly when the evidence type is UNKNOWN. */
export function evidenced<T extends z.ZodTypeAny>(value: T) {
  return Provenance.extend({
    value: value.nullable(),
    lowerBound: value.optional(),
    upperBound: value.optional(),
    unit: z.string().max(40).optional(),
  });
}

export const EvidencedNumber = evidenced(z.number());
export type EvidencedNumber = z.infer<typeof EvidencedNumber>;
export const EvidencedString = evidenced(z.string().max(4000));
export type EvidencedString = z.infer<typeof EvidencedString>;
export const EvidencedBoolean = evidenced(z.boolean());
export type EvidencedBoolean = z.infer<typeof EvidencedBoolean>;
export const EvidencedTime = evidenced(RationalTime);
export type EvidencedTime = z.infer<typeof EvidencedTime>;
export const EvidencedRange = evidenced(TimeRange);
export type EvidencedRange = z.infer<typeof EvidencedRange>;

/** A box in source pixels of the frame it was measured on. */
export const Box = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Box = z.infer<typeof Box>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/**
 * How a curve is sampled.
 *
 *  frames   one value per row of the frame table, index-aligned.
 *  regular  a fixed step on an exact clock: `count` values from `start`.
 *  ticks    irregular instants on one clock.
 */
export const Sampling = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frames') }),
  z.object({
    kind: z.literal('regular'),
    start: RationalTime,
    step: RationalTime,
    count: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('ticks'), timescale: z.number().int().positive(), ticks: z.array(Int64String) }),
]);
export type Sampling = z.infer<typeof Sampling>;

/**
 * A curve over time: measured, inferred or specified, never a mixture.
 *
 * Provenance is carried once for the whole curve because every sample was
 * produced by the same method; a sample that could not be computed is null,
 * never zero.
 */
export const Series = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  quantity: z.string().max(120),
  unit: z.string().max(40),
  domain: z.enum(['measured', 'estimated', 'inferred', 'specified']),
  description: z.string().max(600).default(''),
  provenance: Provenance,
  sampling: Sampling,
  values: z.array(z.number().nullable()),
  lower: z.array(z.number().nullable()).optional(),
  upper: z.array(z.number().nullable()).optional(),
});
export type Series = z.infer<typeof Series>;

/** A vector per sample: a histogram, a palette. `values[i]` has `labels.length` entries. */
export const VectorSeries = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  quantity: z.string().max(120),
  labels: z.array(z.string().max(40)).min(1),
  unit: z.string().max(40),
  provenance: Provenance,
  sampling: Sampling,
  values: z.array(z.array(z.number()).nullable()),
});
export type VectorSeries = z.infer<typeof VectorSeries>;

/**
 * A curve fitted to an observed trajectory.
 *
 * Always ESTIMATED: the parameters are the best fit found, with how well they
 * fit, and never a claim about the curve the film was actually made with.
 */
export const CurveModel = z.enum([
  'hold',
  'linear',
  'power_ease_in',
  'power_ease_out',
  'power_ease_in_out',
  'exponential_ease_out',
  'cubic_bezier',
  'damped_spring',
]);
export type CurveModel = z.infer<typeof CurveModel>;

export const CurveFit = z.object({
  id: z.string(),
  property: z.string().max(60),
  frames: FrameSpan,
  range: TimeRange,
  model: CurveModel,
  parameters: z.record(z.string(), z.number()),
  from: z.number(),
  to: z.number(),
  residualRms: z.number().nonnegative(),
  rSquared: z.number().max(1),
  /** How many observed samples the fit rests on. Two points fit anything. */
  samples: z.number().int().nonnegative(),
  runnerUp: z.object({ model: CurveModel, rSquared: z.number().max(1) }).nullable().default(null),
  provenance: Provenance,
});
export type CurveFit = z.infer<typeof CurveFit>;

/** One moment in a motion: where it started, peaked, settled. */
export const MotionPhaseKind = z.enum([
  'start',
  'acceleration_peak',
  'peak_velocity',
  'deceleration_peak',
  'settle',
  'reversal',
  'pause',
  'end',
]);
export type MotionPhaseKind = z.infer<typeof MotionPhaseKind>;

export const MotionPhase = z.object({
  kind: MotionPhaseKind,
  frame: z.number().int().nonnegative(),
  at: RationalTime,
  value: z.number().nullable().default(null),
  unit: z.string().max(40).default(''),
  provenance: Provenance,
});
export type MotionPhase = z.infer<typeof MotionPhase>;

/** A quantity measured somewhere else in the document, cited rather than repeated. */
export const Citation = z.object({
  quantity: z.string().max(120),
  value: z.number().nullable(),
  unit: z.string().max(40),
  ref: Ref,
});
export type Citation = z.infer<typeof Citation>;
