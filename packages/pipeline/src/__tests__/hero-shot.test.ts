import { describe, it, expect } from 'vitest';
import { resequence, type HeroShotRecord, type Scene, type Storyboard } from '@act-one/core';
import { withHeroShot } from '../stages/hero-shot.ts';

/**
 * Putting the hero into the film.
 *
 * The property that matters is that the film does not get longer. A hero shot
 * that arrives as an extra scene is a film whose running time nobody agreed
 * to, and on a twenty-four second launch film three extra seconds is an
 * eighth of it.
 */
function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'Show it', narration: '',
    onScreenText: [], visualType: 'product_ui', assetRefs: ['ast_1'], momentIds: [],
    motionRecipe: { name: 'product_window', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null,
    status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

const framing = (role: Scene['uiSequence'] extends null ? never : string, seconds: number) => ({
  role: role as 'establish',
  move: 'hold' as const,
  from: rect(0, 0, 0.5, 0.28),
  to: rect(0, 0, 0.5, 0.28),
  seconds,
  cut: true,
  lift: null,
  words: 'none' as const,
  around: null,
});

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', language: null, heroShot: null, musicDirection: '',
    status: 'draft', parentStoryboardId: null, revisionReason: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const record: HeroShotRecord = {
  sceneId: 'scn_hero',
  assetId: 'ast_2',
  framing: { ...framing('subject', 3.2), move: 'push', to: rect(0.3, 0.2, 0.46, 0.26) },
  considered: 116,
  shortlisted: 6,
  score: 0.81,
  why: ['one thing dominates the frame (isolation 0.73)'],
  reason: 'The message being sent is legible and specific to this product.',
  giveUp: 'A tidier composition in frame 2.',
  judged: true,
  costUsd: 0.012,
  chosenAt: '2026-01-01T00:00:00.000Z',
  notes: [],
};

describe('putting the hero shot into the film', () => {
  it('does not make the film longer', () => {
    const before = board([
      scene({ id: 'scn_hero', duration: 6, uiSequence: {
        sourceWidth: 2324, sourceHeight: 1224, background: { r: 240, g: 240, b: 242 },
        framings: [framing('establish', 1.4), framing('subject', 2.3), framing('result', 2.3)],
        notes: [],
      } }),
      scene({ id: 'scn_other', duration: 4 }),
    ]);
    const after = withHeroShot(before, record);
    const runtime = (board_: Storyboard) => board_.scenes.reduce((sum, s) => sum + s.duration, 0);
    expect(runtime(after)).toBeCloseTo(runtime(before), 5);

    const host = after.scenes.find((s) => s.id === 'scn_hero')!;
    const total = host.uiSequence!.framings.reduce((sum, f) => sum + f.seconds, 0);
    expect(total).toBeLessThanOrEqual(host.duration + 0.001);
  });

  it('opens the shot with the hero and keeps what followed it', () => {
    const before = board([
      scene({ id: 'scn_hero', duration: 6, uiSequence: {
        sourceWidth: 2324, sourceHeight: 1224, background: { r: 240, g: 240, b: 242 },
        framings: [framing('establish', 1.4), framing('subject', 2.3), framing('result', 2.3)],
        notes: [],
      } }),
    ]);
    const framings = withHeroShot(before, record).scenes[0]!.uiSequence!.framings;
    expect(framings[0]!.to).toEqual(record.framing.to);
    // What the scene was already going to show after its subject survives;
    // the establish and the old subject are what the hero replaces.
    expect(framings.map((f) => f.role)).toEqual(['subject', 'result']);
  });

  it('puts the hero capture first in the shot’s material', () => {
    const before = board([scene({ id: 'scn_hero', duration: 5, assetRefs: ['ast_1', 'ast_2'] })]);
    expect(withHeroShot(before, record).scenes[0]!.assetRefs[0]).toBe('ast_2');
  });

  it('works on a shot that was never filmed', () => {
    const before = board([scene({ id: 'scn_hero', duration: 5, uiSequence: null })]);
    const after = withHeroShot(before, record);
    expect(after.scenes[0]!.uiSequence!.framings).toHaveLength(1);
    expect(after.heroShot).toEqual(record);
  });

  it('leaves every other shot alone', () => {
    const other = scene({ id: 'scn_other', duration: 4 });
    const before = board([scene({ id: 'scn_hero', duration: 5 }), other]);
    const after = withHeroShot(before, record);
    expect(after.scenes[1]).toEqual(before.scenes[1]);
  });
});
