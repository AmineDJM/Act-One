import { z } from 'zod';
import {
  FramingRect,
  MAX_UPSCALE,
  UiFraming,
  minCropWidth,
  type UiRegion,
  type UiStructure,
} from './ui-cinema.ts';

/**
 * The one shot the film is remembered for, found by looking at all of them.
 *
 * Every film has a frame that does the work. Not the longest shot or the most
 * expensive one — the one a person could describe afterwards. A system that
 * produces films without ever producing that frame produces competent films
 * forever, which is exactly what our own director kept saying about ours:
 * "it never finds an image or a move that makes it memorable."
 *
 * The obvious way to get one is to ask a model to describe a hero shot, and
 * it is the wrong way twice over. A description is not a shot, and the thing
 * described will be generic, because the model is writing about products in
 * general rather than about this product's actual screen.
 *
 * So this searches instead. The candidates are real: every panel of every
 * capture we hold, at three shot sizes, with and without a lifted element —
 * hundreds of them, all of them renderable, none of them invented. They are
 * scored on properties a frame either has or does not: whether there are
 * enough pixels to show it, whether one thing dominates it, whether that
 * thing is placed where a composed frame places its subject, whether it has
 * anything in it at all, and whether it repeats a shot the film already has.
 * Then the handful at the top get rendered and looked at.
 *
 * The search is the point. A shortlist a person can disagree with, produced
 * by a mechanism that can be read, is worth more than a confident sentence.
 */
export const HeroTerm = z.enum([
  'resolution',
  'isolation',
  'fill',
  'placement',
  'substance',
  'depth',
  'freshness',
]);
export type HeroTerm = z.infer<typeof HeroTerm>;

export const HeroCandidate = z.object({
  /** The capture this is a frame of, and its real size — a crop means nothing without it. */
  assetId: z.string(),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  background: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  /** The shot itself, ready to render: nothing here needs interpreting. */
  framing: UiFraming,
  /** 0..1, the weighted sum of the terms below. */
  score: z.number(),
  terms: z.record(HeroTerm, z.number()),
  /** Why this one, in the order the terms carried it. Written for a person. */
  why: z.array(z.string()),
});
export type HeroCandidate = z.infer<typeof HeroCandidate>;

/**
 * What each property is worth.
 *
 * Isolation and fill carry it, because they are the difference between a hero
 * shot and a screenshot: one thing in the frame is the subject, and it is big
 * enough to be that.
 *
 * Resolution is deliberately not the heavyweight, and getting that wrong the
 * first time is instructive. Weighted at a third it ranked the widest frame
 * of every capture at the top — the whole screen has the most pixels by
 * definition, so a term that rewards pixels rewards not cropping, and the
 * search returned six pictures of six screens. Sharpness is a floor to clear,
 * not a prize to win; the framing budget already refuses anything under it,
 * and what is left here is a mild preference for the frames with room to
 * spare.
 */
const WEIGHTS: Record<HeroTerm, number> = {
  isolation: 0.28,
  fill: 0.22,
  resolution: 0.13,
  substance: 0.13,
  /*
   * Freshness carries real weight, which it would not in a general shot
   * search. The hero is the frame the film is remembered for, so a hero that
   * repeats a shot the audience saw eight seconds ago is not a hero — it is
   * the same shot held longer.
   */
  freshness: 0.12,
  placement: 0.09,
  depth: 0.03,
};

/** Shot sizes, as multiples of the tightest crop the capture can carry. */
const SIZES = [1, 1.35, 1.9] as const;
/** A panel smaller than this is a control, not a subject. */
const MIN_SUBJECT_AREA = 0.008;

export type HeroSearchInput = {
  /** Every capture the film could use, with the structure read out of it. */
  captures: { assetId: string; structure: UiStructure }[];
  frameAspect: number;
  renderWidth: number;
  /** How long the hero shot runs. */
  seconds: number;
  /**
   * Crops the film is already using, so the hero is not a shot the audience
   * has just seen. Normalised, and keyed by the capture they belong to.
   */
  taken?: { assetId: string; rect: FramingRect }[];
};

export type HeroSearch = {
  candidates: HeroCandidate[];
  /** Everything generated, before the shortlist. Reported, not returned in full. */
  considered: number;
  /** Why the search could not do its job, when it could not. */
  notes: string[];
};

/**
 * Generate, score, rank.
 *
 * Deterministic and free: no model is asked anything here, which is what
 * makes it reasonable to consider hundreds of frames. The expensive judgement
 * — looking at the top few — happens above this, on rendered stills.
 */
