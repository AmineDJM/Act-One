import { z } from 'zod';

/**
 * The grammar of a premium product film, measured rather than admired.
 *
 * Four reference films were analysed as temporal works — every boundary, every
 * tracked element's trajectory, the easing fitted to those trajectories rather
 * than to flow magnitude, the camera separated from the objects by a fitted
 * affine model, and the audio split into voice, music, impacts and silence.
 * What follows is the shape that came out. None of it is anybody's artwork:
 * they are rates, ratios, durations and curve families, which is what taste
 * is made of and the only part that can honestly be learned from someone
 * else's work.
 *
 * The single finding that reorganised everything: Act One changes its idea at
 * very nearly the right rate — 37 creative beats a minute against a reference
 * band of 23 to 39 — and delivers almost every one of them with a CUT. The
 * references deliver theirs by TRANSFORMING material that is already on
 * screen. Expressed as a ratio of transformations to hard cuts:
 *
 *     gojiberry  13.7      taap  3.7      1600  2.4      slack  0.93
 *     Act One     0.23
 *
 * That one number is the difference between a film and a slideshow with good
 * taste, and no amount of better composition inside a shot can reach it.
 */

/** How a beat hands over to the next. */
export const Handover = z.enum([
  /** The picture is replaced between one frame and the next. Valid, and a choice. */
  'cut',
  /** The camera keeps moving; elements leave and arrive inside the move. */
  'camera_carry',
  /** An object survives the boundary and becomes part of the next idea. */
  'object_handoff',
  /** Material changes into other material: a card becomes a chart, a mark becomes a node. */
  'morph',
  /** The frame pushes into or pulls out of something until it is somewhere else. */
  'scale_through',
  /** The field changes colour under an object that stays. */
  'field_change',
  /** One element's shape reveals the next composition. */
  'mask_reveal',
]);
export type Handover = z.infer<typeof Handover>;

/**
 * Handovers that do not cut.
 *
 * Kept as a list rather than "everything except cut" so that adding a
 * handover forces a decision about which side it is on.
 */
export const CONTINUOUS_HANDOVERS: readonly Handover[] = [
  'camera_carry',
  'object_handoff',
  'morph',
  'scale_through',
  'field_change',
  'mask_reveal',
];

/** What an element is, for the purpose of deciding how it should move. */
export const ElementKind = z.enum(['type', 'card', 'panel', 'device', 'disc', 'mark', 'field']);
export type ElementKind = z.infer<typeof ElementKind>;

/**
 * The easing families the references actually use, in the proportions they
 * use them.
 *
 * The important one is `ease_in_cubic`, which is how things LEAVE. It is the
 * most common single family in three of the four references (18, 19 and 23
 * occurrences) and it appeared four times in an Act One film, because Act One
 * elements arrive and are then replaced by a cut rather than exiting. A film
 * where nothing ever leaves the frame is a film that can only change by
 * cutting.
 */
export const EasingFamily = z.enum([
  'linear',
  'ease_out_quad',
  'ease_out_cubic',
  'ease_out_quint',
  'ease_in_cubic',
  'ease_in_out_cubic',
  'overshoot',
]);
export type EasingFamily = z.infer<typeof EasingFamily>;

/**
 * What the measurements found in the reference films, per minute of running
 * time, as a band rather than a target.
 *
 * A band is not a score to hit. A film that cuts as often as the busiest
 * reference is not thereby good. What a band is for is the other direction:
 * a film outside every reference on a structural measure is making a choice
 * that nobody took deliberately, and that is worth saying out loud.
 */
export type GrammarBand = { low: number; high: number };

