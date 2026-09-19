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
 * And the point past which it is not a pitch at all.
 *
 * The 20% above is a strong default, not a creative law: a director with a
 * reason may exceed it, and plenty of good films about a product spend longer
 * than a fifth of themselves looking at it. What cannot be argued is a film
 * that is mostly interface — at that point the customer asked for one thing
 * and is being handed the other, whatever the intent.
 */
export const PITCH_PRODUCT_LIMIT = 0.45;

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
  /**
   * Whether this stops the film or advises against it.
   *
   * Most of these are signals rather than verdicts. A pitch that opens on a
   * striking frame of the product, or holds two shots of it together, or
   * spends a quarter of itself there, may be exactly what the film wanted —
   * and a system that refuses all three is not a guardrail, it is a director
   * nobody hired overruling the one they did.
   *
   * What blocks is the thing the customer actually chose against: a film led
   * by navigating the interface. Driving it is that outright. So is a film
   * that is mostly interface. So is every structural signal firing at once,
   * because one is a choice and all of them together is a tour with the
   * lights turned down.
   */
  severity: 'blocking' | 'advisory';
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
  options: { ceiling?: number; limit?: number } = {},
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
      severity: 'blocking',
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
      severity: 'advisory',
      message:
        'This pitch opens on the product. The first shot is what a film is about, so this had ' +
        'better be deliberate.',
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
      severity: 'advisory',
      message:
        'Consecutive shots of the product read as a walkthrough. In a pitch the interface is ' +
        'usually a cutaway, with the story either side of it.',
      sceneIds: [...new Set(runs)],
    });
  }

  const total = ordered.reduce((sum, scene) => sum + scene.duration, 0);
  const onProduct = ordered.filter(shows).reduce((sum, scene) => sum + scene.duration, 0);
  const share = total > 0 ? onProduct / total : 0;
  if (share > ceiling) {
    /*
     * A default, and then a limit.
     *
     * Past the default this says so and lets the director answer for it —
     * plenty of good films about a product spend longer than a fifth of
     * themselves looking at it. Past the limit there is nothing to answer:
     * a film that is mostly interface is the thing the customer chose
     * against, whatever was intended by it.
     */
    const beyondLimit = share > (options.limit ?? PITCH_PRODUCT_LIMIT);
    drift.push({
      kind: 'over_ceiling',
      severity: beyondLimit ? 'blocking' : 'advisory',
      message: beyondLimit
        ? `The product is on screen for ${Math.round(share * 100)}% of this pitch. Past ` +
          `${Math.round((options.limit ?? PITCH_PRODUCT_LIMIT) * 100)}% it is not a pitch about ` +
          'a product, it is a demonstration with an introduction.'
        : `The product is on screen for ${Math.round(share * 100)}% of this pitch, above the ` +
          `${Math.round(ceiling * 100)}% this format usually holds to. Worth being sure the ` +
          'story is still leading.',
      sceneIds: ordered.filter(shows).map((scene) => scene.id),
    });
  }

  /*
   * And the combination. Each signal on its own is a choice a director can
   * defend; a film that opens on the interface, cuts two shots of it together
   * *and* spends more than the default on it is not making three choices, it
   * is a tour with the lights turned down.
   */
  const signals = drift.filter((entry) => entry.severity === 'advisory');
  if (signals.length >= 3) {
    drift.push({
      kind: 'product_spine',
      severity: 'blocking',
      message:
        'This film opens on the product, cuts its product shots together and spends more than ' +
        'the usual share on them. Any one of those is a choice; all three is a product tour.',
      sceneIds: [...new Set(signals.flatMap((entry) => entry.sceneIds))],
    });
  }

  return drift;
}

/** Whether this film has stopped being led by its story. */
export function pitchIsNavigationLed(drift: readonly PitchDrift[]): boolean {
  return drift.some((entry) => entry.severity === 'blocking');
}
