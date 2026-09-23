import { z } from 'zod';
import { Int64String, Provenance, RationalTime, Series, VectorSeries } from './primitives.ts';

/**
 * What the file is, as the file says it — every field here is SOURCE_EXACT,
 * read from the container and the decoder, and nothing is guessed. The
 * encoder tag in particular is what the file claims, not evidence of which
 * software made the film.
 */
export const StreamTimebase = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const VideoStreamInfo = z.object({
  index: z.number().int().nonnegative(),
  codec: z.string(),
  profile: z.string().nullable(),
  level: z.number().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sampleAspectRatio: z.string().nullable(),
  displayAspectRatio: z.string().nullable(),
  pixelFormat: z.string().nullable(),
  bitDepth: z.number().int().nullable(),
  colorRange: z.string().nullable(),
  colorPrimaries: z.string().nullable(),
  colorTransfer: z.string().nullable(),
  colorSpace: z.string().nullable(),
  timebase: StreamTimebase,
  /** As declared by the container. Not the measured rate: that is `frameTiming`. */
  averageFrameRate: StreamTimebase.nullable(),
  baseFrameRate: StreamTimebase.nullable(),
  startPts: Int64String.nullable(),
  declaredFrameCount: z.number().int().nonnegative().nullable(),
  declaredDuration: RationalTime.nullable(),
  bitRate: z.number().int().nonnegative().nullable(),
  rotationDegrees: z.number().nullable(),
});

export const AudioStreamInfo = z.object({
  index: z.number().int().nonnegative(),
  codec: z.string(),
  profile: z.string().nullable(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  channelLayout: z.string().nullable(),
  sampleFormat: z.string().nullable(),
  timebase: StreamTimebase,
  startPts: Int64String.nullable(),
  declaredDuration: RationalTime.nullable(),
  bitRate: z.number().int().nonnegative().nullable(),
  /** Samples actually decoded, which is the audio's real length. */
  decodedSamples: z.number().int().nonnegative(),
});

export const SourceInfo = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  filename: z.string().max(400),
  formatName: z.string(),
  formatLongName: z.string().nullable(),
  containerDuration: RationalTime.nullable(),
  containerBitRate: z.number().int().nonnegative().nullable(),
  /** Container and stream tags, verbatim. What the file says about itself, not a finding. */
  tags: z.record(z.string(), z.string().max(400)),
  video: VideoStreamInfo.nullable(),
  audio: z.array(AudioStreamInfo),
  otherStreams: z.array(z.object({ index: z.number().int(), kind: z.string(), codec: z.string().nullable() })),
  /** Measured from the decoded timestamps: a constant rate is a finding, not an assumption. */
  frameTiming: z
    .object({
      decodedFrames: z.number().int().nonnegative(),
      variableFrameRate: z.boolean(),
      distinctDurations: z.array(z.object({ ticks: Int64String, count: z.number().int().positive() })),
      /** Frames whose decoded pixels are identical to the frame before. */
      repeatedFrames: z.number().int().nonnegative(),
      firstPts: RationalTime.nullable(),
      lastPtsEnd: RationalTime.nullable(),
    })
    .nullable(),
});
export type SourceInfo = z.infer<typeof SourceInfo>;

/** What a plan is to be rendered as. The same document, with a target instead of a source. */
export const RenderTarget = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: StreamTimebase,
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  duration: RationalTime,
});
export type RenderTarget = z.infer<typeof RenderTarget>;

/**
 * A method, registered once and cited everywhere it was used.
 *
 * Deterministic methods name their algorithm and parameters so a value can be
 * recomputed; model methods name the model, which is the most anyone can say.
 */
export const Method = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/),
  kind: z.enum(['container', 'decoder', 'signal', 'vision', 'ocr', 'asr', 'model', 'derivation', 'integration', 'authoring']),
  name: z.string().max(200),
  version: z.string().max(80),
  deterministic: z.boolean(),
  description: z.string().max(1200),
  parameters: z.record(z.string(), z.unknown()).default({}),
  citation: z.string().max(300).nullable().default(null),
});
export type Method = z.infer<typeof Method>;

/** A run that produced part of the document: the analyzer, a model pass, the compiler. */
export const Producer = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/),
  kind: z.enum(['analyzer', 'asr', 'model_pass', 'inspection', 'integrator', 'compiler', 'validator', 'author']),
  name: z.string().max(200),
  version: z.string().max(80),
  model: z.string().max(120).nullable().default(null),
  status: z.enum(['completed', 'partial', 'failed', 'skipped']),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  /** Hash of everything the run was given, so a rerun with the same inputs can be recognised. */
  inputHash: z.string().nullable().default(null),
  costUsd: z.number().nonnegative().nullable().default(null),
  notes: z.array(z.string().max(600)).default([]),
});
export type Producer = z.infer<typeof Producer>;

/**
 * The film, frame by frame.
 *
 * One row per decoded frame, stored as columns: timestamps exactly as the
 * stream carries them, then every per-frame measurement as a curve sampled on
 * the frames. Nothing here is interpolated — a frame the analyzer could not
 * read is null in every feature and says why.
 */
export const FrameTable = z.object({
  count: z.number().int().nonnegative(),
  /** Seconds = pts / timescale for every entry below. */
  timescale: z.number().int().positive(),
  pts: z.array(Int64String),
  /** Null only where the stream leaves a frame's duration unset — in practice the last frame of some files. */
  durations: z.array(Int64String.nullable()),
  keyframe: z.array(z.boolean()),
  pictureType: z.array(z.enum(['I', 'P', 'B', 'S', 'SI', 'SP', 'BI', '?'])),
  /** Content hash of the decoded frame at native resolution. Equal hashes, identical pictures. */
  decodedHash: z.array(z.string().regex(/^[0-9a-f]{16,64}$/)),
  repeatOf: z.array(z.number().int().nonnegative().nullable()),
  analysis: z.object({
    workingWidth: z.number().int().positive(),
    workingHeight: z.number().int().positive(),
    colour: z.string().max(200),
    provenance: Provenance,
  }),
  features: z.array(Series),
  vectors: z.array(VectorSeries),
});
export type FrameTable = z.infer<typeof FrameTable>;