export const REFERENCE_BANDS = {
  /** Films of this class run long enough to be understood. Ours ran 29s. */
  runtimeSeconds: { low: 66, high: 89 } as GrammarBand,
  /** New ideas per minute. Act One is already inside this band. */
  creativeBeatsPerMinute: { low: 23, high: 40 } as GrammarBand,
  /** Hard cuts per minute. Act One ran at 26.7. */
  shotsPerMinute: { low: 2.5, high: 12.6 } as GrammarBand,
  /** Continuous transformations per minute. Act One ran at 6.2. */
  transformationsPerMinute: { low: 11.7, high: 34.7 } as GrammarBand,
  /**
   * Transformations for every hard cut. The number this whole file is about.
   * The weakest reference on this measure is Slack at 0.93; Act One is 0.23.
   */
  transformationsPerShot: { low: 0.9, high: 13.7 } as GrammarBand,
  /** Share of running time with nothing moving. Act One held still for 49%. */
  staticShare: { low: 0.1, high: 0.48 } as GrammarBand,
  /** Moving elements per minute. Act One is inside this band at 107. */
  movingElementsPerMinute: { low: 70, high: 122 } as GrammarBand,
  /** Share of moving elements that are type. Act One ran at 0.80. */
  typeShareOfElements: { low: 0.22, high: 0.61 } as GrammarBand,
  /** Distinct easing families in use. Everything below is a house style, not a vocabulary. */
  easingFamilies: { low: 6, high: 7 } as GrammarBand,
  /** Share of motion explained by a camera rather than by objects moving apart. */
  cameraShare: { low: 0.53, high: 0.67 } as GrammarBand,
  /** Share of frames where two depths move at different rates. Act One ran at 0.13. */
  parallaxShare: { low: 0.15, high: 0.36 } as GrammarBand,
  /** Sonic impacts per second. Act One ran at 1.57 — ten times the busiest reference. */
  impactsPerSecond: { low: 0.06, high: 0.45 } as GrammarBand,
  /** The longest deliberate pause. Act One's longest was 0.00s. */
  longestSilenceSeconds: { low: 0.49, high: 2.11 } as GrammarBand,
  /** Share of element entries a sonic mark lands within 80ms of. */
  soundLockShare: { low: 0.58, high: 0.7 } as GrammarBand,
} as const;

export type BandName = keyof typeof REFERENCE_BANDS;

/**
 * Stagger, which is the most characteristic number in motion design.
 *
 * Every reference staggers siblings by 200–300 ms over a span of 0.4–0.6 s,
 * whatever the element and whatever the film. It is what makes eight cards
 * read as eight objects rather than one image with eight things printed on
 * it. Act One already does this — it just does it four times less often than
 * gojiberry, which staggers something in eight separate places.
 */
export const STAGGER_MS: GrammarBand = { low: 200, high: 300 };
export const STAGGER_SPAN_SECONDS: GrammarBand = { low: 0.4, high: 0.6 };

/**
 * How long one continuous transformation runs.
 *
 * Median a half second, but every reference has several that run two to three
 * seconds — a push that develops, a field that turns over, a diagram that
 * assembles. Act One produced exactly three transformations in a film and all
 * three were 0.87 seconds, which is not a distribution, it is a constant.
 */
export const TRANSFORMATION_SECONDS: GrammarBand = { low: 0.27, high: 3.2 };

/** One element's move, as the reference films distribute them. */
export const ELEMENT_MOVE_SECONDS: GrammarBand = { low: 0.2, high: 11.6 };

export const GrammarFinding = z.object({
  band: z.string(),
  measured: z.number(),
  low: z.number(),
  high: z.number(),
  /** Which way it is out: below the band, or above it. */
  side: z.enum(['below', 'above']),
  says: z.string(),
});
export type GrammarFinding = z.infer<typeof GrammarFinding>;

/**
 * What each band means when a film falls outside it, in the words somebody
 * would use in an edit suite.
 *
 * Only the side that is a defect is written. A film that cuts LESS than the
 * quietest reference is not thereby broken, and a film with more parallax
 * than Slack is not in trouble — so those directions say nothing.
 */
