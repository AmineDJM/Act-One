import { z } from 'zod';
import type { Scene, Storyboard } from './storyboard.ts';
import { REAL_PRODUCT_VISUAL_TYPES } from './storyboard.ts';

/**
 * What is actually wrong with a cut, as a name rather than a paragraph.
 *
 * A note from somebody who watched the film arrives as prose — "it behaves
 * like a well-made deck", "product arrives too late" — and prose cannot be
 * acted on twice. The same words have to choose the repair that runs and the
 * measurement that decides whether the repair helped, so they are reduced,
 * once, to one of these.
 *
 * Thirteen names rather than a severity, because the repairs genuinely differ:
 * a beat with nothing to say and a beat saying the wrong thing at the right
 * length need opposite treatment, and a system that calls both "revise" gives
 * both the same prompt and fixes neither.
 */
export const CreativeProblem = z.enum([
  /** The beat holds more room than its content can fill. */
  'too_empty',
  /** More is asked of the viewer than the seconds allow. */
  'too_dense',
  /** Correct, and nothing moves. */
  'too_static',
  /** True of this film and of forty others like it. */
  'too_generic',
  /** The product does not arrive until the viewer has stopped caring. */
  'too_late_product',
  /** Nothing in it is worth remembering afterwards. */
  'weak_hero',
  /** The same composition, the same move, the same shape, again. */
  'too_repetitive',
  /** Type on a field where the product should be: the polished deck. */
  'bad_visual_language',
  /** Nothing to hear, or nothing worth hearing. */
  'weak_sound',
  /** Flat energy: no build, no release, no rest. */
  'bad_pacing',
  /** Not enough of the customer's own product on screen. */
  'insufficient_product',
  /** A cut that drops rather than turns. */
  'weak_transition',
  /** The frame itself is badly made. */
  'poor_composition',
]);
export type CreativeProblem = z.infer<typeof CreativeProblem>;

/**
 * The measurable shape of a cut.
 *
 * Read off the storyboard and what material it actually holds, so it can be
 * taken before a repair and again after one, on a candidate, without paying
 * for a render. Every number here answers a complaint somebody can make about
 * a film out loud.
 */
export type FilmShape = {
  runtimeSeconds: number;
  shots: number;
  /** When the customer's own product first appears, in seconds. Infinity when it never does. */
  firstProductSeconds: number;
  /** Share of the running time carried by material rather than by type. */
  pictureShare: number;
  /** Share of the running time that is a typographic card and nothing else. */
  typographyShare: number;
  /** Share of the running time showing the real product. */
  productShare: number;
  /** Shots asking for material that is not there. */
  unresolved: number;
  /** How many genuinely different kinds of shot the film uses. */
  distinctVisualTypes: number;
  /** The longest run of consecutive shots that look like the same idea. */
  longestRepeat: number;
  /**
   * Share of the running time in which the product itself is moving.
   *
   * The measure that separates a film from a deck with better pictures. A
   * capture held for four seconds with a camera drifting across it is a
   * picture of software; the interface coming apart, a control being pressed,
   * panels hung in a space — those are software being filmed. Both look
   * identical to `productShare`, which is exactly why that number kept saying
   * a film was fine while it played as a slide show.
   *
   * Counted from what production planned, not from what the storyboard hoped:
   * a shot whose framings hold no layers is not moving, whatever it was
   * written as.
   */
  cinematicShare: number;
  /** Shots in which the interface is taken apart or placed in space. */
  cinematicShots: number;
  /** Shots showing a real control being used and a real result. */
  operatedShots: number;
  /** Shots that open into a constructed space. */
  spatialShots: number;
};

/** Whether a shot has the material it needs to show anything but type. */
function hasMaterial(scene: Scene): boolean {
  return scene.assetRefs.length > 0;
}

function showsProduct(scene: Scene): boolean {
  return REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && hasMaterial(scene);
}

