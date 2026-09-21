import type { MeasuredTake, ShotTiming } from './hold.ts';

/**
 * Timing the read to the cut.
 *
 * WHY THIS EXISTS. Two critics with different evidence — one watching the film,
 * one hearing only the mix — independently scored `emphasisMatchesTypography`
 * as the weakest thing about the narration. That agreement is worth more than
 * either score: it is the one fault neither a different voice, nor a different
 * model, nor the stability dial has moved, across five candidates and three
 * sweeps. What they heard was "pacing ignores visual cues, rushing through
 * transitions where deliberate pauses would build anticipation", and "the
 * delivery of the word 'Three' is entirely flat, missing the necessary visual
 * punch".
 *
 * They were right, and the cause is not in the read. Each line started at a
 * delay somebody typed — 0.25s, 0.3s, 0.4s — chosen once, against a cut that
 * has changed many times since. The words on screen arrive on their own
 * schedule, and nothing connected the two.
 *
 * THE RULE. A line starts when its shot's own words have landed, plus a beat.
 * Not before, because the voice would then be explaining something the viewer
 * cannot yet see; not much after, because the frame goes dead. The shot itself
 * already knows when that is — every text object declares its `enterAt` — so
 * the timing is derived from the picture rather than guessed alongside it.
 *
 * A shot with no words of its own keeps its own delay: there is nothing to
 * land with, and the opening shot in particular wants the voice immediately.
 */

/** What this needs to know about a shot: when it starts, and when its words arrive. */
export type ShotWords = ShotTiming & {
  /**
   * When the shot's own copy lands, in seconds from the shot's start.
   *
   * The LAST of them, not the first. A shot whose line staggers in word by word
   * has not said its piece until the last word is up, and a voice that starts
   * on the first one talks over the sentence being written.
   */
  wordsAtSeconds: number | null;
};

export type AlignOptions = {
  /** How long after the words land the voice comes in. */
  beatSeconds?: number;
  /**
   * Never start a line later than this into its shot, whatever the words do.
   *
   * A guard rather than a target: a shot whose copy arrives late would
   * otherwise push its line past its own end, and holding the picture for a
   * line that has not started yet is not the trade `retimeForNarration` is for.
   */
  latestSeconds?: number;
};

/**
 * Re-times each take to its shot's typography, and says what it moved.
 *
 * Returns takes rather than mutating them, so a caller can compare the two
 * timings and a test can assert the difference.
 */
export function alignToTypography<T extends MeasuredTake>(
  takes: readonly T[],
  shots: readonly ShotWords[],
  options: AlignOptions = {},
): { takes: T[]; moved: string[] } {
  const beat = options.beatSeconds ?? 0.18;
  const latest = options.latestSeconds ?? 1.6;
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const moved: string[] = [];

  const aligned = takes.map((take) => {
    const shot = byId.get(take.sceneId);
    if (!shot || shot.wordsAtSeconds === null) return take;

    const wanted = round(Math.min(shot.wordsAtSeconds + beat, latest));
    // A shot's words can land so late that there is no room left to read in;
    // the line stays where it was rather than being pushed off its own shot.
    if (wanted + take.durationSeconds > shot.durationSeconds) return take;
    if (Math.abs(wanted - take.delaySeconds) < 0.05) return take;

    moved.push(`${take.sceneId} ${take.delaySeconds.toFixed(2)}s -> ${wanted.toFixed(2)}s`);
    return { ...take, delaySeconds: wanted };
  });

  return { takes: aligned, moved };
}

/**
 * When a shot's copy has finished arriving.
 *
 * `enterAt` is when an object starts appearing and `staggerSeconds` is how far
 * apart its words are, so a staggered line is not fully up until its last word
 * is — which is the moment the frame actually says what it says.
 */
export function wordsLandAt(
  objects: readonly {
    kind: string;
    role?: string | null;
    content?: string | null;
    enterAt?: number | null;
    staggerBy?: string | null;
    staggerSeconds?: number | null;
  }[],
): number | null {
  let latest: number | null = null;
  for (const object of objects) {
    if (object.kind !== 'text') continue;
    // Structure is furniture — an index number, a rule. The payload is the line
    // the shot is about, and it is the one the voice has to agree with.
    if (object.role === 'structure') continue;
    const words = (object.content ?? '').trim().split(/\s+/).filter(Boolean).length;
    const stagger = object.staggerBy === 'word' ? (object.staggerSeconds ?? 0) * Math.max(0, words - 1) : 0;
    const at = (object.enterAt ?? 0) + stagger;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