const OUTSIDE: Partial<Record<BandName, Partial<Record<'below' | 'above', string>>>> = {
  runtimeSeconds: {
    below:
      'The film is shorter than any reference of its class. A viewer who has never heard of this ' +
      'company is being given less time to understand it than the references give theirs.',
  },
  shotsPerMinute: {
    above:
      'The film cuts more often than any reference. Cutting is not movement — a cut is what a film ' +
      'does when it has nothing to transform.',
  },
  transformationsPerMinute: {
    below:
      'The film transforms material less often than any reference. Ideas are arriving by replacement ' +
      'rather than by change.',
  },
  transformationsPerShot: {
    below:
      'For every continuous transformation this film makes, it makes several hard cuts. Every ' +
      'reference is the other way round. This is the measurable difference between a film and a ' +
      'sequence of compositions.',
  },
  staticShare: {
    above: 'The film holds still for longer than any reference. Between its cuts, nothing happens.',
  },
  typeShareOfElements: {
    above:
      'Almost everything that moves in this film is type. The references move cards, panels, devices ' +
      'and discs as well, and type is between a fifth and two thirds of what moves.',
  },
  easingFamilies: {
    below:
      'The film moves in one or two ways. A motion language is several families used for different ' +
      'jobs — and in particular things have to LEAVE, which is what the ease-in families are for.',
  },
  parallaxShare: {
    below:
      'Almost nothing in this film moves at two depths. Parallax is how a flat composition acquires ' +
      'space without being rebuilt in 3D.',
  },
  impactsPerSecond: {
    above:
      'There is an impact on almost every movement. The references mark a fraction of their moves — ' +
      'a sound on everything is the same as a sound on nothing.',
  },
  longestSilenceSeconds: {
    below:
      'The film never stops for even half a second. Every reference holds at least one real pause; ' +
      'scattered gaps below the noise floor are not the same thing.',
  },
  movingElementsPerMinute: {
    below: 'Fewer things move in this film than in any reference. The frame is underpopulated.',
  },
  creativeBeatsPerMinute: {
    below: 'The film changes idea less often than any reference. It is dwelling without developing.',
    above: 'The film changes idea faster than any reference. Nothing is given time to land.',
  },
};

/**
 * Where a film sits against the grammar.
 *
 * Reports only the ways a film is outside the band in the direction that is a
 * defect, and says nothing where it is inside — a band is a description of
 * what good work happens to do, not a target, and a system that scored films
 * against it would start optimising for the middle of somebody else's range.
 */
export function againstGrammar(measured: Partial<Record<BandName, number>>): GrammarFinding[] {
  const findings: GrammarFinding[] = [];
  for (const [name, value] of Object.entries(measured) as [BandName, number | undefined][]) {
    if (value === undefined || !Number.isFinite(value)) continue;
    const band = REFERENCE_BANDS[name];
    const side = value < band.low ? 'below' : value > band.high ? 'above' : null;
    if (!side) continue;
    const says = OUTSIDE[name]?.[side];
    if (!says) continue;
    findings.push({ band: name, measured: value, low: band.low, high: band.high, side, says });
  }
  return findings;
}

export const AnchorKind = z.enum([
  /** The brand mark. Introduced, carried, shrunk, and it becomes the next idea's centre. */
  'mark',
  /** A line of type that continues across the join instead of being replaced. */
  'line',
  /** The product capture itself, at a different scale on the other side. */
  'plate',
]);
export type AnchorKind = z.infer<typeof AnchorKind>;

export const HandoverPlan = z.object({
  kind: Handover,
  /**
   * How long both scenes are on screen.
   *
   * Zero for a cut. The references transform for 0.27 to 3.2 seconds with a
   * median near half a second, and the overlap is bounded below by what the
   * eye can read as continuity and above by the shorter of the two scenes,
   * because an overlap longer than its own scene is a dissolve with extra
   * steps.
   */
  seconds: z.number().min(0).max(3.2).default(0),
  /** What survives, when something does. */
  anchor: AnchorKind.nullable().default(null),
  /** Why this join and not a cut, in the director's words. Empty for a cut. */
  reason: z.string().max(300).default(''),
});
export type HandoverPlan = z.infer<typeof HandoverPlan>;

export const CUT: HandoverPlan = { kind: 'cut', seconds: 0, anchor: null, reason: '' };
