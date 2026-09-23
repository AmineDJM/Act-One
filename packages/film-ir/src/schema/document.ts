import { z } from 'zod';
import { AudioIR, NarrationIR, SoundIR } from './audio.ts';
import {
  Contradiction,
  InterpretationIR,
  ReconstructionIR,
  Uncertainty,
  UnsupportedHypothesis,
} from './interpretation.ts';
import { Series } from './primitives.ts';
import { FrameTable, Method, Producer, RenderTarget, SourceInfo } from './source.ts';
import { EventGraph, StructureIR } from './structure.ts';
import { TypographyIR } from './typography.ts';
import { AttentionIR, CameraTrack, DepthIR, ProductIR, TrackedObject } from './visual.ts';

export const FILM_IR_SCHEMA = 'actone.film-ir' as const;
/** Major versions break readers; minor versions only add optional fields. */
export const FILM_IR_VERSION = '1.0' as const;

export const ValidationCheck = z.object({
  id: z.string(),
  title: z.string().max(200),
  critical: z.boolean(),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string().max(1200),
  count: z.number().int().nonnegative().nullable().default(null),
  examples: z.array(z.string().max(300)).default([]),
});
export type ValidationCheck = z.infer<typeof ValidationCheck>;

/**
 * Whether the document can be trusted, and how much of it.
 *
 * READY only when every critical check passes and every analysis that should
 * have run did; PARTIAL when the document is sound but something is missing;
 * FAILED when it cannot be relied on at all. A model returning valid JSON is
 * not, on its own, any of these.
 */
export const ValidationReport = z.object({
  status: z.enum(['READY', 'PARTIAL', 'FAILED']),
  validatorVersion: z.string(),
  checkedAt: z.string(),
  checks: z.array(ValidationCheck),
  coverage: z.object({
    frames: z.object({ expected: z.number().int().nonnegative(), analyzed: z.number().int().nonnegative() }),
    audioSamples: z.object({ expected: z.number().int().nonnegative(), analyzed: z.number().int().nonnegative() }),
    passes: z.object({
      expected: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      empty: z.number().int().nonnegative(),
    }),
  }),
  evidenceMix: z.record(z.string(), z.number().int().nonnegative()),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

/**
 * FilmIR: one film, as one machine-readable document.
 *
 * The same language describes a finished film reverse-engineered from its
 * file (`reconstruction`) and a film that is only planned (`plan`). What
 * differs is where values come from — measurement for the first, authored
 * intent (SPECIFIED) for the second — and the validator holds each mode to
 * its own rules. Executors will later read projections of this document; it
 * remains the only source of truth about the film.
 */
export const FilmIR = z.object({
  schema: z.literal(FILM_IR_SCHEMA),
  version: z.literal(FILM_IR_VERSION),
  id: z.string().min(1).max(120),
  mode: z.enum(['reconstruction', 'plan']),
  title: z.string().max(300).nullable(),
  createdAt: z.string(),
  source: SourceInfo.nullable(),
  target: RenderTarget.nullable(),
  methods: z.array(Method),
  producers: z.array(Producer),
  frames: FrameTable.nullable(),
  objects: z.array(TrackedObject),
  camera: CameraTrack.nullable(),
  depth: DepthIR.nullable(),
  attention: AttentionIR.nullable(),
  product: ProductIR.nullable(),
  typography: TypographyIR,
  audio: AudioIR,
  narration: NarrationIR,
  sound: SoundIR,
  structure: StructureIR,
  events: EventGraph,
  curves: z.object({ measured: z.array(Series), inferred: z.array(Series) }),
  interpretation: InterpretationIR.nullable(),
  reconstruction: ReconstructionIR.nullable(),
  uncertainties: z.array(Uncertainty),
  contradictions: z.array(Contradiction),
  unsupported: z.array(UnsupportedHypothesis),
  validation: ValidationReport.nullable(),
});
export type FilmIR = z.infer<typeof FilmIR>;
