import { z } from 'zod';
import { Int64String } from '../schema/primitives.ts';

/**
 * The forensic analyzer's report, as this side reads it.
 *
 * It comes from another process in another language, so it is parsed rather
 * than trusted: every index the compiler will dereference, every timestamp it
 * will turn into rational time, is checked here. Times arrive as integers —
 * frame indices and sample indices — and nothing in this file is a time in
 * seconds.
 */
const Num = z.number();
const NumOrNull = z.number().nullable();
const FrameIndex = z.number().int().nonnegative();
const Count = z.number().int().nonnegative();
const Fraction = z.object({ num: z.number().int().positive(), den: z.number().int().positive() });
const Rational = z.object({ ticks: Int64String, timescale: z.number().int().positive() });
const BoxTuple = z.tuple([Num, Num, Num, Num]);

const Fit = z.object({
  model: z.string(),
  parameters: z.record(z.string(), Num),
  from: Num,
  to: Num,
  residualRms: Num,
  rSquared: Num,
  samples: z.number().int().nonnegative(),
  runnerUp: z.object({ model: z.string(), rSquared: Num }).nullable(),
});
export type ForensicFit = z.infer<typeof Fit>;

const Phase = z.object({ kind: z.string(), frame: FrameIndex, value: NumOrNull });

const Animation = z.object({
  // cut: whole on the first frame of its window, which a boundary opens; instant: whole on one frame and absent on the one beside it, inside the shot.
  kind: z.enum(['cut', 'instant', 'measured', 'unmeasured']),
  frames: z.tuple([FrameIndex, FrameIndex]).nullable(),
  durationMs: NumOrNull.optional(),
  translation: z.object({ dx: Num, dy: Num, fromFrame: FrameIndex, toFrame: FrameIndex }).nullable().optional(),
  opacity: z.object({ from: Num, to: Num }).nullable().optional(),
  blur: z.object({ from: Num, to: Num }).nullable().optional(),
  scale: z.object({ from: NumOrNull, to: NumOrNull }).nullable().optional(),
  mask: z.string().nullable().optional(),
  trustedFrames: z.number().int().nullable().optional(),
  fits: z.record(z.string(), Fit).optional(),
});
export type ForensicAnimation = z.infer<typeof Animation>;

const Refinement = z.union([
  z.object({ measured: z.literal(false), reason: z.string() }),
  z.object({
    measured: z.literal(true),
    milestones: z.object({
      firstVisible: FrameIndex.nullable(),
      p10: FrameIndex.nullable(),
      p25: FrameIndex.nullable(),
      p50: FrameIndex.nullable(),
      p75: FrameIndex.nullable(),
      p90: FrameIndex.nullable(),
      settled: FrameIndex.nullable(),
      exitStart: FrameIndex.nullable(),
      lastVisible: FrameIndex.nullable(),
    }),
    cutIn: z.boolean(),
    cutOut: z.boolean(),
    enter: Animation,
    exit: Animation,
    words: z.array(z.object({ text: z.string(), p50: FrameIndex.nullable(), box: BoxTuple })),
    inkColour: z.array(Num).length(3).nullable(),
    samples: z.object({
      frames: z.array(FrameIndex),
      x: z.array(NumOrNull),
      y: z.array(NumOrNull),
      match: z.array(NumOrNull),
      trusted: z.array(z.boolean()),
      opacity: z.array(NumOrNull),
      blur: z.array(NumOrNull),
      inkBox: z.array(BoxTuple.nullable()),
    }),
    window: z.tuple([FrameIndex, FrameIndex]),
  }),
]);

const Glyph = z.object({ char: z.string(), box: BoxTuple });

/** Where a line's type sits and how it is drawn, on its reference frame; see type_geometry in text.py. */
const Geometry = z.object({
  baselineY: Num,
  capHeightPx: NumOrNull,
  xHeightPx: NumOrNull,
  ascenderPx: NumOrNull,
  descenderPx: NumOrNull,
  stemPx: NumOrNull,
  samples: z.object({ baseline: Count, cap: Count, x: Count, stems: Count }),
  /** How many glyphs of each class agree on the edge reported: one is enough where it was read from its own ink. */
  agreeing: z.object({ baseline: Count, cap: Count, x: Count, ascender: Count, descender: Count }),
  spread: z.record(z.string(), Num),
  /** Of the line's letters, how many were read from their own ink rather than from the middle of the recogniser's box. */
  lettersFromInk: Count,
  letters: Count,
});
export type ForensicGeometry = z.infer<typeof Geometry>;

const TextLine = z.object({
  text: z.string(),
  score: Num,
  readings: z.array(z.object({ frame: FrameIndex, text: z.string(), score: Num, box: BoxTuple })),
  firstRead: FrameIndex,
  lastRead: FrameIndex,
  referenceFrame: FrameIndex,
  referenceBox: BoxTuple,
  referencePoly: z.array(z.tuple([Num, Num])).length(4),
  variants: z.array(z.string()),
  refinement: Refinement.nullable(),
  glyphs: z.array(Glyph),
  words: z.array(z.object({ text: z.string(), box: BoxTuple, glyphs: z.array(Glyph) })),
  /** Null where the type could not be measured; absent from reports older than 1.3.0. */
  geometry: Geometry.nullable().optional(),
});
export type ForensicTextLine = z.infer<typeof TextLine>;

