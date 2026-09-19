import {
  ATTENTION_RESET_SECONDS,
  PATTERN_INTERRUPT_SECONDS,
  PAYOFF_BY,
  SHORT_STRUCTURE,
  MIN_SHOT_SECONDS,
  shortBeatAt,
  type CameraRecipe,
  type Scene,
  type ShortBeatId,
} from '@act-one/core';
import type { TimingConstraint } from './timing.ts';

/**
 * The cut for a feed.
 *
 * Everything else in this package treats a short as the classic film with its
 * numbers scaled, which is the mistake the whole module exists to correct. A
 * reel is a different medium: the viewer did not choose it, is not listening,
 * and leaves at any moment at no cost. That changes the shape of the edit,
 * not just its speed.
 *
 * Three things here that scaling cannot do.
 *
 * The first is the curve. A classic film opens with room and builds; a short
 * opens at its fastest, because the first second is the only one it is
 * guaranteed, and then breathes slightly as the viewer commits. Scaling a
 * classic curve produces a film that is uniformly quick and still opens on a
 * hold, which is the worst of both.
 *
 * The second is the reset. Attention decays against a static frame far faster
 * than against a moving one, and a feed viewer has an alternative one thumb
 * away. So something changes at least every two seconds — the framing, the
 * scale, the subject or what the type is doing. Not a cut for its own sake:
 * cutting every two seconds regardless is what "made for TikTok" means as an
 * insult, and it is not what good work in this format does.
 *
 * The third is where the payoff lands. A film whose point arrives at the end
 * is a film most of its audience never reached.
 */

/** Seconds a shot may run before something must change on screen. */
export { ATTENTION_RESET_SECONDS };

/**
 * The retention curve, as a multiplier on each shot's preferred length.
 *
 * Fastest at the top and tightening again at the close, with the middle given
 * marginally more room — which is where the film has earned some. The numbers
 * are house and deliberately mild: a curve that swings hard reads as a film
 * that cannot decide, and the point is a shape, not a gimmick.
 */
export function retentionCurve(fraction: number): number {
  const beat = shortBeatAt(fraction);
  const byBeat: Record<ShortBeatId, number> = {
    hook: 0.72,
    curiosity: 0.88,
    escalation: 1.06,
    payoff: 1.02,
    close: 0.8,
  };
  return byBeat[beat];
}

/**
 * Re-shapes a short's timing along the retention curve.
 *
 * Runs after the film has been fitted to its runtime and preserves that total:
 * every second taken off the opening is given back in the middle, so the film
 * is the length the customer asked for and is cut like a short rather than
 * like a classic film in a hurry.
 */
export function shortRhythm(
  durations: Map<string, number>,
  constraints: TimingConstraint[],
): Map<string, number> {
  if (constraints.length === 0) return durations;

  const target = [...durations.values()].reduce((sum, seconds) => sum + seconds, 0);
  if (target <= 0) return durations;

  // Where each shot sits in the film, which is what decides its multiplier.
  let elapsed = 0;
  const placed = constraints.map((constraint) => {
    const seconds = durations.get(constraint.id) ?? constraint.preferred;
    const at = elapsed / target;
    elapsed += seconds;
    return { constraint, seconds, at };
  });

  const shaped = new Map(
    placed.map(({ constraint, seconds, at }) => {
      const wanted = seconds * retentionCurve(at);
      /*
       * The floor is the shortest shot that registers as a shot, and the
       * content's own floor above that: a line nobody can read in the time it
       * is on screen is not a fast cut, it is a mistake.
       */
      const floor = Math.max(MIN_SHOT_SECONDS, constraint.min);
      return [constraint.id, round3(clamp(wanted, floor, Math.max(floor, constraint.max)))] as const;
    }),
  );

  return rebalance(shaped, constraints, target);
}

/**
 * Puts back whatever the curve took out, where there is room for it.
 *
 * Without this the curve is a trim: every multiplier below one shortens the
 * film, and a twenty-four second reel comes out at nineteen. The shape is the
 * point; the length is the customer's.
 */
function rebalance(
  shaped: Map<string, number>,
  constraints: TimingConstraint[],
  target: number,
): Map<string, number> {
  const result = new Map(shaped);
  for (let pass = 0; pass < 12; pass += 1) {
    const total = [...result.values()].reduce((sum, seconds) => sum + seconds, 0);
    const delta = target - total;
    if (Math.abs(delta) <= 0.15) break;

    // The opening and the close keep their shape: they are the two shots the
    // format is most particular about, so the middle absorbs the difference.
    const flexible = constraints
      .filter((constraint) => shortBeatAt(positionOf(constraint.id, constraints, result, target)) !== 'hook')
      .map((constraint) => {
        const now = result.get(constraint.id) ?? constraint.preferred;
        const floor = Math.max(MIN_SHOT_SECONDS, constraint.min);
        const room = delta > 0 ? Math.max(0, constraint.max - now) : Math.max(0, now - floor);
        return { constraint, now, room, floor };
      })
      .filter((entry) => entry.room > 0.001);

    const available = flexible.reduce((sum, entry) => sum + entry.room, 0);
    if (available <= 0.001) break;

    const move = Math.min(Math.abs(delta), available) * Math.sign(delta);
    for (const entry of flexible) {
      const share = (entry.room / available) * move;
      result.set(
        entry.constraint.id,
        round3(clamp(entry.now + share, entry.floor, Math.max(entry.floor, entry.constraint.max))),
      );
    }
  }
  return result;
}

