import type { Standard } from './standard.ts';

/**
 * Colour law.
 *
 * Contrast is the only part of graphic design with a real international
 * standard behind it, and it happens to be the part that most often ruins an
 * otherwise good frame: a brand accent that looks superb as a button is
 * frequently unreadable as 120px display type on the brand's own canvas.
 */
export const COLOR_STANDARDS = {
  textContrast: {
    id: 'color.text_contrast',
    rule: 'Body-sized text holds at least 4.5:1 against what is behind it.',
    source: 'WCAG 2.2',
    clause: 'SC 1.4.3 (Contrast Minimum, AA)',
    authority: 'normative',
    enforcement: 'checked',
    because:
      'It is the ratio at which text stays readable for low vision and in poor viewing conditions — ' +
      'which, for a film, includes a phone in daylight.',
  },
  largeTextContrast: {
    id: 'color.large_text_contrast',
    rule: 'Large text holds at least 3:1.',
    source: 'WCAG 2.2',
    clause: 'SC 1.4.3, large-scale definition',
    authority: 'normative',
    enforcement: 'checked',
    because: 'Larger glyphs carry more of their own contrast through stroke weight.',
  },
  nonTextContrast: {
    id: 'color.non_text_contrast',
    rule: 'Graphics carrying meaning — rules, bars, indicators — hold at least 3:1.',
    source: 'WCAG 2.2',
    clause: 'SC 1.4.11 (Non-text Contrast, AA)',
    authority: 'normative',
    // Designed in at token resolution: the accent that draws every meaningful
    // mark — the metric highlight, the cursor's click, the bar in a chart — is
    // corrected against the canvas to 3:1 before any scene sees it. Hairlines
    // and surfaces are decoration and are allowed to be quiet.
    enforcement: 'designed_in',
    because: 'A chart nobody can see is a decoration.',
  },
  accentRestraint: {
    id: 'color.accent_restraint',
    rule: 'One accent, used structurally. Two at most, and never as a gradient between them.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'designed_in',
    because:
      'The purple-to-blue gradient is the visual signature of automated design. ' +
      "Restraint is what makes a frame read as a decision rather than a default.",
  },
  distribution: {
    id: 'color.distribution',
    rule: 'Roughly 60% canvas, 30% secondary, 10% accent across a frame.',
    source: 'Interior-design convention, adopted by graphic design',
    authority: 'convention',
    enforcement: 'checked',
    because:
      'An accent stops working as an accent once it covers a third of the frame — ' +
      'it becomes the canvas, and whatever it was pointing at loses its emphasis.',
  },
  brandFidelity: {
    id: 'color.brand_fidelity',
    rule: 'Colours are measured from the product, never invented near it.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'designed_in',
    because:
      "A film in colours the customer has never used is a film about a company that does not exist. " +
      'When a measured colour fails contrast it is corrected along lightness, which keeps the hue.',
  },
  broadcastRange: {
    id: 'color.broadcast_range',
    rule: 'Deliverables stay inside the studio range: no blacker than 16 and no whiter than 235 in 8-bit.',
    source: 'ITU-R BT.709 / EBU R 103',
    clause: 'signal tolerance',
    authority: 'normative',
    enforcement: 'checked',
    because:
      'Values outside it are clipped somewhere in the chain, and the clipping is not ours to control. ' +
      'It matters the moment a film is played anywhere but a browser.',
  },
} as const satisfies Record<string, Standard>;

/** WCAG AA floors. The numbers the checks actually compare against. */
export const CONTRAST_AA_NORMAL = 4.5;
export const CONTRAST_AA_LARGE = 3.0;
export const CONTRAST_AA_NON_TEXT = 3.0;
/** AAA, for the one case that earns it: small captions over moving footage. */
export const CONTRAST_AAA_NORMAL = 7.0;

/**
 * WCAG's definition of large text: 18pt, or 14pt bold.
 *
 * In CSS reference pixels that is 24px, or 18.66px at weight 700 and above. The
 * conversion matters — using 18px as the threshold, which is the common mistake,
 * applies the weaker 3:1 floor to text that is legally normal-sized.
 */
export const LARGE_TEXT_PX = 24;
export const LARGE_TEXT_BOLD_PX = 18.66;
export const BOLD_WEIGHT = 700;

/**
 * WCAG's large-text threshold, expressed as a share of frame height.
 *
 * A film has no CSS pixels. Its type is measured in render pixels, and the same
 * file is watched full-width on a desk and three inches tall in a feed, so an
 * absolute px threshold means nothing here.
 *
 * The proportional equivalent: 24px in a typical 900px-tall browser viewport is
 * about 2.7% of the display height, so a 16:9 film filling that viewport puts
 * WCAG large text at roughly 3% of frame height. This sits above that, because
 * a launch film is watched on a phone at least as often as on a desk, and the
 * cost of applying the weaker floor to type that turns out to be small is
 * unreadable copy in the one place we cannot fix it.
 */
export const LARGE_TEXT_FRAME_RATIO = 0.04;

/** True when type is large relative to the frame it is rendered into. */
export function isLargeInFrame(fontSizePx: number, frameHeightPx: number): boolean {
  return fontSizePx >= frameHeightPx * LARGE_TEXT_FRAME_RATIO;
}

/** The contrast floor for type of this size in a frame of this height. */
export function contrastFloorInFrame(fontSizePx: number, frameHeightPx: number): number {
  return isLargeInFrame(fontSizePx, frameHeightPx) ? CONTRAST_AA_LARGE : CONTRAST_AA_NORMAL;
}

export function isLargeText(fontSizePx: number, weight: number): boolean {
  if (weight >= BOLD_WEIGHT) return fontSizePx >= LARGE_TEXT_BOLD_PX;
  return fontSizePx >= LARGE_TEXT_PX;
}

/** The contrast floor that applies to a given piece of text. */
export function contrastFloorFor(fontSizePx: number, weight: number): number {
  return isLargeText(fontSizePx, weight) ? CONTRAST_AA_LARGE : CONTRAST_AA_NORMAL;
}

/** 8-bit studio-range limits, per ITU-R BT.709. */
export const STUDIO_BLACK_8BIT = 16;
export const STUDIO_WHITE_8BIT = 235;

/**
 * How much of a frame one colour may cover before it stops being an accent.
 *
 * Expressed as the share of the composed area, not of the pixels: a full-bleed
 * photograph is not an accent decision.
 */
export const MAX_ACCENT_AREA = 0.18;
export const MAX_ACCENT_COLORS = 2;

/**
 * How much of a typographic frame the accent may cover before it stops
 * being an accent. Measured from rendered frames, not from the storyboard:
 * the storyboard says which colour a mark has, the frame says how much of it
 * there is.
 */
export const MAX_ACCENT_SHARE = 0.2;

/** How much of a typographic frame should still be canvas. */
export const MIN_CANVAS_SHARE = 0.45;

/**
 * Tolerance, in 8-bit code values, around the studio range.
 *
 * Chroma subsampling and the encoder's rounding put a frame's darkest luma at
 * 15 or 17 as readily as at 16; a check with no tolerance fails every black.
 */
export const STUDIO_RANGE_TOLERANCE = 1;
