import { z } from 'zod';
import { Box, CurveFit, EvidencedNumber, EvidencedString, EvidencedTime, FrameSpan, Provenance, Ref, evidenced } from './primitives.ts';

/**
 * Type on screen, block → line → word → glyph.
 *
 * Text is found by an OCR model and then measured on the frames: where it
 * sits, when it becomes visible, how it arrives. The OCR's reading is MEASURED
 * with its own confidence; a second reading by the multimodal model is used to
 * corroborate it, never to overwrite it. The font family is left UNKNOWN unless
 * something in the evidence names it — a face that merely looks like Inter is
 * not Inter.
 */
export const TextClass = z.enum(['narration_subtitle', 'editorial_copy', 'product_copy', 'decorative', 'unknown']);
export type TextClass = z.infer<typeof TextClass>;

export const SpeechRelation = z.enum([
  'REPEATS',
  'COMPLEMENTS',
  'PRECEDES',
  'FOLLOWS',
  'CONTRADICTS',
  'SUMMARIZES',
  'INDEPENDENT',
]);
export type SpeechRelation = z.infer<typeof SpeechRelation>;

export const TextGlyph = z.object({ id: z.string(), char: z.string().max(4), box: Box, provenance: Provenance });

export const TextWord = z.object({
  id: z.string(),
  text: z.string().max(200),
  box: Box,
  provenance: Provenance,
  glyphs: z.array(TextGlyph).default([]),
});

export const TextLine = z.object({
  id: z.string(),
  text: EvidencedString,
  box: Box,
  /** The polygon the detector returned: four corners, clockwise from top-left. */
  polygon: z.array(z.number()).length(8).nullable().default(null),
  baselineY: EvidencedNumber,
  words: z.array(TextWord).default([]),
});

/** The milestones of an appearance, each on the frame grid. */
export const TextTiming = z.object({
  firstVisible: EvidencedTime,
  p10: EvidencedTime,
  p25: EvidencedTime,
  p50: EvidencedTime,
  p75: EvidencedTime,
  p90: EvidencedTime,
  settled: EvidencedTime,
  exitStart: EvidencedTime,
  lastVisible: EvidencedTime,
});
export type TextTiming = z.infer<typeof TextTiming>;

export const TextAnimation = z.object({
  translation: evidenced(z.object({ dx: z.number(), dy: z.number() })),
  scale: evidenced(z.object({ from: z.number(), to: z.number() })),
  opacity: evidenced(z.object({ from: z.number(), to: z.number() })),
  blur: evidenced(z.object({ from: z.number(), to: z.number() })),
  rotation: evidenced(z.object({ from: z.number(), to: z.number() })),
  mask: EvidencedString,
  stagger: evidenced(
    z.object({
      unit: z.enum(['block', 'line', 'word', 'glyph']),
      intervalsMs: z.array(z.number()),
    }),
  ),
  durationMs: EvidencedNumber,
  fits: z.array(CurveFit).default([]),
});
export type TextAnimation = z.infer<typeof TextAnimation>;

export const TextBlock = z.object({
  id: z.string().regex(/^text\.[0-9]{4}$/),
  /** The line objects this block is made of, top to bottom. */
  objectIds: z.array(z.string()).min(1),
  text: EvidencedString,
  language: EvidencedString,
  classification: evidenced(TextClass),
  frames: FrameSpan,
  referenceFrame: z.number().int().nonnegative(),
  box: Box,
  lines: z.array(TextLine),
  metrics: z.object({
    capHeightPx: EvidencedNumber,
    approxSizePx: EvidencedNumber,
    approxWeight: EvidencedNumber,
    trackingEm: EvidencedNumber,
    lineSpacingPx: EvidencedNumber,
    alignment: evidenced(z.enum(['left', 'center', 'right', 'justified'])),
    colour: EvidencedString,
    fontFamily: EvidencedString,
    fontCategory: EvidencedString,
  }),
  timing: TextTiming,
  enter: TextAnimation,
  exit: TextAnimation,
  speech: z.object({
    relation: evidenced(SpeechRelation),
    wordRefs: z.array(Ref),
    /** Text half-visible minus the matched speech's start. Negative: the type leads the voice. */
    offset: EvidencedTime,
  }),
});
export type TextBlock = z.infer<typeof TextBlock>;

export const TypographyIR = z.object({
  blocks: z.array(TextBlock),
  /** How the OCR was run: which frames, at what resolution. */
  coverage: z.object({
    framesRead: z.number().int().nonnegative(),
    stride: z.number().int().positive(),
    readSpan: FrameSpan.nullable(),
    provenance: Provenance,
  }),
});
export type TypographyIR = z.infer<typeof TypographyIR>;
