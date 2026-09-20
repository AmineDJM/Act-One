import { REAL_PRODUCT_VISUAL_TYPES, storyboardDuration, type Scene, type Storyboard } from '@act-one/core';

/**
 * How the film stops.
 *
 * There is one ending in automated video and everybody has heard it: the logo
 * arrives, a big warm note plays under it, the music fades. It is not wrong.
 * It is the sound of a film that did not decide anything, and it is
 * interchangeable across every company that has ever used it — which makes it
 * the exact opposite of what an ending is for.
 *
 * An ending belongs to its film. Which one belongs is readable from the cut
 * itself: a film that has been operating an interface can end on the sound
 * that interface makes; a film that has been building can stop dead; a film
 * that has been loud can end by subtracting until there is one thing left. So
 * this reads the film and chooses, rather than applying the same gesture to
 * everything and calling the result a signature.
 *
 * "Specific beats dramatic" is the whole rule.
 */
export type EndingStrategy =
  /** The last thing the product did, alone, with the music already gone. */
  | 'product_sound_last'
  /** Instruments drop away one at a time until one is left holding the frame. */
  | 'subtract_to_one'
  /** It stops. No fade, no resolution, on the cut. */
  | 'hard_stop'
  /** The last seconds are silent, and the silence is the point. */
  | 'let_it_go_quiet'
  /** A single small, precise mark — not a swell. */
  | 'small_impact';

export type EndingPlan = {
  strategy: EndingStrategy;
  /** Why this film ends this way. Recorded so a person can disagree with it. */
  reason: string;
  /** Whether the score's own tail is used, or the music is out before the end. */
  musicOutSeconds: number;
  /** A sting is a decision now, and almost always the wrong one. */
  sting: boolean;
};

/** Below this share of the film being operated, there is no product sound to end on. */
const OPERATED_ENOUGH = 0.12;

export function planEnding(
  storyboard: Storyboard,
  options: { loud: boolean; hasVoiceOver: boolean },
): EndingPlan {
  const runtime = storyboardDuration(storyboard);
  const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
  const last = scenes[scenes.length - 1];

  const operated = scenes.filter((scene) =>
    (scene.uiSequence?.framings ?? []).some((framing) =>
      framing.layers.some((layer) => layer.role === 'control'),
    ),
  );
  const operatedShare = runtime > 0 ? operated.reduce((sum, scene) => sum + scene.duration, 0) / runtime : 0;

  /*
   * A film that has spent its running time operating an interface has already
   * taught the audience a sound. Ending on it — the confirmation, alone, with
   * the music gone — is an ending only this film could have, which is the
   * entire specification.
   */
  if (operatedShare >= OPERATED_ENOUGH) {
    return {
      strategy: 'product_sound_last',
      reason:
        'The film has been operating the product, so the audience already knows what it sounds like ' +
        'when something lands. The music clears and that sound is the last thing.',
      musicOutSeconds: Math.min(2.4, runtime * 0.08),
      sting: false,
    };
  }

  // A held, wordless last frame wants air rather than a gesture over it.
  if (last && last.onScreenText.every((line) => line.trim().length === 0) && last.duration >= 1.6) {
    return {
      strategy: 'let_it_go_quiet',
      reason: 'The last frame is held and wordless; a sting over it would be filling a silence that is working.',
      musicOutSeconds: Math.min(1.8, last.duration * 0.7),
      sting: false,
    };
  }

  if (options.loud) {
    return {
      strategy: 'subtract_to_one',
      reason: 'The film has been dense, so it ends by taking things away rather than by adding a note.',
      musicOutSeconds: 2.2,
      sting: false,
    };
  }

  /*
   * A film that ends on a line somebody is still reading should not be
   * interrupted by a chord; it should stop, and let the line be the last
   * thing in the room.
   */
  const endsOnWords = Boolean(last && last.onScreenText.some((line) => line.trim().length > 0));
  if (endsOnWords && !options.hasVoiceOver) {
    return {
      strategy: 'hard_stop',
      reason: 'It ends on a line. The music stops with the picture so the words are the last thing, not a chord.',
      musicOutSeconds: 0,
      sting: false,
    };
  }

  return {
    strategy: 'small_impact',
    reason: 'One precise mark on the last cut. Small, because the film has not earned a swell.',
    musicOutSeconds: 1.4,
    sting: false,
  };
}

/**
 * Whether a finished soundtrack is the one every SaaS film has.
 *
 * Deliberately narrow: three specific habits, all of which this system has
 * produced on its own and one of which it produced by default. Taste is not
 * checkable; these are.
 */
export function genericEnding(cues: readonly { type: string; atSeconds: number }[], runtime: number): string | null {
  const late = cues.filter((cue) => cue.atSeconds > runtime - 3.5);
  const sting = late.some((cue) => cue.type === 'logo_sting');
  const impact = late.some((cue) => cue.type === 'impact');
  if (sting && impact) {
    return 'The film ends on a logo sting under an impact, which is the ending every automated product film has.';
  }
  if (sting) {
    return 'The film ends on a logo sting. It is the default gesture, and it belongs to no film in particular.';
  }
  return null;
}

/** Shots whose sound is the product's own, for a film that wants to end on one. */
export function productSounds(storyboard: Storyboard): Scene[] {
  return storyboard.scenes.filter(
    (scene) =>
      REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) &&
      (scene.uiSequence?.framings ?? []).some((framing) =>
        framing.layers.some((layer) => layer.role === 'control' || layer.role === 'overlay'),
      ),
  );
}