export function searchHeroShots(input: HeroSearchInput, shortlist = 6): HeroSearch {
  const notes: string[] = [];
  const all: HeroCandidate[] = [];

  for (const capture of input.captures) {
    const floor = minCropWidth(capture.structure.width, input.renderWidth);
    const subjects = capture.structure.regions.filter(
      (region) => region.width * region.height >= MIN_SUBJECT_AREA && region.density > 0.05,
    );
    if (subjects.length === 0) {
      notes.push(`${capture.assetId}: no panel in this capture is big enough to build a shot around`);
      continue;
    }
    for (const subject of subjects) {
      for (const size of SIZES) {
        const width = Math.min(1, Math.max(floor, Math.max(subject.width * 1.15, floor) * size));
        const rect = frameAround(subject, capture.structure, input.frameAspect, width);
        // A size that clamps to the same rectangle as the one before it is the
        // same shot; scoring it twice only crowds the shortlist.
        if (all.some((other) => other.assetId === capture.assetId && sameRect(other.framing.to, rect))) continue;

        const liftable = isLiftable(subject);
        for (const lift of liftable ? [null, subject] : [null]) {
          const terms = score(capture.assetId, subject, rect, capture.structure, input, lift !== null);
          const total = (Object.entries(terms) as [HeroTerm, number][]).reduce(
            (sum, [term, value]) => sum + WEIGHTS[term] * value,
            0,
          );
          all.push({
            assetId: capture.assetId,
            sourceWidth: capture.structure.width,
            sourceHeight: capture.structure.height,
            background: capture.structure.background,
            framing: UiFraming.parse({
              role: 'subject',
              /*
               * A hero shot moves, but barely. It is held long enough to be
               * read, and the move is a slow settle onto the subject rather
               * than a push that arrives somewhere: there is nowhere else to
               * arrive, this is the place.
               */
              move: 'push',
              from: widenBy(rect, capture.structure, input.frameAspect, 1.12),
              to: rect,
              seconds: input.seconds,
              cut: true,
              lift: lift ? clamp(lift) : null,
              words: 'none',
              around: clamp(subject),
            }),
            score: Number(total.toFixed(4)),
            terms,
            why: explain(terms),
          });
        }
      }
    }
  }

  all.sort((left, right) => right.score - left.score);
  /*
   * One entry per capture in the top half of the shortlist, so a single
   * screenshot with six good panels cannot take the whole list and leave the
   * judgement with nothing to actually choose between.
   */
  const picked: HeroCandidate[] = [];
  const perCapture = new Map<string, number>();
  const cap = Math.max(1, Math.ceil(shortlist / Math.max(1, input.captures.length)) + 1);
  for (const candidate of all) {
    /*
     * A frame the film already has is not a candidate at all.
     *
     * Freshness is a score for partial overlap — a tighter view of a panel
     * the film glanced at is a legitimate hero — but a frame that IS one of
     * the film's existing shots cannot be the thing the film is remembered
     * for, whatever else is true of it. A weight can be outvoted; this
     * cannot, which is the difference between a preference and a rule.
     */
    if (candidate.terms.freshness !== undefined && candidate.terms.freshness < 0.15) continue;
    const used = perCapture.get(candidate.assetId) ?? 0;
    if (used >= cap) continue;
    if (picked.some((other) => other.assetId === candidate.assetId && overlaps(other.framing.to, candidate.framing.to) > 0.7)) {
      continue;
    }
    picked.push(candidate);
    perCapture.set(candidate.assetId, used + 1);
    if (picked.length >= shortlist) break;
  }

  if (picked.length === 0) notes.push('no capture held a frame worth putting forward as the hero shot');
  return { candidates: picked, considered: all.length, notes };
}

function score(
  assetId: string,
  subject: UiRegion,
  rect: FramingRect,
  structure: UiStructure,
  input: HeroSearchInput,
  lifted: boolean,
): Record<HeroTerm, number> {
  const sourcePixels = rect.width * structure.width;

  /*
   * Resolution, as headroom above the floor rather than as a pixel count.
   *
   * One when the crop has at least as many pixels as the frame it fills;
   * four tenths at the very limit of what may be blown up, which is passable
   * rather than disqualifying — a candidate below that limit is never
   * generated, because the framing budget refused it before it got here.
   */
  const native = clamp01((sourcePixels / input.renderWidth - 1 / MAX_UPSCALE) / (1 - 1 / MAX_UPSCALE));
  const resolution = 0.4 + 0.6 * native;

  /*
   * Isolation: how much of the ink in this frame belongs to the subject.
   *
   * The single property that separates a hero shot from a screenshot. A frame
   * where the subject holds a fifth of the ink is a picture of a screen; one
   * where it holds three quarters is a picture of a thing.
   */
  let inFrame = 0;
  let mine = 0;
  for (const region of structure.regions) {
    const share = overlaps(rect, region) * region.width * region.height * region.density;
    inFrame += share;
    if (region === subject) mine = share;
  }
  const isolation = inFrame > 0 ? clamp01(mine / inFrame) : 0;

  /*
   * Fill: how much of the frame the subject occupies.
   *
   * Peaked rather than monotonic. Too small and the subject is an incident in
   * somebody else's screen; too large and there is no screen left around it,
   * which is what makes a crop read as a crop rather than as a camera.
   */
  const area = (subject.width * subject.height) / Math.max(1e-6, rect.width * rect.height);
  const fill = area <= 0.35 ? clamp01(area / 0.35) : clamp01(1 - (area - 0.35) / 0.45);

  /*
   * Placement: where the subject's centre sits relative to the thirds.
   *
   * Not a rule so much as a measurement of whether anything was composed at
   * all — a frame whose subject is dead centre and a frame whose subject is
   * on a third are both fine, and a frame whose subject is jammed against an
   * edge is not.
   */
  const cx = (subject.x + subject.width / 2 - rect.x) / Math.max(1e-6, rect.width);
  const cy = (subject.y + subject.height / 2 - rect.y) / Math.max(1e-6, rect.height);
  const placement = clamp01(1 - 2 * Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5)));

  /** Substance: a panel with nothing in it makes a beautifully composed empty frame. */
  const substance = clamp01(subject.density / 0.55);

  /*
   * Depth, and only where it is motivated. Lifting a toast off the interface
   * is what the interface is already doing; lifting a sidebar is a gimmick.
   */
  const depth = lifted ? (isLiftable(subject) ? 1 : 0) : 0.35;

  /*
   * Freshness: how unlike the shots the film already has this one is.
   *
   * Only against crops of the same capture, because two frames of different
   * screenshots are different frames whatever their coordinates happen to be.
   */
  const worst = Math.max(
    0,
    ...(input.taken ?? [])
      .filter((entry) => entry.assetId === assetId)
      .map((entry) => overlaps(entry.rect, rect)),
  );
  const freshness = clamp01(1 - worst);

  return { resolution, isolation, fill, placement, substance, depth, freshness };
}