const Boundary = z.object({
  kind: z.enum(['hard_cut', 'fade_out', 'fade_in', 'dip_to_colour', 'dissolve']),
  lastOutgoing: FrameIndex,
  firstIncoming: FrameIndex,
  span: z.tuple([FrameIndex, FrameIndex]),
  scores: z.record(z.string(), z.unknown()),
});
export type ForensicBoundary = z.infer<typeof Boundary>;

const CameraMove = z.object({
  shot: z.number().int().nonnegative(),
  first: FrameIndex,
  last: FrameIndex,
  type: z.string(),
  translation: Num,
  scaleRatio: NumOrNull,
  rotation: Num,
  peakSpeed: NumOrNull,
  dominantProperty: z.string(),
  phases: z.array(Phase),
  fit: Fit.nullable(),
  observability: z.string(),
});

const Panel = z.object({
  shot: z.number().int().nonnegative(),
  referenceFrame: FrameIndex,
  referenceBox: BoxTuple,
  frames: z.array(FrameIndex),
  x: z.array(NumOrNull),
  y: z.array(NumOrNull),
  width: z.array(NumOrNull),
  height: z.array(NumOrNull),
  cx: z.array(NumOrNull),
  cy: z.array(NumOrNull),
  scale: z.array(NumOrNull),
  occupancy: z.array(NumOrNull),
  match: z.array(NumOrNull),
  phases: z.array(Phase),
  fits: z.record(z.string(), Fit),
});
export type ForensicPanel = z.infer<typeof Panel>;

const AudioEvent = z.object({
  kind: z.enum(['onset', 'transient']),
  sample: z.number().int().nonnegative(),
  hop: z.number().int().nonnegative(),
  magnitude: Num,
  decayDb: Num,
  highShare: Num,
  centroidHz: Num,
});

const Audio = z.object({
  rate: z.number().int().positive(),
  channels: z.number().int().positive(),
  samples: z.number().int().nonnegative(),
  firstPts: Int64String.nullable(),
  timebase: Fraction,
  gaps: z.array(z.object({ expectedPts: Int64String, pts: Int64String })),
  hop: z.number().int().positive(),
  window: z.number().int().positive(),
  series: z.record(z.string(), z.array(NumOrNull)),
  events: z.array(AudioEvent),
  silences: z.array(z.object({ startSample: z.number().int().nonnegative(), endSample: z.number().int().nonnegative(), levelDb: Num })),
  voiceSpans: z.array(z.object({ startSample: z.number().int().nonnegative(), endSample: z.number().int().nonnegative(), meanProbability: Num })),
  ducking: z.array(z.object({ startSample: z.number().int().nonnegative(), endSample: z.number().int().nonnegative(), depthDb: Num })),
  tempo: z.object({ bpm: NumOrNull, strength: Num }),
  beats: z.array(z.object({ sample: z.number().int().nonnegative(), snapped: z.boolean() })),
  downbeat: z.object({ phase: z.number().int().min(0).max(3), contrast: Num }).nullable(),
  key: z.object({ key: z.string(), correlation: Num, margin: Num, runnerUp: z.string() }).nullable(),
  loudness: z.object({
    ok: z.boolean(),
    blockIndices: z.array(z.number().int().nonnegative()),
    momentary: z.array(NumOrNull),
    shortTerm: z.array(NumOrNull),
    integratedLufs: NumOrNull,
    loudnessRangeLu: NumOrNull,
    truePeakDbtp: NumOrNull,
    samplePeakDbfs: NumOrNull,
  }),
});
export type ForensicAudio = z.infer<typeof Audio>;

const StreamVideo = z.object({
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
  timebase: Fraction,
  averageFrameRate: Fraction.nullable(),
  baseFrameRate: Fraction.nullable(),
  startPts: Int64String.nullable(),
  declaredFrameCount: z.number().int().nonnegative().nullable(),
  declaredDuration: Rational.nullable(),
  bitRate: z.number().int().nonnegative().nullable(),
  rotationDegrees: z.number().nullable(),
  tags: z.record(z.string(), z.string()),
});