export function filmShape(storyboard: Storyboard): FilmShape {
  const scenes = storyboard.scenes;
  const runtime = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const share = (seconds: number) => (runtime > 0 ? Number((seconds / runtime).toFixed(4)) : 0);

  let pictureSeconds = 0;
  let typographySeconds = 0;
  let productSeconds = 0;
  let unresolved = 0;
  let firstProduct = Number.POSITIVE_INFINITY;
  let cinematicSeconds = 0;
  let cinematicShots = 0;
  let operatedShots = 0;
  let spatialShots = 0;

  for (const scene of scenes) {
    const material = hasMaterial(scene);
    const wantsMaterial = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType);
    if (material) pictureSeconds += scene.duration;
    else typographySeconds += scene.duration;
    if (wantsMaterial && !material) unresolved += 1;
    if (showsProduct(scene)) {
      productSeconds += scene.duration;
      firstProduct = Math.min(firstProduct, scene.startTime);
    }

    const framings = scene.uiSequence?.framings ?? [];
    const moving = framings.filter(
      (framing) => framing.layers.length > 0 || framing.space === 'volume',
    );
    if (moving.length > 0) {
      cinematicShots += 1;
      // The seconds in which something other than the camera is moving, not
      // the whole shot: an establishing frame inside a layered shot is still
      // an establishing frame.
      cinematicSeconds += moving.reduce((sum, framing) => sum + framing.seconds, 0);
    }
    if (framings.some((framing) => framing.layers.some((layer) => layer.role === 'control'))) {
      operatedShots += 1;
    }
    if (framings.some((framing) => framing.space === 'volume')) spatialShots += 1;
  }

  /*
   * A run of shots that are the same idea: same visual type, and neither of
   * them carrying material. Three title cards in a row is the shape a viewer
   * reads as a slide deck, and it is visible here without watching anything.
   */
  let longestRepeat = scenes.length > 0 ? 1 : 0;
  let run = scenes.length > 0 ? 1 : 0;
  for (let index = 1; index < scenes.length; index += 1) {
    const previous = scenes[index - 1]!;
    const current = scenes[index]!;
    const same = previous.visualType === current.visualType && !hasMaterial(previous) && !hasMaterial(current);
    run = same ? run + 1 : 1;
    longestRepeat = Math.max(longestRepeat, run);
  }

  return {
    runtimeSeconds: Number(runtime.toFixed(3)),
    shots: scenes.length,
    firstProductSeconds: firstProduct,
    pictureShare: share(pictureSeconds),
    typographyShare: share(typographySeconds),
    productShare: share(productSeconds),
    cinematicShare: share(Math.min(cinematicSeconds, runtime)),
    cinematicShots,
    operatedShots,
    spatialShots,
    unresolved,
    distinctVisualTypes: new Set(scenes.map((scene) => scene.visualType)).size,
    longestRepeat,
  };
}

/**
 * Which number a complaint is about.
 *
 * `worseIs` says which direction is a regression, so one comparison serves
 * every problem: "later is worse" for when the product arrives, "less is
 * worse" for how much of it there is.
 */
const WATCHED: Partial<
  Record<CreativeProblem, { of: keyof FilmShape; worseIs: 'higher' | 'lower'; says: string }>
> = {
  too_late_product: { of: 'firstProductSeconds', worseIs: 'higher', says: 'the product arrives even later' },
  insufficient_product: { of: 'productShare', worseIs: 'lower', says: 'there is even less product on screen' },
  bad_visual_language: { of: 'pictureShare', worseIs: 'lower', says: 'there is even less picture and even more type' },
  too_repetitive: { of: 'longestRepeat', worseIs: 'higher', says: 'the film repeats itself for even longer' },
  /*
   * "Too static" is about whether anything moves, and picture share cannot
   * answer that — a film of held screenshots has a high one. The share of the
   * running time in which the interface itself is moving can, and a repair
   * that takes it down has made the film more of a slide show than it was.
   */
  too_static: { of: 'cinematicShare', worseIs: 'lower', says: 'even less of the product actually moves' },
  bad_pacing: { of: 'longestRepeat', worseIs: 'higher', says: 'the film repeats itself for even longer' },
};

/** How much a metric may move the wrong way before it counts as a regression. */
const TOLERANCE = 0.02;

/**
 * Whether a candidate repair makes worse the exact thing it was sent to fix.
 *
 * This is not an optimiser. It answers one question and refuses one thing: a
 * repair for "the product arrives too late" that makes the product arrive
 * later, or a repair for "not enough product" that removes some. On a real
 * run the Director was told "product arrives too late, insufficient product
 * imagery, wrong images" and the accepted option took picture coverage from
 * 31% to 24% and left a shot with nothing to show. Every layer reported
 * success; the film got worse at the one thing the note named.
 *
 * Silent on everything else, deliberately. A repair is allowed to cost
 * something elsewhere — that is what a trade-off is, and taste decides those,
 * not arithmetic.
 */
export function repairRegression(
  problems: readonly CreativeProblem[],
  before: FilmShape,
  after: FilmShape,
): string | null {
  for (const problem of problems) {
    const watched = WATCHED[problem];
    if (!watched) continue;
    const from = before[watched.of];
    const to = after[watched.of];
    if (typeof from !== 'number' || typeof to !== 'number') continue;
    // A film that never showed the product cannot show it later than never.
    if (!Number.isFinite(from) && !Number.isFinite(to)) continue;
    if (!Number.isFinite(from)) continue;
    if (!Number.isFinite(to)) return `${watched.says} (it stops appearing at all).`;

    const worse = watched.worseIs === 'higher' ? to - from > TOLERANCE : from - to > TOLERANCE;
    if (worse) {
      return `${watched.says}: ${format(watched.of, from)} → ${format(watched.of, to)}.`;
    }
  }

  /*
   * And one thing no note has to name: a repair may never leave a shot with
   * nothing to show. That is not a trade-off, it is a hole in the film.
   */
  if (after.unresolved > before.unresolved) {
    return `it leaves ${after.unresolved - before.unresolved} more shot(s) with no material to show.`;
  }
  return null;
}

function format(of: keyof FilmShape, value: number): string {
  if (of === 'firstProductSeconds') return `${value.toFixed(1)}s`;
  if (of === 'longestRepeat') return String(value);
  return `${Math.round(value * 100)}%`;
}
