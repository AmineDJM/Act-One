import { describe, it, expect } from 'vitest';
import {
  resequence,
  storyboardDuration,
  visualMix,
  sceneAt,
  posterMoment,
  storyboardEstimatedCost,
  type Scene,
  type Storyboard,
} from '../index.ts';

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1',
    index: 0,
    startTime: 0,
    purpose: 'test',
    narration: '',
    onScreenText: [],
    assetRefs: [],
    momentIds: [],
    motionRecipe: { name: 'hold', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.5, params: {} },
    cameraRecipe: {
      move: 'static',
      fromScale: 1,
      toScale: 1,
      fromX: 0,
      toX: 0,
      fromY: 0,
      toY: 0,
      motionBlur: 0.12,
      depthOfField: 0,
      easing: 'in_out_quart',
    },
    soundCues: [],
    voiceOver: false,
    generativeNeeds: [],
    threeDSceneId: null,
    status: 'draft',
    claimEvidenceIds: [],
    notes: '',
    estimatedCostUsd: 0,
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return {
    id: 'sbd_1',
    projectId: 'prj_1',
    conceptId: 'cpt_1',
    treatmentId: 'trt_1',
    version: 1,
    scenes,
    voiceStrategy: 'none',
    musicDirection: '',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('resequence', () => {
  it('recomputes indices and start times after a reorder', () => {
    const b = board([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 'b', duration: 4.5, visualType: 'product_ui' }),
      scene({ id: 'c', duration: 2, visualType: 'logo_reveal' }),
    ]);
    const reordered = resequence({ ...b, scenes: [b.scenes[2]!, b.scenes[0]!, b.scenes[1]!] });

    expect(reordered.scenes.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(reordered.scenes.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(reordered.scenes.map((s) => s.startTime)).toEqual([0, 2, 5]);
    expect(storyboardDuration(reordered)).toBe(9.5);
  });

  it('keeps float start times exact to millisecond precision', () => {
    const b = resequence(
      board([
        scene({ id: 'a', duration: 0.333, visualType: 'transition' }),
        scene({ id: 'b', duration: 0.333, visualType: 'transition' }),
        scene({ id: 'c', duration: 0.334, visualType: 'transition' }),
      ]),
    );
    expect(b.scenes[2]!.startTime).toBe(0.666);
    expect(storyboardDuration(b)).toBe(1);
  });
});

describe('sceneAt', () => {
  it('resolves the scene playing at a given second', () => {
    const b = resequence(
      board([
        scene({ id: 'a', duration: 3, visualType: 'kinetic_typography' }),
        scene({ id: 'b', duration: 4, visualType: 'product_ui' }),
      ]),
    );
    expect(sceneAt(b, 0)?.id).toBe('a');
    expect(sceneAt(b, 2.99)?.id).toBe('a');
    expect(sceneAt(b, 3)?.id).toBe('b');
    expect(sceneAt(b, 7)).toBeUndefined();
  });
});

describe('visualMix', () => {
  it('counts mixed media pessimistically as half generative', () => {
    const b = resequence(
      board([
        scene({ id: 'a', duration: 5, visualType: 'kinetic_typography' }),
        scene({ id: 'b', duration: 5, visualType: 'product_ui' }),
        scene({ id: 'c', duration: 5, visualType: 'generated_broll' }),
        scene({ id: 'd', duration: 5, visualType: 'mixed_media' }),
      ]),
    );
    const mix = visualMix(b);
    expect(mix.deterministic).toBeCloseTo(0.25);
    expect(mix.realMedia).toBeCloseTo(0.375);
    expect(mix.generative).toBeCloseTo(0.375);
    expect(mix.deterministic + mix.realMedia + mix.generative).toBeCloseTo(1);
  });
});

describe('storyboardEstimatedCost', () => {
  it('sums scene cost and every generative need', () => {
    const b = board([
      scene({
        id: 'a',
        duration: 4,
        visualType: 'generated_broll',
        estimatedCostUsd: 0.1,
        generativeNeeds: [
          {
            kind: 'video',
            brief: 'x',
            mustNotContainText: true,
            referenceAssetIds: [],
            durationSeconds: 4,
            aspect: '16:9',
            resolvedProvider: null,
            resolvedModel: null,
            estimatedCostUsd: 1.4,
          },
        ],
      }),
      scene({ id: 'b', duration: 2, visualType: 'logo_reveal', estimatedCostUsd: 0.05 }),
    ]);
    expect(storyboardEstimatedCost(b)).toBeCloseTo(1.55);
  });
});

describe('the frame that represents a film', () => {
  it('waits for the motion to settle rather than taking a fixed moment', () => {
    // A fixed 1.5s lands inside the opening animation, so the poster showed
    // type still arriving and a counter still counting.
    const at = posterMoment([
      scene({ id: 'a', duration: 4, startTime: 0, visualType: 'kinetic_typography', onScreenText: ['Hello'] }),
    ]);
    expect(at).toBeGreaterThan(2);
    expect(at).toBeLessThan(4);
  });

  it('skips an opening with nothing composed on it', () => {
    const at = posterMoment([
      scene({ id: 'a', duration: 2, startTime: 0, visualType: 'transition' }),
      scene({ id: 'b', duration: 4, startTime: 2, visualType: 'kinetic_typography', onScreenText: ['The point'] }),
    ]);
    expect(at).toBeGreaterThan(2);
  });

  it('falls back to a scene carried by a capture', () => {
    const at = posterMoment([
      scene({ id: 'a', duration: 3, startTime: 0, visualType: 'screenshot_motion', assetRefs: ['ast_1'] }),
    ]);
    expect(at).toBeCloseTo(1.8, 5);
  });

  it('survives a storyboard with no scenes at all', () => {
    expect(posterMoment([])).toBe(0);
  });
});
