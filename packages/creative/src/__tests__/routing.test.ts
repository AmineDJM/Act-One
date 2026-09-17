import { describe, it, expect } from 'vitest';
import { MODE_BUDGETS, visualMix, resequence } from '@act-one/core';
import { routeShot, checkBudget, enforceBudget, scenesNeedingRealAssets } from '../index.ts';
import { sceneFixture, storyboardFixture, understandingFixture } from './fixtures.ts';

describe('routeShot', () => {
  it('always uses the real product for anything showing the product working', () => {
    for (const purpose of ['workflow', 'result', 'feature', 'agent_behaviour'] as const) {
      const decision = routeShot({
        purpose,
        hasRealProductAsset: true,
        allowGenerative: true,
        allowThreeD: true,
      });
      expect(decision.technique, purpose).toBe('real_product');
    }
  });

  it('falls back to typography rather than inventing an interface', () => {
    const decision = routeShot({
      purpose: 'workflow',
      hasRealProductAsset: false,
      // Generation is available and would look impressive. We still refuse.
      allowGenerative: true,
      allowThreeD: true,
    });
    expect(decision.technique).toBe('deterministic');
    expect(decision.visualType).toBe('kinetic_typography');
    expect(decision.reason).toMatch(/never render a fake interface/i);
  });

  it('uses generation only for metaphor, mood, environment and human context', () => {
    for (const purpose of ['metaphor', 'environment', 'mood', 'human_context'] as const) {
      expect(
        routeShot({ purpose, hasRealProductAsset: true, allowGenerative: true, allowThreeD: true })
          .technique,
        purpose,
      ).toBe('generative');
    }
  });

  it('uses 3D for hero shots and spatial transitions, never for workflows', () => {
    expect(
      routeShot({ purpose: 'hero', hasRealProductAsset: true, allowGenerative: false, allowThreeD: true })
        .technique,
    ).toBe('three_d');
    expect(
      routeShot({ purpose: 'transition', hasRealProductAsset: true, allowGenerative: false, allowThreeD: true })
        .technique,
    ).toBe('three_d');
    expect(
      routeShot({ purpose: 'workflow', hasRealProductAsset: true, allowGenerative: false, allowThreeD: true })
        .technique,
    ).toBe('real_product');
  });

  it('renders figures and the logo deterministically, always', () => {
    expect(routeShot({ purpose: 'proof', hasRealProductAsset: true, allowGenerative: true, allowThreeD: true }).technique).toBe('deterministic');
    expect(routeShot({ purpose: 'ending', hasRealProductAsset: true, allowGenerative: true, allowThreeD: true }).technique).toBe('deterministic');
  });
});

describe('checkBudget', () => {
  const understanding = understandingFixture();

  it('flags a film that leans too hard on generated footage', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 10, visualType: 'generated_broll' }),
        sceneFixture({ id: 'b', duration: 5, visualType: 'product_ui' }),
        sceneFixture({ id: 'c', duration: 5, visualType: 'kinetic_typography' }),
      ]),
    );
    const violations = checkBudget(board, understanding, 'studio');
    expect(violations.map((v) => v.kind)).toContain('too_much_generative');
  });

  it('refuses any generated footage in authentic mode', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 2, visualType: 'generated_broll' }),
        sceneFixture({ id: 'b', duration: 18, visualType: 'product_ui' }),
      ]),
    );
    expect(checkBudget(board, understanding, 'authentic').map((v) => v.kind)).toContain(
      'too_much_generative',
    );
  });

  it('catches a generated scene pretending to be the product', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({
          id: 'a',
          duration: 4,
          visualType: 'generated_broll',
          purpose: 'Show the analytics dashboard filling with data',
        }),
        sceneFixture({ id: 'b', duration: 16, visualType: 'kinetic_typography' }),
      ]),
    );
    const violation = checkBudget(board, understanding, 'studio').find((v) => v.kind === 'fake_product');
    expect(violation).toBeDefined();
    expect(violation!.sceneIds).toEqual(['a']);
  });

  it('notices when we captured real footage and then barely used it', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 19, visualType: 'kinetic_typography' }),
        sceneFixture({ id: 'b', duration: 1, visualType: 'product_ui' }),
      ]),
    );
    expect(checkBudget(board, understanding, 'studio').map((v) => v.kind)).toContain('too_little_real');
  });

  it('passes a well-balanced film', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 8, visualType: 'kinetic_typography' }),
        sceneFixture({ id: 'b', duration: 8, visualType: 'product_ui' }),
        sceneFixture({ id: 'c', duration: 3, visualType: 'generated_broll' }),
        sceneFixture({ id: 'd', duration: 3, visualType: 'logo_reveal' }),
      ]),
    );
    expect(checkBudget(board, understanding, 'studio')).toEqual([]);
  });
});

describe('enforceBudget', () => {
  it('shortens generated scenes before deleting them', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 10, visualType: 'generated_broll' }),
        sceneFixture({ id: 'b', duration: 10, visualType: 'product_ui' }),
      ]),
    );
    const fixed = enforceBudget(board, MODE_BUDGETS.studio);

    expect(fixed.scenes).toHaveLength(2);
    expect(fixed.scenes.find((s) => s.id === 'a')!.duration).toBeLessThan(10);
    expect(visualMix(resequence(fixed)).generative).toBeLessThanOrEqual(
      MODE_BUDGETS.studio.maxGenerativeRatio + 0.02,
    );
  });

  it('drops scenes only once trimming has hit the floor', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 6, visualType: 'generated_broll' }),
        sceneFixture({ id: 'b', duration: 6, visualType: 'generated_broll' }),
        sceneFixture({ id: 'c', duration: 6, visualType: 'generated_broll' }),
        sceneFixture({ id: 'd', duration: 4, visualType: 'product_ui' }),
      ]),
    );
    const fixed = enforceBudget(board, MODE_BUDGETS.studio);
    expect(fixed.scenes.length).toBeLessThan(4);
  });

  it('leaves a film already inside budget untouched', () => {
    const board = resequence(
      storyboardFixture([
        sceneFixture({ id: 'a', duration: 2, visualType: 'generated_broll' }),
        sceneFixture({ id: 'b', duration: 18, visualType: 'product_ui' }),
      ]),
    );
    expect(enforceBudget(board, MODE_BUDGETS.studio)).toEqual(board);
  });
});

describe('scenesNeedingRealAssets', () => {
  it('lists product scenes that have nothing behind them yet', () => {
    const board = storyboardFixture([
      sceneFixture({ id: 'a', duration: 3, visualType: 'product_ui', assetRefs: [] }),
      sceneFixture({ id: 'b', duration: 3, visualType: 'product_ui', assetRefs: ['ast_1'] }),
      sceneFixture({ id: 'c', duration: 3, visualType: 'kinetic_typography', assetRefs: [] }),
    ]);
    expect(scenesNeedingRealAssets(board).map((s) => s.id)).toEqual(['a']);
  });
});
