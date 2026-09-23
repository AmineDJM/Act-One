import { z } from 'zod';
import {
  Box,
  CurveFit,
  EvidencedRange,
  EvidencedString,
  FrameSpan,
  Point,
  Provenance,
  RationalTime,
  Ref,
  TimeRange,
  evidenced,
} from './primitives.ts';

/**
 * How the film is cut and put together.
 *
 * Shots and boundaries are measured on the frames: a boundary is the pair of
 * frames either side of it, and what changed between them. Scenes, beats and
 * the meaning of a transition are interpretations, kept apart from the
 * measurement they rest on.
 */
export const BoundaryKind = z.enum([
  'hard_cut',
  'dissolve',
  'fade_out',
  'fade_in',
  'dip_to_colour',
  'wipe',
  'push',
  'whip',
  'zoom_through',
  'morph',
  'match_cut',
  'unknown',
]);
export type BoundaryKind = z.infer<typeof BoundaryKind>;

/** What a boundary does, as a director would say it. Several can hold at once. */
export const HandoverKind = z.enum([
  'preservation',
  'transformation',
  'semantic_handover',
  'motion_handover',
  'attention_handover',
  'sound_bridge',
  'deliberate_rupture',
]);
export type HandoverKind = z.infer<typeof HandoverKind>;

/** One side of a boundary, measured on its frame. */
export const BoundaryState = z.object({
  frame: z.number().int().nonnegative(),
  attention: Point.nullable(),
  motion: z.object({ dx: z.number(), dy: z.number() }).nullable(),
  cameraScale: z.number().nullable(),
  lumaMean: z.number().nullable(),
  dominantColours: z.array(z.string().regex(/^#[0-9a-f]{6}$/)),
  textPresent: z.boolean().nullable(),
  audioLevelDb: z.number().nullable(),
  voiceActive: z.boolean().nullable(),
  /** Where the music is in its bar, 0..1, when a beat grid exists. */
  musicalPhase: z.number().nullable(),
  productBox: Box.nullable(),
});
export type BoundaryState = z.infer<typeof BoundaryState>;

export const Boundary = z.object({
  id: z.string().regex(/^boundary\.[0-9]{3,4}$/),
  kind: evidenced(BoundaryKind),
  /** The first frame of what comes after. For a gradual change, `span` covers the whole change. */
  at: RationalTime,
  frames: z.object({ lastOutgoing: z.number().int().nonnegative(), firstIncoming: z.number().int().nonnegative() }),
  span: FrameSpan,
  range: TimeRange,
  outgoing: BoundaryState,
  incoming: BoundaryState,
  /** Incoming minus outgoing, per measure. What survived the boundary and what did not. */
  residuals: z.record(z.string(), z.number().nullable()),
  measurement: Provenance,
  handover: evidenced(z.array(HandoverKind)),
  description: EvidencedString.nullable().default(null),
});
export type Boundary = z.infer<typeof Boundary>;

export const Shot = z.object({
  id: z.string().regex(/^shot\.[0-9]{3,4}$/),
  index: z.number().int().nonnegative(),
  frames: FrameSpan,
  range: TimeRange,
  boundaryIn: z.string().nullable(),
  boundaryOut: z.string().nullable(),
  measurement: Provenance,
  dominantColours: z.array(z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/), share: z.number().min(0).max(1) })),
  meanMotion: z.number().nullable(),
  objectIds: z.array(z.string()),
  cameraMoveIds: z.array(z.string()),
  description: EvidencedString.nullable().default(null),
});
export type Shot = z.infer<typeof Shot>;

export const Scene = z.object({
  id: z.string(),
  range: EvidencedRange,
  shotIds: z.array(z.string()),
  label: EvidencedString,
});

export const Beat = z.object({
  id: z.string().regex(/^beat\.[0-9]{3}$/),
  range: EvidencedRange,
  function: EvidencedString,
  summary: EvidencedString,
  shotIds: z.array(z.string()),
  refs: z.array(Ref),
});
export type Beat = z.infer<typeof Beat>;

export const Transition = z.object({
  id: z.string(),
  /** The measured boundary it happens at, or null for a change of idea with no boundary at all. */
  boundaryId: z.string().nullable(),
  range: EvidencedRange,
  handover: evidenced(z.array(HandoverKind)),
  technique: EvidencedString,
  curve: CurveFit.nullable().default(null),
  description: EvidencedString,
});

export const StructureIR = z.object({
  shots: z.array(Shot),
  boundaries: z.array(Boundary),
  scenes: z.array(Scene),
  beats: z.array(Beat),
  transitions: z.array(Transition),
});
export type StructureIR = z.infer<typeof StructureIR>;

/**
 * The event graph: every moment the film does something, in any modality,
 * on one timeline, and the measured offsets between moments that belong
 * together. The offsets matter more than any count of events.
 */
export const Modality = z.enum([
  'visual',
  'camera',
  'typography',
  'product',
  'motion',
  'narration',
  'music',
  'sfx',
  /** A sound event not attributed to voice, music or effects: an onset, a silence. */
  'audio',
  'attention',
]);
export type Modality = z.infer<typeof Modality>;

export const AVEvent = z.object({
  id: z.string().regex(/^evt\.[0-9]{4,5}$/),
  modality: Modality,
  type: z.string().max(80),
  start: RationalTime,
  peak: RationalTime.nullable().default(null),
  end: RationalTime.nullable().default(null),
  magnitude: z.number().nullable().default(null),
  unit: z.string().max(40).default(''),
  /** The time resolution the event was observed at: one frame, one sample, one analysis hop. */
  resolution: RationalTime,
  subjectRefs: z.array(Ref),
  provenance: Provenance,
});
export type AVEvent = z.infer<typeof AVEvent>;

export const EventAnchor = z.enum(['start', 'peak', 'end']);

export const AVRelation = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  fromAnchor: EventAnchor,
  toAnchor: EventAnchor,
  /** to − from, exactly, on the finer of the two clocks. */
  offset: RationalTime,
  /** The sum of the two events' resolutions: an offset is never more precise than this. */
  uncertainty: RationalTime,
  kind: z.enum(['coincident', 'precedes', 'follows']),
  provenance: Provenance,
});
export type AVRelation = z.infer<typeof AVRelation>;

/** Events that land together, anchored on one and measured against it. */
export const SyncCluster = z.object({
  id: z.string(),
  anchor: z.string(),
  members: z.array(z.object({ eventId: z.string(), offset: RationalTime })),
  spread: RationalTime,
  interpretation: EvidencedString.nullable().default(null),
});
export type SyncCluster = z.infer<typeof SyncCluster>;

export const EventGraph = z.object({
  events: z.array(AVEvent),
  relations: z.array(AVRelation),
  clusters: z.array(SyncCluster),
});
export type EventGraph = z.infer<typeof EventGraph>;
