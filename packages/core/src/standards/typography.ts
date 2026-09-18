import type { Standard } from './standard.ts';

/**
 * Typographic law.
 *
 * Almost none of this is standardised by a body, and almost all of it has been
 * settled for centuries. The measure, the scale and the relationship between
 * size and leading are the three decisions that separate typography from text
 * placement, and they are the three an automated system gets wrong first.
 */
export const TYPE_STANDARDS = {
  measure: {
    id: 'type.measure',
    rule: 'A line of text runs 45 to 75 characters; 66 is the target for a single column.',
    source: 'Bringhurst, The Elements of Typographic Style',
    clause: '§2.1.2',
    authority: 'convention',
    enforcement: 'checked',
    because:
      'Shorter and the eye jumps back too often; longer and it loses the line it was on. ' +
      'For a held frame in a film the short end of the range is right, because the reader ' +
      'does not control the pace.',
  },
  modularScale: {
    id: 'type.modular_scale',
    rule: 'Sizes come from one ratio, not from round numbers.',
    source: 'Bringhurst, after the musical intervals',
    clause: '§3.1',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'Sizes chosen individually look almost related, which reads as a mistake. ' +
      'Sizes from a ratio look deliberate even when the viewer cannot name the ratio.',
  },
  leading: {
    id: 'type.leading',
    rule: 'Leading tightens as type grows: about 1.5 at body size, 1.0 to 1.1 at display.',
    source: 'Bringhurst §2.2, and standard practice in motion design',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'Leading is proportional to the eye’s need to find the next line, not to the type size. ' +
      'Display type set at body leading falls apart into separate lines.',
  },
  tracking: {
    id: 'type.tracking',
    rule: 'Display type is tracked in; small and uppercase type is tracked out.',
    source: 'Standard practice, after the optical sizes of metal type',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'Digital fonts are drawn once and scaled, so spacing correct at 16px is loose at 120px. ' +
      'Metal type was cut separately per size and did this for you.',
  },
  families: {
    id: 'type.families',
    rule: 'Two families at most in one film, and only when they do different jobs.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A third typeface almost never adds a distinction the viewer can use, ' +
      'and reliably adds one they can feel.',
  },
  syntheticStyles: {
    id: 'type.synthetic_styles',
    rule: 'Never synthesise a weight or an italic the family does not have.',
    source: 'Act One house rule, after long-standing print practice',
    authority: 'house',
    enforcement: 'designed_in',
    because:
      'A browser faking bold by smearing the outline, or italic by shearing it, produces letterforms ' +
      'the designer never drew. It is one of the most recognisable signs of automated typesetting.',
  },
  minimumSize: {
    id: 'type.minimum_size',
    rule: 'Nothing on screen is smaller than 2% of the frame height.',
    source: 'After broadcast subtitle practice (BBC Subtitle Guidelines)',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'A film is watched on a phone at arm’s length as often as on a desk. ' +
      'Below this, type survives the render and does not survive the viewing.',
  },
  readingTime: {
    id: 'type.reading_time',
    rule: 'On-screen copy holds long enough to be read at about 2.6 words per second, plus arrival time.',
    source: 'After subtitle timing practice (BBC, Netflix TTSG)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Subtitle standards are the closest measured analogue: text the viewer cannot pause. ' +
      'The arrival allowance covers the animation before the words are stable enough to read.',
  },
} as const satisfies Record<string, Standard>;

/** Characters per line. */
export const MEASURE_MIN = 45;
export const MEASURE_IDEAL = 66;
export const MEASURE_MAX = 75;
/**
 * A held frame is read under time pressure rather than at the reader's own
 * pace, so the comfortable maximum is shorter than it is on a page.
 */
export const MEASURE_MAX_ON_SCREEN = 58;

/** Named modular scale ratios, from the musical intervals they are named for. */
export const MODULAR_SCALES = {
  minor_second: 1.067,
  major_second: 1.125,
  minor_third: 1.2,
  major_third: 1.25,
  perfect_fourth: 1.333,
  augmented_fourth: 1.414,
  perfect_fifth: 1.5,
  golden: 1.618,
} as const;
export type ModularScaleName = keyof typeof MODULAR_SCALES;

/** The step `n` places up a scale from `base`. Negative steps go down. */
export function modularStep(base: number, ratio: number, step: number): number {
  return base * ratio ** step;
}

/**
 * Leading for an optical size, as a multiple of the size.
 *
 * A curve rather than a table because the relationship is continuous: there is
 * no size at which the correct leading jumps.
 */
export function leadingFor(fontSizePx: number, frameHeightPx: number): number {
  const relative = fontSizePx / frameHeightPx;
  if (relative >= 0.085) return 0.98;
  if (relative >= 0.06) return 1.04;
  if (relative >= 0.04) return 1.12;
  if (relative >= 0.025) return 1.3;
  return 1.45;
}

/**
 * How much of the brand's own tracking to apply at a given optical size.
 *
 * A multiplier rather than an absolute value, because the base tracking is
 * measured from the customer's own site and is theirs to keep. Expressed
 * against frame height so a 1080p and a 4K render of the same film track
 * identically — the tell of an absolute-pixel rule is type that tightens as
 * the resolution goes up.
 */
export function trackingScaleFor(fontSizePx: number, frameHeightPx: number): number {
  const relative = fontSizePx / frameHeightPx;
  if (relative >= 0.085) return 1.25;
  if (relative >= 0.06) return 1.05;
  if (relative >= 0.04) return 0.8;
  if (relative >= 0.025) return 0.55;
  return 0.4;
}

export const MAX_TYPE_FAMILIES = 2;
export const MIN_TYPE_SIZE_RATIO = 0.02;

/** Words per second. Used to time on-screen copy and to pace narration. */
export const READING_WORDS_PER_SECOND = 2.6;
export const NARRATION_WORDS_PER_SECOND = 2.35;
/** Seconds before animated type is stable enough to start reading. */
export const TEXT_ARRIVAL_SECONDS = 0.45;

export function readingSecondsFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return TEXT_ARRIVAL_SECONDS + words / READING_WORDS_PER_SECOND;
}
