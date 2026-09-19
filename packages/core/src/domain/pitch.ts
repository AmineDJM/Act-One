import { PRODUCT_NAVIGATION_VISUAL_TYPES, REAL_PRODUCT_VISUAL_TYPES } from './storyboard.ts';

/**
 * Where a pitch stops being a pitch.
 *
 * Lives on its own rather than beside `FILM_FORMATS`, because it needs the
 * visual types and the visual types need the format's own vocabulary — and a
 * cycle between two domain files is a module that loads half-initialised and
 * fails somewhere unrelated with `Cannot read properties of undefined`.
 */
/**
 * How much of a pitch the product may occupy before it stops being a pitch.
 *
 * A fifth of the runtime is enough for a glimpse and two beats of evidence,
 * and not enough to carry an argument. Above it the film is a demonstration
 * with an atmospheric introduction, which is the thing the customer chose this
 * format to avoid.
 */
export const PITCH_PRODUCT_CEILING = 0.2;

/**
 * The ways a pitch stops being a pitch.
 *
 * Four separate failures rather than one, because they are four different
 * mistakes and a film can make any of them while passing the others. A cap on
 * runtime alone would let a film open on a dashboard; a rule against opening
 * on one would let a film cut between two screens for half its length.
 *
 * Stated here, in the domain, so the storyboard engine, the budget check and
 * the render guard all ask the same question rather than three similar ones.
 */
export type PitchDrift = {
  kind: 'navigated' | 'opens_on_product' | 'product_spine' | 'over_ceiling';
  message: string;
  sceneIds: string[];
};

export function pitchDrift(
  scenes: readonly {
    id: string;
    index: number;
    duration: number;
    visualType: string;
  }[],
  options: { ceiling?: number } = {},
): PitchDrift[] {
  if (scenes.length === 0) return [];
  const ceiling = options.ceiling ?? PITCH_PRODUCT_CEILING;
  const drift: PitchDrift[] = [];

  const shows = (scene: { visualType: string }) =>
    (REAL_PRODUCT_VISUAL_TYPES as readonly string[]).includes(scene.visualType);

  /*
   * Navigation is the one categorical rule left. A cursor crossing a live
   * interface is a demonstration however briefly it runs: the film is
   * teaching somebody to use the thing, which is the other format.
   */
  const navigated = scenes.filter((scene) =>
    (PRODUCT_NAVIGATION_VISUAL_TYPES as readonly string[]).includes(scene.visualType),
  );
  if (navigated.length > 0) {
    drift.push({
      kind: 'navigated',
      message:
        'A pitch shows the product; it does not drive it. ' +
        `${navigated.length} scene${navigated.length === 1 ? '' : 's'} put the interface on ` +
        'screen and work through it, which is a tour.',
      sceneIds: navigated.map((scene) => scene.id),
    });
  }

  /*
   * What the film opens on is what the film is about. A pitch that opens on a
   * screen has announced itself as a demonstration before it has said
   * anything, and no amount of atmosphere afterwards takes that back.
   */
  const ordered = [...scenes].sort((left, right) => left.index - right.index);
  const opener = ordered[0];
  if (opener && shows(opener)) {
    drift.push({
      kind: 'opens_on_product',
      message: 'This pitch opens on the product. The first shot is what the film is about.',
      sceneIds: [opener.id],
    });
  }

  /*
   * Two product beats in a row is a sequence, and a sequence is a walkthrough.
   * One glimpse is a cutaway; two is the film changing what it is.
   */
  const runs: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    if (shows(ordered[index]!) && shows(ordered[index - 1]!)) {
      runs.push(ordered[index - 1]!.id, ordered[index]!.id);
    }
  }
  if (runs.length > 0) {
    drift.push({
      kind: 'product_spine',
      message:
        'Consecutive shots of the product make a walkthrough. In a pitch the interface is a ' +
        'cutaway, with the story either side of it.',
      sceneIds: [...new Set(runs)],
    });
  }

  const total = ordered.reduce((sum, scene) => sum + scene.duration, 0);
  const onProduct = ordered.filter(shows).reduce((sum, scene) => sum + scene.duration, 0);
  if (total > 0 && onProduct / total > ceiling) {
    drift.push({
      kind: 'over_ceiling',
      message:
        `The product is on screen for ${Math.round((onProduct / total) * 100)}% of this pitch; ` +
        `above ${Math.round(ceiling * 100)}% it is a demonstration with an introduction.`,
      sceneIds: ordered.filter(shows).map((scene) => scene.id),
    });
  }

  return drift;
}