const StreamAudio = z.object({
  index: z.number().int().nonnegative(),
  codec: z.string(),
  profile: z.string().nullable(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  channelLayout: z.string().nullable(),
  sampleFormat: z.string().nullable(),
  timebase: Fraction,
  startPts: Int64String.nullable(),
  declaredDuration: Rational.nullable(),
  bitRate: z.number().int().nonnegative().nullable(),
});

/** What the container says about the file, before a single frame is decoded. */
export const ForensicProbe = z.object({
  formatName: z.string(),
  formatLongName: z.string().nullable(),
  containerDuration: Rational.nullable(),
  containerBitRate: z.number().int().nullable(),
  tags: z.record(z.string(), z.string()),
  video: StreamVideo,
  audio: z.array(StreamAudio),
  other: z.array(z.object({ index: z.number().int(), kind: z.string(), codec: z.string().nullable() })),
});
export type ForensicProbe = z.infer<typeof ForensicProbe>;

export const ForensicReport = z
  .object({
    analyzer: z.object({
      name: z.literal('actone-forensics'),
      version: z.string(),
      python: z.string(),
      numpy: z.string(),
      opencv: z.string(),
      pyav: z.string(),
      ffmpeg: z.string().nullable(),
      ocr: z.string().nullable(),
      seconds: Num,
    }),
    input: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().positive(), filename: z.string() }),
    probe: ForensicProbe,
    video: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      work: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
      flow: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
      colour: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
      assumedMatrix: z.string().nullable(),
      measuredRate: z
        .object({
          num: z.number().int().positive(),
          den: z.number().int().positive(),
          distinct: z.array(z.object({ ticks: Int64String, count: z.number().int().positive() })),
        })
        .nullable(),
      ocrStride: z.number().int().positive().nullable(),
      ocrFrames: z.number().int().nonnegative(),
    }),
    frames: z.object({
      count: z.number().int().nonnegative(),
      pts: z.array(Int64String),
      durations: z.array(Int64String.nullable()),
      keyframe: z.array(z.boolean()),
      pictureType: z.array(z.string()),
      hash: z.array(z.string().regex(/^[0-9a-f]{32}$/)),
      repeatOf: z.array(FrameIndex.nullable()),
      features: z.record(z.string(), z.array(NumOrNull)),
      vectors: z.object({
        hue_histogram: z.array(z.array(NumOrNull).length(12)),
        dominant_colours: z.array(z.array(z.array(NumOrNull).length(4))),
        border_rgb: z.array(z.array(NumOrNull).length(3)),
      }),
    }),
    boundaries: z.array(Boundary),
    shots: z.array(z.tuple([FrameIndex, FrameIndex])),
    shotColours: z.array(z.array(z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/), share: Num }))),
    fieldChanges: z.array(z.object({ frame: FrameIndex, deltaE: Num, fromRgb: z.array(Num), toRgb: z.array(Num) })),
    camera: z.object({
      samples: z.record(z.string(), z.array(NumOrNull)),
      shots: z.array(
        z.object({
          shot: z.number().int().nonnegative(),
          observability: z.enum(['observable', 'partial', 'unobservable']),
          reason: z.string(),
          confidence: Num,
          brokenAt: FrameIndex.nullable(),
        }),
      ),
      moves: z.array(CameraMove),
    }),
    text: z.object({
      stride: z.number().int().positive(),
      framesRead: z.number().int().nonnegative(),
      lines: z.array(TextLine),
      blocks: z.array(z.array(z.number().int().nonnegative())),
    }),
    panels: z.array(Panel),
    audio: Audio.nullable(),
    warnings: z.array(z.string()),
  })
  .superRefine((report, context) => {
    /*
     * Every per-frame column has one entry per frame, and every frame index the
     * report mentions points at a frame that exists. The compiler dereferences
     * these without checking again.
     */
    const n = report.frames.count;
    const columns: [string, unknown[]][] = [
      ['pts', report.frames.pts],
      ['durations', report.frames.durations],
      ['keyframe', report.frames.keyframe],
      ['pictureType', report.frames.pictureType],
      ['hash', report.frames.hash],
      ['repeatOf', report.frames.repeatOf],
      ...Object.entries(report.frames.features).map(([name, values]) => [`features.${name}`, values] as [string, unknown[]]),
      ['hue_histogram', report.frames.vectors.hue_histogram],
      ['dominant_colours', report.frames.vectors.dominant_colours],
      ['border_rgb', report.frames.vectors.border_rgb],
      ...Object.entries(report.camera.samples).map(([name, values]) => [`camera.${name}`, values] as [string, unknown[]]),
    ];
    for (const [name, values] of columns) {
      if (values.length !== n) context.addIssue({ code: 'custom', message: `${name} has ${values.length} entries for ${n} frames` });
    }
    const outOfRange = (frame: number) => frame >= n;
    for (const [a, b] of report.shots) if (outOfRange(a) || outOfRange(b) || a > b) context.addIssue({ code: 'custom', message: `shot [${a}, ${b}] is not inside ${n} frames` });
    for (const boundary of report.boundaries) {
      if (outOfRange(boundary.lastOutgoing) || outOfRange(boundary.firstIncoming)) context.addIssue({ code: 'custom', message: `a boundary points past the last frame` });
    }
    for (const line of report.text.lines) {
      if (outOfRange(line.referenceFrame) || outOfRange(line.lastRead)) context.addIssue({ code: 'custom', message: `the line "${line.text.slice(0, 40)}" points past the last frame` });
    }
    for (const block of report.text.blocks) {
      for (const index of block) if (index >= report.text.lines.length) context.addIssue({ code: 'custom', message: `a text block names line ${index}, which does not exist` });
    }
    if (report.audio) {
      for (const event of report.audio.events) {
        if (event.sample > report.audio.samples) context.addIssue({ code: 'custom', message: `an audio event at sample ${event.sample} is past the end of the audio` });
      }
    }
  });
export type ForensicReport = z.infer<typeof ForensicReport>;
