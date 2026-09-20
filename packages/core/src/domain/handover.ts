import { z } from 'zod';
import { CONTINUOUS_HANDOVERS, CUT, Handover, type HandoverPlan } from './grammar.ts';
import type { Scene, Storyboard } from './storyboard.ts';

/**
 * How one beat hands over to the next.
 *
 * Until this existed, it could not. Every scene was a Remotion Sequence with a
 * hard frame range and no overlap: scene N ended on frame X and scene N+1
 * began on frame X, so there was no interval in which both existed and
 * therefore no way for anything to survive a boundary. The renderer could
 * produce a beautiful shot and then it could produce another one, and the
 * only join available between them was a replacement.
 *
 * That is not a taste problem, it is an architectural one, and it is the
 * measured difference between Act One and every reference film: they make
 * between 0.9 and 13.7 continuous transformations for each hard cut, and Act
 * One made 0.23.
 *
 * A handover claims an overlap. During it, both scenes are on screen: the
 * outgoing one is leaving — accelerating out, which is what the ease-in
 * families are for and what Act One films never did — and the incoming one is
 * arriving, and one of a small number of mechanisms ties them together.
 */
/**
 * The shortest overlap that reads as a transformation rather than a fast fade.
 *
 * The shortest continuous transformation measured in any reference film is
 * 0.27 seconds. Below about a quarter of a second the eye takes a join as a
 * discontinuity however it was produced, so a plan asking for less than this
 * is recorded as the cut it will actually be — which matters, because
 * counting it as a transformation would be a plan reported as a result.
 */
export const MIN_TRANSFORMATION_SECONDS = 0.25;

/** The longest overlap two scenes can afford without one of them disappearing into it. */
export function maxOverlap(from: Scene, to: Scene): number {
  return Math.max(0, Math.min(3.2, from.duration * 0.45, to.duration * 0.45));
}

/**
 * Whether a handover can actually be performed between these two beats.
 *
 * The honest part. A mark handoff needs a mark on both sides; a plate handoff
 * needs a capture on both sides; a field change needs the two scenes to sit
 * on different fields, or there is nothing to change. Asking for a mechanism
 * the material cannot support is how a plan comes out as a dissolve and gets
 * recorded as a transformation.
 */
export function canHandOver(
  kind: Handover,
  from: Scene,
  to: Scene,
  facts: { fromField: string; toField: string; hasMark: boolean },
): { ok: boolean; because: string } {
  if (kind === 'cut') return { ok: true, because: '' };
  if (maxOverlap(from, to) < MIN_TRANSFORMATION_SECONDS) {
    return { ok: false, because: 'Neither beat is long enough to share an overlap with the other.' };
  }
  switch (kind) {
    case 'object_handoff':
      return facts.hasMark
        ? { ok: true, because: '' }
        : { ok: false, because: 'There is no mark to carry across.' };
    case 'field_change':
      return facts.fromField.toLowerCase() !== facts.toField.toLowerCase()
        ? { ok: true, because: '' }
        : { ok: false, because: 'Both beats sit on the same field, so there is no change to make under the anchor.' };
    case 'scale_through':
      return to.assetRefs.length > 0 || from.assetRefs.length > 0
        ? { ok: true, because: '' }
        : { ok: false, because: 'Nothing to push into: neither beat holds a capture.' };
    case 'morph':
      return from.assetRefs.length > 0 && to.assetRefs.length > 0
        ? { ok: true, because: '' }
        : { ok: false, because: 'A morph needs material on both sides.' };
    case 'mask_reveal':
    case 'camera_carry':
      return { ok: true, because: '' };
  }
}

/**
 * Where every scene actually starts and stops once the overlaps are claimed.
 *
 * `startTime` and `duration` stay the editorial truth — when a beat begins and
 * how long it is the beat the viewer is watching. The window is the render
 * truth: a scene is mounted early enough to arrive and held late enough to
 * leave. The two must not be conflated, because the QA arithmetic, the
 * captions and the sound cues all key off the editorial time.
 */
export type SceneWindow = {
  sceneId: string;
  /** When the scene is first mounted. Earlier than startTime when it arrives into an overlap. */
  fromSeconds: number;
  /** When it is unmounted. Later than startTime + duration when it leaves into one. */
  toSeconds: number;
  /** The overlap it arrives through, and the one it leaves through. */
  arriveSeconds: number;
  departSeconds: number;
};

export function sceneWindows(storyboard: Storyboard): SceneWindow[] {
  const handovers = storyboard.handovers;
  const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
  return scenes.map((scene, index) => {
    const previous = index > 0 ? scenes[index - 1]! : null;
    const arrive = previous ? clampOverlap(handovers[previous.id], previous, scene) : 0;
    const depart = index < scenes.length - 1
      ? clampOverlap(handovers[scene.id], scene, scenes[index + 1]!)
      : 0;
    return {
      sceneId: scene.id,
      /*
       * A scene arrives BEFORE its own start time, inside the outgoing
       * scene's last moments, and departs after its end. That is the whole
       * mechanism: two scenes alive at once, for as long as the join needs.
       */
      fromSeconds: Number(Math.max(0, scene.startTime - arrive).toFixed(3)),
      toSeconds: Number((scene.startTime + scene.duration + depart).toFixed(3)),
      arriveSeconds: Number(arrive.toFixed(3)),
      departSeconds: Number(depart.toFixed(3)),
    };
  });
}

function clampOverlap(plan: HandoverPlan | undefined, from: Scene, to: Scene): number {
  if (!plan || plan.kind === 'cut') return 0;
  return Math.min(plan.seconds, maxOverlap(from, to));
}

/**
 * What the joins in this film amount to.
 *
 * The ratio is the one the whole reference analysis produced, computed the
 * same way here so a film can be judged against the band before it is
 * rendered rather than only after somebody measures the MP4.
 */
export function handoverShape(storyboard: Storyboard): {
  cuts: number;
  transformations: number;
  transformationsPerShot: number;
  byKind: Record<Handover, number>;
  anchored: number;
} {
  const byKind = Object.fromEntries(Handover.options.map((kind) => [kind, 0])) as Record<Handover, number>;
  const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
  let anchored = 0;
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const plan = storyboard.handovers[scenes[index]!.id] ?? CUT;
    const real: Handover =
      plan.kind !== 'cut' &&
      clampOverlap(plan, scenes[index]!, scenes[index + 1]!) >= MIN_TRANSFORMATION_SECONDS
        ? plan.kind
        : 'cut';
    byKind[real] += 1;
    if (real !== 'cut' && plan.anchor) anchored += 1;
  }
  const cuts = byKind.cut;
  const transformations = CONTINUOUS_HANDOVERS.reduce((total, kind) => total + byKind[kind], 0);
  return {
    cuts,
    transformations,
    /*
     * A film with no cuts at all is not infinitely good, so the ratio is
     * reported against at least one notional cut. Every reference has a
     * finite number here and so should we.
     */
    transformationsPerShot: Number((transformations / Math.max(1, cuts)).toFixed(2)),
    byKind,
    anchored,
  };
}
