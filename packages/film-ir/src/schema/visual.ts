import { z } from 'zod';
import {
  Box,
  CurveFit,
  EvidencedNumber,
  EvidencedString,
  FrameSpan,
  MotionPhase,
  Point,
  Provenance,
  RationalTime,
  Ref,
  TimeRange,
  evidenced,
} from './primitives.ts';

/**
 * What is on screen, and how it moves.
 *
 * Objects have structural ids that a re-analysis of the same file reproduces
 * (`obj.text.0003`); a semantic name such as `editorial.headline.02` is a
 * separate, inferred label. Geometry is measured on the frames; opacity and
 * blur are measured relative to the object's own settled appearance, because
 * an absolute opacity cannot be read off a composited picture.
 */
export const ObjectKind = z.enum([
  'text_line',
  'text_block',
  'ui_window',
  'ui_panel',
  'ui_element',
  'image',
  'shape',
  'logo',
  'cursor',
  'device',
  'person',
  'background',
  'unknown',
]);
export type ObjectKind = z.infer<typeof ObjectKind>;

/** Per-frame columns an object track may carry. Every column is optional; each present one has provenance. */
export const TrackColumn = z.enum([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'occupancy',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'blur',
  'match',
  'vx',
  'vy',
  'speed',
  'ax',
  'ay',
  'acceleration',
]);
export type TrackColumn = z.infer<typeof TrackColumn>;

export const TrackedObject = z.object({
  id: z.string().regex(/^obj\.[a-z_]+\.[0-9]{4,5}$/),
  kind: ObjectKind,
  kindProvenance: Provenance,
  name: EvidencedString.nullable().default(null),
  role: EvidencedString.nullable().default(null),
  detection: Provenance,
  frames: FrameSpan,
  shotIds: z.array(z.string()),
  parentId: z.string().nullable().default(null),
  /** Frame indices the columns are sampled on; each column has one value per entry. */
  sampleFrames: z.array(z.number().int().nonnegative()),
  columns: z.partialRecord(TrackColumn, z.array(z.number().nullable())),
  columnProvenance: z.partialRecord(TrackColumn, Provenance),
  /** Four corners per sample, clockwise from top-left, when a perspective fit exists. */
  corners: z.array(z.array(z.number()).length(8).nullable()).nullable().default(null),
  zOrder: evidenced(z.number().int()).nullable().default(null),
  occludedFrames: z.array(z.number().int().nonnegative()).default([]),
  phases: z.array(MotionPhase).default([]),
  fits: z.array(CurveFit).default([]),
  /** The frame whose appearance the relative measurements are taken against. */
  referenceFrame: z.number().int().nonnegative().nullable().default(null),
  referenceBox: Box.nullable().default(null),
});
export type TrackedObject = z.infer<typeof TrackedObject>;

export const CameraObservability = z.enum(['observable', 'partial', 'unobservable']);

export const CameraMoveType = z.enum([
  'static',
  'pan',
  'tilt',
  'zoom_in',
  'zoom_out',
  'roll',
  'pan_and_zoom',
  'shake',
  'complex',
]);

export const CameraMove = z.object({
  id: z.string(),
  shotId: z.string(),
  frames: FrameSpan,
  range: TimeRange,
  type: evidenced(CameraMoveType),
  translationPx: EvidencedNumber,
  scaleRatio: EvidencedNumber,
  rotationDegrees: EvidencedNumber,
  peakSpeedPxPerSecond: EvidencedNumber,
  phases: z.array(MotionPhase).default([]),
  fits: z.array(CurveFit).default([]),
  description: EvidencedString.nullable().default(null),
});
export type CameraMove = z.infer<typeof CameraMove>;

/**
 * The apparent camera.
 *
 * In a motion-design film there often is no camera: a panel sliding over a
 * flat field moves exactly as a camera panning over a fixed panel would. The
 * two are told apart only where the background carries texture that can be
 * tracked; where it does not, the camera is unobservable and says so, and the
 * motion is attributed to the objects instead of being invented for a camera.
 */
export const CameraTrack = z.object({
  model: z.string().max(300),
  shots: z.array(
    z.object({
      shotId: z.string(),
      observability: CameraObservability,
      reason: z.string().max(400),
      confidence: z.number().min(0).max(1),
    }),
  ),
  /** Per-frame pose relative to the first frame of its shot; resets at each cut. */
  sampleFrames: z.array(z.number().int().nonnegative()),
  columns: z.record(
    z.enum(['tx', 'ty', 'scale', 'rotation', 'perspectiveX', 'perspectiveY', 'residual', 'inliers', 'coverage', 'vx', 'vy', 'vscale', 'speed', 'acceleration']),
    z.array(z.number().nullable()),
  ),
  columnProvenance: z.record(z.string(), Provenance),
  moves: z.array(CameraMove),
  focalLength: EvidencedNumber,
  vanishingPoint: evidenced(Point),
});
export type CameraTrack = z.infer<typeof CameraTrack>;

export const DepthLayer = z.object({
  id: z.string(),
  label: z.enum(['foreground', 'midground', 'background']),
  shotId: z.string(),
  objectIds: z.array(z.string()),
  /** Mean speed relative to the slowest layer of the shot. Parallax shows up as a ratio above one. */
  relativeSpeed: EvidencedNumber,
});

export const DepthIR = z.object({
  layers: z.array(DepthLayer),
  provenance: Provenance,
});
export type DepthIR = z.infer<typeof DepthIR>;

export const AttentionShift = z.object({
  id: z.string(),
  frame: z.number().int().nonnegative(),
  at: RationalTime,
  from: Point,
  to: Point,
  distance: z.number().nonnegative(),
  cause: EvidencedString.nullable().default(null),
  provenance: Provenance,
});

export const AttentionIR = z.object({
  /** Series ids in the frame table that carry the per-frame attention estimate. */
  centroidSeries: z.array(z.string()),
  shifts: z.array(AttentionShift),
  provenance: Provenance,
});
export type AttentionIR = z.infer<typeof AttentionIR>;

export const ProductRegionKind = z.enum([
  'window',
  'panel',
  'card',
  'sidebar',
  'toolbar',
  'table',
  'chart',
  'form',
  'modal',
  'button',
  'list',
  'editor',
  'unknown',
]);

export const ProductRegion = z.object({
  id: z.string(),
  objectId: z.string().nullable(),
  kind: evidenced(ProductRegionKind),
  label: EvidencedString,
  frames: FrameSpan,
  box: Box.nullable(),
});

export const ProductMoment = z.object({
  id: z.string(),
  range: TimeRange,
  description: EvidencedString,
  regionIds: z.array(z.string()),
  refs: z.array(Ref),
});

export const ProductIR = z.object({
  /** Is the film about a software product at all, and is its interface shown. */
  interfaceShown: evidenced(z.boolean()),
  regions: z.array(ProductRegion),
  moments: z.array(ProductMoment),
  /** Series id of the per-frame share of the picture that is product interface. */
  occupancySeries: z.string().nullable(),
});
export type ProductIR = z.infer<typeof ProductIR>;
