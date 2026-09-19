import { FILM_CUTS, SHORT_SILENCE_BUDGET, type FilmCut } from '@act-one/core';
import type { CreativeSystem, SceneArchetype } from './types.ts';

/**
 * A creative system, cut for the feed.
 *
 * A short is not the long film played faster — it carries fewer ideas — but
 * each shot in it does hold for less time, because somebody who did not choose
 * to watch gives a shot roughly half the patience of somebody who did. Holding
 * a 3.6-second statement card in a reel is how a vertical film reads as a
 * landscape film somebody cropped.
 *
 * Scaling the system rather than the finished scenes is what makes this hold
 * everywhere at once: the archetype ranges, the timing constraints' floor and
 * ceiling, the estimate of how many scenes fit, and the preferred duration all
 * read from the same numbers. Scale them in one place and the whole engine is
 * cutting to the right rhythm; scale the output instead and every one of those
 * is still working to the wrong one.
 *
 * What is never scaled is the floor that comes from the content — how long a
 * line takes to read, how long a sentence takes to say. A format cannot make
 * words shorter, and a shot trimmed below its own copy is a shot nobody can
 * read. Those floors are applied downstream, after this.
 */
export function pacedForCut(
  system: CreativeSystem,
  archetypes: SceneArchetype[],
  cut: FilmCut,
): { system: CreativeSystem; archetypes: SceneArchetype[] } {
  const pace = FILM_CUTS[cut].pace;
  if (pace === 1) return { system, archetypes };

  /*
   * A floor, because the scale is a multiplier and a fast system multiplied
   * again produces shots below the length at which anything registers. The
   * figure is the shortest shot a viewer reads as a shot rather than a flash —
   * below it the cut stops being a cut and becomes a strobe.
   */
  const FLOOR = 0.6;
  const scale = (seconds: number) => round1(Math.max(FLOOR, seconds * pace));

  return {
    system: {
      ...scaledEdges(system, pace),
      pacing: {
        ...system.pacing,
        averageSceneSeconds: scale(system.pacing.averageSceneSeconds),
        sceneRange: [scale(system.pacing.sceneRange[0]), scale(system.pacing.sceneRange[1])],
        /*
         * Quiet is a tool in a feed, not a default.
         *
         * A silence budget written for a film somebody chose to watch is dead
         * air by another name: two to four seconds, which at twenty seconds of
         * runtime is a fifth of the film spent on nothing. But zero was the
         * other mistake — a micro-pause before a payoff, or a beat of quiet
         * against a dense cut, is one of the few ways this format creates
         * tension at all. Cut hard, not to nothing.
         */
        silenceBudget:
          cut === 'short'
            ? Math.min(SHORT_SILENCE_BUDGET, round1(system.pacing.silenceBudget * pace))
            : round1(system.pacing.silenceBudget * pace),
      },
    },
    archetypes: archetypes.map((archetype) => ({
      ...archetype,
      durationRange: [scale(archetype.durationRange[0]), scale(archetype.durationRange[1])],
    })),
  };
}

/**
 * The openings and endings, cut to the same rhythm.
 *
 * Kept out of the object above only because both are read through their own
 * accessors; they are scaled for the same reason everything else is. Three
 * seconds of end card in a twenty-second reel is a seventh of the film spent
 * on a logo, which is what a viewer scrolls away from.
 */
function scaledEdges(system: CreativeSystem, pace: number): CreativeSystem {
  const FLOOR = 0.6;
  const scale = (seconds: number) => round1(Math.max(FLOOR, seconds * pace));
  const range = (r: readonly [number, number]): [number, number] => [scale(r[0]), scale(r[1])];
  return {
    ...system,
    openings: system.openings.map((opening) => ({
      ...opening,
      durationRange: range(opening.durationRange),
    })),
    endings: system.endings.map((ending) => ({
      ...ending,
      durationRange: range(ending.durationRange),
    })),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
