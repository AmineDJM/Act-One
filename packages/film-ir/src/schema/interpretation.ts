import { z } from 'zod';
import { Citation, EvidencedRange, EvidencedString, Provenance, Ref, TimeRange } from './primitives.ts';

/**
 * What the film is doing and why it appears to work.
 *
 * Every field here is INFERRED and cites the measurements it rests on. The
 * facts of a directorial choice — what, how, when, how much, relative to
 * what — are kept in separate fields from its `why`, so a reader can always
 * tell the observation from the interpretation.
 */
export const NarrativeIR = z.object({
  thesis: EvidencedString,
  arc: EvidencedString,
  acts: z.array(z.object({ id: z.string(), range: EvidencedRange, label: EvidencedString, summary: EvidencedString })),
});
export type NarrativeIR = z.infer<typeof NarrativeIR>;

export const FilmDNA = z.object({
  thesis: EvidencedString,
  narrativeArc: EvidencedString,
  mood: EvidencedString,
  brandPosture: EvidencedString,
  visualPhilosophy: EvidencedString,
  typographyPhilosophy: EvidencedString,
  motionPhilosophy: EvidencedString,
  cameraPhilosophy: EvidencedString,
  soundPhilosophy: EvidencedString,
  productCinematographyPhilosophy: EvidencedString,
  transitionPhilosophy: EvidencedString,
  attentionStrategy: EvidencedString,
  openingStrategy: EvidencedString,
  heroStrategy: EvidencedString,
  resolutionStrategy: EvidencedString,
});
export type FilmDNA = z.infer<typeof FilmDNA>;

export const DirectorialChoice = z.object({
  id: z.string(),
  title: z.string().max(200),
  what: z.string().max(1200),
  how: z.string().max(1200),
  when: TimeRange,
  howMuch: z.array(Citation),
  relativeTo: z.string().max(600),
  factRefs: z.array(Ref),
  why: EvidencedString,
});
export type DirectorialChoice = z.infer<typeof DirectorialChoice>;

export const MemorableMoment = z.object({
  id: z.string(),
  range: TimeRange,
  title: z.string().max(200),
  description: EvidencedString,
  measured: z.array(Citation),
  refs: z.array(Ref),
});

/**
 * A mechanism worth learning: the principle, and what must not be taken.
 *
 * The benchmark is a quality bar, never a recipe. What transfers is the
 * relation between a context, a decision and its effect; the composition,
 * wording, timing and look of the original stay with the original.
 */
export const Mechanism = z.object({
  id: z.string(),
  context: z.string().max(800),
  observedDecision: z.string().max(800),
  likelyEffect: EvidencedString,
  evidence: z.array(Ref),
  transferablePrinciple: z.string().max(800),
  doNotCopy: z.array(z.string().max(300)).min(1),
  provenance: Provenance,
});
export type Mechanism = z.infer<typeof Mechanism>;

export const Signature = z.object({
  id: z.string(),
  description: z.string().max(800),
  whyNotTransferable: z.string().max(800),
  refs: z.array(Ref),
  provenance: Provenance,
});

/** What the film is, as a viewer would say it: the subject, the kind of film, who it is for. */
export const FilmIdentity = z.object({
  summary: EvidencedString,
  subject: EvidencedString,
  format: EvidencedString,
  audience: EvidencedString,
  language: EvidencedString,
});
export type FilmIdentity = z.infer<typeof FilmIdentity>;

/**
 * A finding with no more specific place in the document: how an object moves,
 * what an inspected window shows, a relationship between sound and picture.
 * Kept rather than dropped, and kept apart from the structured fields.
 */
export const Observation = z.object({
  id: z.string(),
  topic: z.string().max(60),
  range: EvidencedRange.nullable(),
  text: EvidencedString,
});
export type Observation = z.infer<typeof Observation>;

export const InterpretationIR = z.object({
  identity: FilmIdentity,
  narrative: NarrativeIR,
  dna: FilmDNA,
  choices: z.array(DirectorialChoice),
  moments: z.array(MemorableMoment),
  mechanisms: z.array(Mechanism),
  signatures: z.array(Signature),
  observations: z.array(Observation),
});
export type InterpretationIR = z.infer<typeof InterpretationIR>;

/**
 * What an executor would need to reproduce the observable behaviour.
 *
 * Keyframes and curves here are RECOMMENDED_RECONSTRUCTION, built from the
 * measured tracks and their best fits; each cites what it was built from.
 */
export const ReconstructionKeyframe = z.object({
  frame: z.number().int().nonnegative(),
  value: z.number(),
});

export const ReconstructionIR = z.object({
  strategy: EvidencedString,
  shots: z.array(
    z.object({
      shotId: z.string(),
      layers: z.array(
        z.object({
          objectId: z.string(),
          properties: z.array(
            z.object({
              property: z.string().max(40),
              keyframes: z.array(ReconstructionKeyframe),
              easing: z.string().max(200),
              fitRef: Ref.nullable(),
              provenance: Provenance,
            }),
          ),
        }),
      ),
      camera: z.array(
        z.object({ property: z.string().max(40), keyframes: z.array(ReconstructionKeyframe), easing: z.string().max(200), provenance: Provenance }),
      ),
      audioCues: z.array(z.object({ ref: Ref, at: z.number().int().nonnegative(), note: z.string().max(300) })),
      notes: z.array(z.string().max(600)),
    }),
  ),
  coverage: z.object({
    measuredShare: z.number().min(0).max(1),
    estimatedShare: z.number().min(0).max(1),
    unknownShare: z.number().min(0).max(1),
  }),
});
export type ReconstructionIR = z.infer<typeof ReconstructionIR>;

export const UncertaintyReason = z.enum([
  'unobservable',
  'insufficient_resolution',
  'compression',
  'occlusion',
  'model_disagreement',
  'insufficient_evidence',
  'not_analyzed',
  'no_separation_model',
]);

export const Uncertainty = z.object({
  id: z.string(),
  subjectRefs: z.array(Ref),
  reason: UncertaintyReason,
  impact: z.enum(['low', 'medium', 'high']),
  description: z.string().max(800),
});
export type Uncertainty = z.infer<typeof Uncertainty>;

export const Contradiction = z.object({
  id: z.string(),
  refs: z.array(Ref).min(2),
  description: z.string().max(800),
  resolution: z.enum(['measurement_kept', 'unresolved', 'confidence_reduced']),
  severity: z.enum(['low', 'medium', 'high']),
});
export type Contradiction = z.infer<typeof Contradiction>;

export const UnsupportedHypothesis = z.object({
  id: z.string(),
  claim: z.string().max(1200),
  sourceRef: Ref,
  reason: z.string().max(600),
});
export type UnsupportedHypothesis = z.infer<typeof UnsupportedHypothesis>;