function positionOf(
  id: string,
  constraints: TimingConstraint[],
  durations: Map<string, number>,
  target: number,
): number {
  let elapsed = 0;
  for (const constraint of constraints) {
    if (constraint.id === id) return target > 0 ? elapsed / target : 0;
    elapsed += durations.get(constraint.id) ?? constraint.preferred;
  }
  return 1;
}

/**
 * Shots that hold one arrangement for longer than attention survives.
 *
 * A reset is any of: a cut to a different kind of shot, a camera that moves,
 * a change of scale, or type that arrives. A shot that has none of those and
 * runs past the window is a still frame in a feed, which is a scroll.
 */
export function heldTooLong(
  scenes: readonly Scene[],
  windowSeconds = ATTENTION_RESET_SECONDS,
): Scene[] {
  return scenes.filter((scene) => scene.duration > windowSeconds && !resets(scene));
}

/** Whether anything in this shot moves, changes scale, or arrives. */
export function resets(scene: Scene): boolean {
  const camera: CameraRecipe = scene.cameraRecipe;
  if (camera.move !== 'static') return true;
  if (Math.abs(camera.toScale - camera.fromScale) > 0.02) return true;
  if (Math.abs(camera.toX - camera.fromX) > 0.01 || Math.abs(camera.toY - camera.fromY) > 0.01) return true;
  // Type that arrives in sequence is itself a reset: the frame at two seconds
  // is not the frame at one.
  if (scene.motionRecipe.stagger > 0.01 && scene.onScreenText.length > 1) return true;
  if (scene.visualType === 'generated_broll' || scene.visualType === 'cinematic_3d') return true;
  return false;
}

/**
 * Whether the opening is a pattern interrupt rather than an introduction.
 *
 * The question is not whether the first shot is good. It is whether anything
 * has been said by the time the viewer decides, so a logo, a bare transition
 * or an empty frame at the top fails regardless of what follows it.
 */
export function opensOnAPatternInterrupt(
  scenes: readonly Scene[],
  windowSeconds = PATTERN_INTERRUPT_SECONDS,
): boolean {
  let elapsed = 0;
  for (const scene of scenes) {
    const carriesSomething =
      scene.onScreenText.some((line) => line.trim().length > 0) || scene.assetRefs.length > 0;
    const isSetup = scene.visualType === 'logo_reveal' || scene.visualType === 'transition';
    if (!isSetup && carriesSomething) return elapsed <= windowSeconds;
    elapsed += scene.duration;
    if (elapsed > windowSeconds) return false;
  }
  return false;
}

/**
 * Where the film's payoff lands, as a fraction of its runtime.
 *
 * Read from the storyboard rather than asked of a model: the payoff is the
 * last shot that is not the close — the last thing said before the mark.
 */
export function payoffAt(scenes: readonly Scene[]): number {
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (total <= 0) return 1;
  const closing = [...scenes].reverse().find((scene) => scene.visualType !== 'logo_reveal');
  if (!closing) return 1;
  return (closing.startTime + closing.duration) / total;
}

/** Whether the point of the film arrives while people are still watching. */
export function payoffLandsInTime(scenes: readonly Scene[], by = PAYOFF_BY): boolean {
  return payoffAt(scenes) <= by + 0.001;
}

/**
 * The structure, as the planner is given it.
 *
 * Offered as a default rather than imposed: the Creative Director may depart
 * from it where the concept genuinely calls for something else, and says so.
 */
export function shortStructureLines(targetSeconds: number): string[] {
  return SHORT_STRUCTURE.map((beat) => {
    const from = (beat.at[0] * targetSeconds).toFixed(1);
    const to = (beat.at[1] * targetSeconds).toFixed(1);
    return `- ${beat.title} (${from}s–${to}s): ${beat.asks}`;
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Gives a static shot in a short something to do.
 *
 * The attention reset is a real property of the frame rather than a note in a
 * brief: a shot that holds one arrangement past the window is a still picture
 * in a feed, and a still picture in a feed is a scroll. So a shot that would
 * hold gets the gentlest move that changes the frame — a slow push, or a drift
 * where a push would fight the composition.
 *
 * Deliberately small. The failure on the other side is a zoom on every beat,
 * which is what this format looks like when somebody confuses retention with
 * noise, and it is not what the work people admire does. Six percent over two
 * seconds is a frame that is alive, not a frame that is shouting.
 */
export function withAttentionReset(
  camera: CameraRecipe,
  options: { previousMove?: CameraRecipe['move'] } = {},
): CameraRecipe {
  if (camera.move !== 'static') return camera;
  if (Math.abs(camera.toScale - camera.fromScale) > 0.02) return camera;

  // Not the same move twice running: two pushes in a row is one long push
  // with a cut in it, which resets nothing.
  const move = options.previousMove === 'slow_push' ? 'lateral_drift' : 'slow_push';
  return move === 'slow_push'
    ? { ...camera, move, fromScale: 1, toScale: 1.06, depthOfField: Math.max(camera.depthOfField, 0.2) }
    : { ...camera, move, fromX: -0.025, toX: 0.025 };
}

/**
 * Whether this shot may open a short.
 *
 * The mark, a bare transition and an empty frame are all setup, and setup at
 * the top of a reel is the single most reliable way to lose the audience.
 */
export function canOpenAShort(scene: Pick<Scene, 'visualType' | 'onScreenText' | 'assetRefs'>): boolean {
  if (scene.visualType === 'logo_reveal' || scene.visualType === 'transition') return false;
  return (
    scene.onScreenText.some((line) => line.trim().length > 0) ||
    scene.assetRefs.length > 0 ||
    scene.visualType === 'generated_broll' ||
    scene.visualType === 'cinematic_3d'
  );
}
