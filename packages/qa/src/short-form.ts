import {
  ATTENTION_RESET_SECONDS,
  PATTERN_INTERRUPT_SECONDS,
  PAYOFF_BY,
  SHORT_FORM_STANDARDS,
  cite,
  newId,
  type QaIssue,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { heldTooLong, opensOnAPatternInterrupt, payoffAt } from '@act-one/creative';

/**
 * The checks a feed cut has and a classic film does not.
 *
 * Everything here is decidable from the storyboard, which is the point: a
 * short that opens on a logo, holds a still frame for four seconds or lands
 * its payoff on the last shot is broken before a frame is rendered, and
 * finding that out afterwards costs a render and tells the customer something
 * they cannot act on.
 *
 * None of these apply to a classic film, and saying so is half the value. A
 * held opening and a shot given room are what a film somebody chose to watch
 * is *made of*; the same choices in a feed are why nobody saw it.
 */
export function runShortFormChecks(storyboard: Storyboard): QaIssue[] {
  const issues: QaIssue[] = [];
  const scenes = storyboard.scenes;
  if (scenes.length === 0) return issues;

  const film = (
    issue: Omit<QaIssue, 'id' | 'sceneId' | 'atSeconds' | 'detectedBy' | 'evidenceAssetId'> & {
      sceneId?: string | null;
      atSeconds?: number | null;
    },
  ) => {
    issues.push({
      id: newId('evt'),
      sceneId: issue.sceneId ?? null,
      atSeconds: issue.atSeconds ?? null,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      ...issue,
    });
  };

  /*
   * The opening. Not whether the first shot is good — no arithmetic decides
   * that — but whether anything has been said by the time the viewer decides.
   */
  if (!opensOnAPatternInterrupt(scenes)) {
    film({
      check: 'composition',
      severity: 'major',
      sceneId: scenes[0]!.id,
      atSeconds: 0,
      message:
        `This short spends its first ${PATTERN_INTERRUPT_SECONDS} seconds on setup ` +
        `(${cite(SHORT_FORM_STANDARDS.patternInterrupt)}). In a feed the decision is made before ` +
        'the introduction clears the screen.',
      confidence: 1,
      // The engine already moves the strongest shot to the front; a short
      // that still opens on setup needs somebody to look at it.
      repair: 'manual_review',
    });
  }

  /*
   * Frames that hold. A still picture in a feed is a scroll, and the fix is
   * cheap — a push, a drift, a change of scale — so this is worth finding.
   */
  for (const scene of heldTooLong(scenes)) {
    film({
      check: 'composition',
      severity: 'minor',
      sceneId: scene.id,
      atSeconds: scene.startTime,
      message:
        `Shot ${scene.index + 1} holds one arrangement for ${scene.duration.toFixed(1)}s with ` +
        `nothing changing (${cite(SHORT_FORM_STANDARDS.attentionReset)}). Past ` +
        `${ATTENTION_RESET_SECONDS}s a static frame reads as a still picture.`,
      confidence: 0.9,
      // Shortening the hold is the honest fix when nothing in the shot moves.
      repair: 'reduce_duration',
    });
  }

  /*
   * Where the point lands. A film whose payoff is its last shot is a film most
   * of its audience never reached.
   */
  const payoff = payoffAt(scenes);
  if (payoff > PAYOFF_BY + 0.001) {
    const last = lastBeat(scenes);
    film({
      check: 'composition',
      severity: 'minor',
      sceneId: last?.id ?? null,
      atSeconds: last?.startTime ?? null,
      message:
        `The payoff lands at ${Math.round(payoff * 100)}% of the runtime ` +
        `(${cite(SHORT_FORM_STANDARDS.earlyPayoff)}). Past ${Math.round(PAYOFF_BY * 100)}% most ` +
        'of the audience has gone, and they leave without the thing the film was for.',
      confidence: 0.8,
      repair: 'manual_review',
    });
  }

  return issues;
}

/** The last shot that is not the end card: the last thing the film says. */
function lastBeat(scenes: readonly Scene[]): Scene | undefined {
  return [...scenes].reverse().find((scene) => scene.visualType !== 'logo_reveal');
}
