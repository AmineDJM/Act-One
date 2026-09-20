import { describe, it, expect } from 'vitest';
import {
  CUT,
  Scene,
  Storyboard,
  canHandOver,
  handoverShape,
  maxOverlap,
  sceneWindows,
  type HandoverPlan,
} from '../index.ts';

/**
 * Two scenes on screen at once.
 *
 * Before this, never: each scene held a frame range that ended exactly where
 * the next began, so no material could survive a boundary and the only join
 * the composition could physically produce was a replacement. Every reference
 * film transforms at least as often as it cuts; Act One managed 0.23
 * transformations per cut, and it was an architecture, not a taste.
 */
function scene(index: number, over: Record<string, unknown> = {}): Scene {
  return Scene.parse({
    id: `scn_${index}`, storyboardId: 'sbd_1', index,
    startTime: index * 4, duration: 4,
    purpose: 'a beat', visualType: 'kinetic_typography', motionRecipe: { name: 'word_reveal' },
    cameraRecipe: {}, onScreenText: ['Something'], narration: '', assetRefs: [],
    generativeNeeds: [], status: 'ready', notes: '', ...over,
  });
}

function board(scenes: Scene[], handovers: Record<string, HandoverPlan> = {}): Storyboard {
  return Storyboard.parse({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1',
    version: 1, scenes, handovers, language: 'en',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const carry = (seconds: number): HandoverPlan => ({
  kind: 'camera_carry', seconds, anchor: null, reason: 'the move continues',
});

describe('windows, once scenes are allowed to overlap', () => {
  it('leaves a film of cuts exactly where it was', () => {
    const windows = sceneWindows(board([scene(0), scene(1), scene(2)]));
    expect(windows.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([[0, 4], [4, 8], [8, 12]]);
    expect(windows.every((w) => w.arriveSeconds === 0 && w.departSeconds === 0)).toBe(true);
  });

  it('mounts the next beat early and holds the last one late', () => {
    const windows = sceneWindows(
      board([scene(0), scene(1), scene(2)], { scn_0: carry(1) }),
    );
    // Scene 0 stays up a second past its end; scene 1 comes up a second early.
    expect(windows[0]).toMatchObject({ fromSeconds: 0, toSeconds: 5, departSeconds: 1 });
    expect(windows[1]).toMatchObject({ fromSeconds: 3, toSeconds: 8, arriveSeconds: 1 });
    expect(windows[2]).toMatchObject({ fromSeconds: 8, toSeconds: 12 });
  });

  it('never lets an overlap eat its own scene', () => {
    const short = board([scene(0, { duration: 1 }), scene(1, { startTime: 1, duration: 1 })], {
      scn_0: carry(3.2),
    });
    const windows = sceneWindows(short);
    expect(windows[0]!.departSeconds).toBeLessThanOrEqual(0.45);
    expect(maxOverlap(short.scenes[0]!, short.scenes[1]!)).toBeCloseTo(0.45, 3);
  });

  it('does not start a film before it begins', () => {
    const windows = sceneWindows(board([scene(0), scene(1)], { scn_0: carry(1) }));
    expect(windows[0]!.fromSeconds).toBe(0);
  });

  it('keeps the editorial clock untouched', () => {
    // The window is the render truth; startTime and duration stay the truth
    // the captions, the cues and every QA measurement are keyed to.
    const storyboard = board([scene(0), scene(1)], { scn_0: carry(1.5) });
    expect(storyboard.scenes.map((s) => [s.startTime, s.duration])).toEqual([[0, 4], [4, 4]]);
  });
});

describe('whether a join can actually be performed', () => {
  const a = scene(0);
  const b = scene(1);
  const withAsset = (index: number) => scene(index, { assetRefs: ['ast_1'] });

  it('refuses a mark handoff when there is no mark', () => {
    expect(canHandOver('object_handoff', a, b, { fromField: '#fff', toField: '#fff', hasMark: false }))
      .toMatchObject({ ok: false });
    expect(canHandOver('object_handoff', a, b, { fromField: '#fff', toField: '#fff', hasMark: true }))
      .toMatchObject({ ok: true });
  });

  it('refuses a field change between two beats on the same field', () => {
    const same = canHandOver('field_change', a, b, { fromField: '#101014', toField: '#101014', hasMark: true });
    expect(same.ok).toBe(false);
    expect(same.because).toMatch(/same field/);
    expect(canHandOver('field_change', a, b, { fromField: '#101014', toField: '#fff', hasMark: true }).ok).toBe(true);
  });

  it('refuses to push into nothing, and to morph one-sided material', () => {
    const bare = { fromField: '#fff', toField: '#111', hasMark: true };
    expect(canHandOver('scale_through', a, b, bare).ok).toBe(false);
    expect(canHandOver('scale_through', withAsset(0), b, bare).ok).toBe(true);
    expect(canHandOver('morph', withAsset(0), b, bare).ok).toBe(false);
    expect(canHandOver('morph', withAsset(0), withAsset(1), bare).ok).toBe(true);
  });

  it('refuses any join between two beats too short to share one', () => {
    const tiny = scene(0, { duration: 0.4 });
    const next = scene(1, { startTime: 0.4, duration: 0.4 });
    const facts = { fromField: '#fff', toField: '#111', hasMark: true };
    expect(canHandOver('camera_carry', tiny, next, facts).ok).toBe(false);
    // A cut always works. It is the one join that needs no time.
    expect(canHandOver('cut', tiny, next, facts).ok).toBe(true);
  });
});

describe('the ratio the whole reference analysis produced', () => {
  it('reads 0 for a film made entirely of cuts', () => {
    const shape = handoverShape(board([scene(0), scene(1), scene(2), scene(3)]));
    expect(shape).toMatchObject({ cuts: 3, transformations: 0, transformationsPerShot: 0 });
  });

  it('counts a join the material cannot afford as the cut it will actually be', () => {
    const storyboard = board(
      [scene(0, { duration: 0.5 }), scene(1, { startTime: 0.5, duration: 0.5 })],
      { scn_0: carry(2) },
    );
    // Asked for a carry; the beats can only share 0.22s, which is under the
    // floor. Recording it as a transformation would be a plan reported as a
    // result — the mistake this codebase keeps finding in new places.
    expect(handoverShape(storyboard)).toMatchObject({ cuts: 1, transformations: 0 });
  });

  it('reaches the reference band when the joins are real', () => {
    const storyboard = board([scene(0), scene(1), scene(2), scene(3)], {
      scn_0: carry(1),
      scn_1: { kind: 'object_handoff', seconds: 0.8, anchor: 'mark', reason: 'the mark carries' },
      scn_2: { kind: 'field_change', seconds: 1.2, anchor: 'mark', reason: 'the world turns over' },
    });
    const shape = handoverShape(storyboard);
    expect(shape.cuts).toBe(0);
    expect(shape.transformations).toBe(3);
    expect(shape.anchored).toBe(2);
    expect(shape.byKind.object_handoff).toBe(1);
    // No cuts is not infinitely good; the ratio is reported against one.
    expect(shape.transformationsPerShot).toBe(3);
  });

  it('ignores the last scene, which hands over to nothing', () => {
    const shape = handoverShape(board([scene(0), scene(1)], { scn_1: carry(1) }));
    expect(shape.cuts).toBe(1);
    expect(shape.transformations).toBe(0);
  });

  it('treats a missing plan as the cut it is', () => {
    expect(handoverShape(board([scene(0), scene(1)], { scn_0: CUT })).cuts).toBe(1);
  });
});