/** A toast, a badge, a confirmation: small, dense, and sitting on top of the screen already. */
function isLiftable(region: UiRegion): boolean {
  return region.height <= 0.2 && region.width <= 0.55 && region.density >= 0.3;
}

const SAYS: Record<HeroTerm, string> = {
  resolution: 'there are enough real pixels to hold it',
  isolation: 'one thing dominates the frame',
  fill: 'the subject is sized like a subject',
  substance: 'there is something in it',
  placement: 'it is composed rather than cropped',
  depth: 'the lifted element is one the interface already puts on top',
  freshness: 'the film has not already shown this',
};

function explain(terms: Record<HeroTerm, number>): string[] {
  return (Object.entries(terms) as [HeroTerm, number][])
    .filter(([, value]) => value >= 0.55)
    .sort((left, right) => right[1] * WEIGHTS[right[0]] - left[1] * WEIGHTS[left[0]])
    .slice(0, 3)
    .map(([term, value]) => `${SAYS[term]} (${term} ${value.toFixed(2)})`);
}

function frameAround(
  subject: UiRegion,
  structure: UiStructure,
  frameAspect: number,
  width: number,
): FramingRect {
  const height = ((width * structure.width) / frameAspect) / structure.height;
  return slide({
    x: subject.x + subject.width / 2 - width / 2,
    y: subject.y + subject.height / 2 - height / 2,
    width,
    height,
  });
}

function widenBy(rect: FramingRect, structure: UiStructure, frameAspect: number, by: number): FramingRect {
  const width = Math.min(1, rect.width * by);
  const height = ((width * structure.width) / frameAspect) / structure.height;
  return slide({
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
  });
}

function slide(rect: FramingRect): FramingRect {
  const width = Math.min(1, Math.max(0.02, rect.width));
  const height = Math.min(1, Math.max(0.02, rect.height));
  return {
    x: Number(Math.min(1 - width, Math.max(0, rect.x)).toFixed(4)),
    y: Number(Math.min(1 - height, Math.max(0, rect.y)).toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
  };
}

function clamp(region: UiRegion | FramingRect): FramingRect {
  return slide({ x: region.x, y: region.y, width: region.width, height: region.height });
}

function sameRect(a: FramingRect, b: FramingRect): boolean {
  return Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005 && Math.abs(a.width - b.width) < 0.005;
}

/** Share of the smaller rectangle that the two have in common, 0..1. */
function overlaps(a: FramingRect, b: FramingRect | UiRegion): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? (w * h) / smaller : 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * What the search did, kept with the film.
 *
 * A hero shot that cannot be accounted for is a hero shot nobody can argue
 * with, which over time is how a system stops improving. This is the record:
 * how many frames were looked at, which won, what the measurement said, what
 * the director said after seeing it rendered, and what it cost. All of it
 * belongs to the storyboard rather than to a log, because the next person to
 * open this film should be able to see the choice and take a different one.
 */
export const HeroShotRecord = z.object({
  /** The shot this became, in the film. */
  sceneId: z.string(),
  assetId: z.string(),
  framing: UiFraming,
  /** Every frame the search generated and scored. */
  considered: z.number().int().min(0),
  /** How many of them were rendered and looked at. */
  shortlisted: z.number().int().min(0),
  score: z.number(),
  /** The measurable reasons, from the search. */
  why: z.array(z.string()).default([]),
  /** The director's reason, from looking at the rendered frames. */
  reason: z.string().max(800).default(''),
  /** What the runner-up had that this one does not. */
  giveUp: z.string().max(400).default(''),
  /** True when a director looked; false when the shortlist held only one frame. */
  judged: z.boolean().default(false),
  costUsd: z.number().min(0).default(0),
  chosenAt: z.string(),
  /** Where the search fell short, in its own words. */
  notes: z.array(z.string()).default([]),
});
export type HeroShotRecord = z.infer<typeof HeroShotRecord>;
