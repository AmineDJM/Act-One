import { z } from 'zod';
import { nonEmpty } from '../zod-helpers.ts';
import { storyboardDuration, type Scene, type Storyboard } from './storyboard.ts';

/**
 * A score written for one film.
 *
 * The difference between a launch film and a video with music on it is whether
 * the music knows what the picture is doing. A track chosen from a library is
 * the same track whatever happens on screen: it arrives at its own climax,
 * fades where it always fades, and the cut has to survive it. A score written
 * for the film changes where the film changes.
 *
 * So a score is a sequence of movements, each with its own length and its own
 * direction, laid against the storyboard's own turns. The composer is told
 * what is on screen during each one — not the copy, which it cannot read, but
 * what the moment is for.
 *
 * Two constraints come from the engine and shape everything here: a movement
 * cannot be shorter than three seconds, and there can be at most thirty of
 * them. A fifteen-second film therefore gets three movements at most, which is
 * correct anyway — a fifteen-second film with six musical ideas is a mess.
 */
export const MOVEMENT_MIN_SECONDS = 3;
export const MOVEMENT_MAX_SECONDS = 120;
export const MOVEMENTS_MAX = 30;

export const ScoreMovement = z.object({
  /** Which turn of the film this is: `[Open]`, `[Build]`, `[Resolve]`. */
  name: nonEmpty(40),
  /**
   * What the music does here, written the way a director talks to a composer:
   * what it is for, what it must not do. Never the film's copy — the composer
   * cannot read the screen and does not need to.
   */
  direction: nonEmpty(600),
  seconds: z.number().min(MOVEMENT_MIN_SECONDS).max(MOVEMENT_MAX_SECONDS),
  /** Instruments, tempo, texture. English, because the engine reads English best. */
  styles: z.array(nonEmpty(60)).min(1).max(12),
  /** What would ruin it: vocals, a drop, a genre this brand is not. */
  avoid: z.array(nonEmpty(60)).max(12).default([]),
  /**
   * How closely this movement follows the one before it.
   *
   * High keeps a single idea developing; low lets the music turn where the
   * film turns. The opening is always high — a score that argues with itself
   * in its first three seconds sounds like two tracks.
   */
  adherence: z.enum(['low', 'medium', 'high']).default('high'),
});
export type ScoreMovement = z.infer<typeof ScoreMovement>;

export const FilmScore = z.object({
  movements: z.array(ScoreMovement).min(1).max(MOVEMENTS_MAX),
  /** Never sung. A launch film with lyrics is a advertisement for the song. */
  instrumental: z.literal(true).default(true),
  /** Kept so a re-run of the same film gets the same score. */
  seed: z.number().int().nonnegative().nullable().default(null),
});
export type FilmScore = z.infer<typeof FilmScore>;

export function scoreSeconds(score: Pick<FilmScore, 'movements'>): number {
  return score.movements.reduce((total, movement) => total + movement.seconds, 0);
}

/**
 * Where a film turns, in seconds.
 *
 * A turn is a scene boundary the music should notice: the first cut after the
 * opening statement, the moment the product arrives, the last scene. Not every
 * scene boundary — a five-scene film does not need five musical ideas — so
 * boundaries are merged until each movement earns its three seconds.
 */
export function movementBoundaries(storyboard: { scenes: readonly Pick<Scene, 'duration'>[] }, maxMovements = 5): number[] {
  const scenes = storyboard.scenes;
  if (scenes.length === 0) return [];
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (total < MOVEMENT_MIN_SECONDS) return [];

  // Every scene start, then merged forward until each span is long enough.
  const starts: number[] = [];
  let at = 0;
  for (const scene of scenes) {
    starts.push(at);
    at += scene.duration;
  }

  const kept: number[] = [];
  let anchor = 0;
  for (const start of starts) {
    if (kept.length === 0) {
      kept.push(0);
      anchor = 0;
      continue;
    }
    if (start - anchor >= MOVEMENT_MIN_SECONDS && total - start >= MOVEMENT_MIN_SECONDS) {
      kept.push(start);
      anchor = start;
    }
  }

  // Too many turns is worse than too few: keep the ones furthest apart.
  while (kept.length > Math.min(maxMovements, MOVEMENTS_MAX)) {
    let tightest = 1;
    let smallest = Infinity;
    for (let index = 1; index < kept.length; index += 1) {
      const span = (kept[index + 1] ?? total) - kept[index - 1]!;
      if (span < smallest) {
        smallest = span;
        tightest = index;
      }
    }
    kept.splice(tightest, 1);
  }
  return kept;
}

/** The scenes that play during a movement, for telling the composer what is on screen. */
export function scenesInMovement<T extends { duration: number }>(
  storyboard: { scenes: readonly T[] },
  fromSeconds: number,
  toSeconds: number,
): T[] {
  const inside: T[] = [];
  let at = 0;
  for (const scene of storyboard.scenes) {
    const end = at + scene.duration;
    if (end > fromSeconds + 0.01 && at < toSeconds - 0.01) inside.push(scene);
    at = end;
  }
  return inside;
}

/**
 * Makes a score playable: the movements sum to the film, and each one is long
 * enough for the engine to compose it.
 *
 * Rounding is where this goes wrong in practice. Scene durations are decimals,
 * the engine takes whole milliseconds, and a score that is 200ms short of the
 * picture leaves the last cut in silence — so the remainder always lands on
 * the final movement rather than being spread and lost.
 */
export function fitScore(score: FilmScore, filmSeconds: number): FilmScore {
  const movements = [...score.movements];
  if (movements.length === 0 || filmSeconds < MOVEMENT_MIN_SECONDS) return score;

  // Drop movements that cannot be composed, from the shortest, until the rest fit.
  while (movements.length > 1 && movements.length * MOVEMENT_MIN_SECONDS > filmSeconds) {
    let shortest = 0;
    for (let index = 1; index < movements.length; index += 1) {
      if (movements[index]!.seconds < movements[shortest]!.seconds) shortest = index;
    }
    movements.splice(shortest, 1);
  }

  const asked = movements.reduce((sum, movement) => sum + movement.seconds, 0);
  const scale = asked > 0 ? filmSeconds / asked : 1;
  let used = 0;
  const fitted = movements.map((movement, index) => {
    const last = index === movements.length - 1;
    const seconds = last
      ? Math.max(MOVEMENT_MIN_SECONDS, round(filmSeconds - used))
      : Math.max(MOVEMENT_MIN_SECONDS, round(movement.seconds * scale));
    used += seconds;
    return { ...movement, seconds: Math.min(seconds, MOVEMENT_MAX_SECONDS) };
  });

  return { ...score, movements: fitted };
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * The brief for one sound effect, written from what the shot does.
 *
 * A library search asks "what kind of whoosh?" and gets the same whoosh every
 * film. This asks for the sound of this particular thing happening, which is
 * what a sound designer would record or build.
 */
export const EffectBrief = z.object({
  cueId: z.string(),
  /** What the sound is, in a sentence. No brand names, no copy. */
  brief: nonEmpty(400),
  seconds: z.number().min(0.5).max(22),
  /** 0–1. High follows the brief exactly; low lets the engine be musical. */
  influence: z.number().min(0).max(1).default(0.45),
  loop: z.boolean().default(false),
});
export type EffectBrief = z.infer<typeof EffectBrief>;

/** The film's length, for anything that needs the score to match the picture. */
export function filmSecondsOf(storyboard: Storyboard): number {
  return storyboardDuration(storyboard);
}
