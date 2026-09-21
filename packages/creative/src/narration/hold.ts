/**
 * Holding the picture for the read.
 *
 * WHICH WAY THE FIT GOES. When a line runs past the shot it belongs to there
 * are three things a director can do, and two of them are wrong. Speeding the
 * read up past about 1.1x is audible as speeding up, and it is audible exactly
 * on the lines that were already the densest. Letting it spill puts its last
 * words on the next picture, which is the one narration fault an audience
 * always hears and a waveform never shows. The third is to hold the shot a
 * little longer, which costs runtime and nothing else — and a launch film's
 * runtime is not a constraint anybody set.
 *
 * `narration/fit.ts` is the other half of this and runs first: rewriting a line
 * shorter is still the better answer wherever a line can lose a word without
 * losing its meaning. This is for when it cannot.
 *
 * None of it is possible unless the read happens BEFORE the picture is
 * rendered, and unless a line's position is expressed relative to its own shot
 * rather than as a time typed against one particular cut.
 */

/** A read, measured, before it knows where on the film's clock it goes. */
export type MeasuredTake = {
  sceneId: string;
  /** How far into its own shot the line starts. */
  delaySeconds: number;
  durationSeconds: number;
};

/** The cut, as far as this needs to know it. */
export type ShotTiming = { id: string; durationSeconds: number };

/** A take placed on the film's clock, once the cut is known. */
export type PlacedTake = MeasuredTake & {
  atSeconds: number;
  /** Room between this line's start and its shot's end. */
  windowSeconds: number;
  /** How far past its shot the read runs. Zero is what we want. */
  overrunSeconds: number;
};

/**
 * Puts the takes on the film's clock, and says which ones do not fit.
 *
 * Start times come from the cut rather than from a table, so a shot that
 * changes length carries its line with it.
 */
export function place<T extends MeasuredTake>(
  takes: readonly T[],
  scenes: readonly ShotTiming[],
): (T & PlacedTake)[] {
  const starts = new Map<string, number>();
  const lengths = new Map<string, number>();
  let at = 0;
  for (const scene of scenes) {
    starts.set(scene.id, at);
    lengths.set(scene.id, scene.durationSeconds);
    at += scene.durationSeconds;
  }
  return takes.map((take) => {
    const start = starts.get(take.sceneId) ?? 0;
    const window = (lengths.get(take.sceneId) ?? 0) - take.delaySeconds;
    return {
      ...take,
      atSeconds: start + take.delaySeconds,
      windowSeconds: window,
      overrunSeconds: Math.max(0, take.durationSeconds - window),
    };
  });
}

/**
 * THE READ IS NOT STRETCHED TO FIT THE PICTURE. The picture is held to fit the read.
 *
 * When a line runs past its shot there are three things one can do, and two of
 * them are wrong. Speeding the read up past about 1.1x is audible as speeding
 * up, and it is audible precisely on the lines that were already the densest.
 * Letting it spill puts its last words on the next picture, which is the one
 * narration fault an audience always hears. The third is to hold the shot a
 * little longer, which costs runtime and nothing else — and a launch film's
 * runtime is not a constraint anybody set.
 *
 * So this returns the durations the cut should have. Rewriting the line shorter
 * is still the better answer where a line can lose a word without losing its
 * meaning, and it is what was done to three of these; this is for when it
 * cannot.
 *
 * `maxTotalSeconds` is a guard, not a target: without one, a bad batch of reads
 * could add ten seconds to a film nobody asked to be longer.
 */
export function retimeForNarration(
  scenes: readonly ShotTiming[],
  placed: readonly PlacedTake[],
  options: { tailSeconds?: number; ignoreBelow?: number; maxTotalSeconds?: number } = {},
): { durations: Map<string, number>; addedSeconds: number; held: string[] } {
  const tail = options.tailSeconds ?? 0.2;
  const ignoreBelow = options.ignoreBelow ?? 0.12;
  const budget = options.maxTotalSeconds ?? 4;

  const durations = new Map(scenes.map((scene) => [scene.id, scene.durationSeconds]));
  const held: string[] = [];
  let added = 0;

  // Worst overrun first, so a tight budget buys the most audible fixes.
  for (const take of [...placed].sort((a, b) => b.overrunSeconds - a.overrunSeconds)) {
    if (take.overrunSeconds <= ignoreBelow) continue;
    const want = take.overrunSeconds + tail;
    const give = Math.min(want, budget - added);
    if (give <= 0.01) continue;
    durations.set(take.sceneId, round(( durations.get(take.sceneId) ?? 0) + give));
    held.push(`${take.sceneId} +${give.toFixed(2)}s`);
    added += give;
  }
  return { durations, addedSeconds: round(added), held };
}

/** Two decimal places: a frame at 30fps is 0.033s, so more precision is noise. */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
