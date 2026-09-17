import { describe, it, expect } from 'vitest';
import { VARIANT_SPECS, resequence, storyboardDuration } from '@act-one/core';
import { planVariant, planCampaign, prioritiseScenes, variantStoryboard, DEFAULT_CAMPAIGN } from '../index.ts';
import { sceneFixture, storyboardFixture } from './fixtures.ts';

function master() {
  return resequence(
    storyboardFixture([
      sceneFixture({ id: 'hook', duration: 4, visualType: 'kinetic_typography', onScreenText: ['Forty rows.'] }),
      sceneFixture({ id: 'problem', duration: 5, visualType: 'kinetic_typography', onScreenText: ['A week of matching.'] }),
      sceneFixture({ id: 'atmos', duration: 4, visualType: 'generated_broll' }),
      sceneFixture({ id: 'product1', duration: 7, visualType: 'product_ui', onScreenText: ['One run'] }),
      sceneFixture({ id: 'product2', duration: 6, visualType: 'screenshot_motion' }),
      sceneFixture({ id: 'proof', duration: 4, visualType: 'statistic', claimEvidenceIds: ['evt_1'], onScreenText: ['400 teams'] }),
      sceneFixture({ id: 'transition', duration: 2, visualType: 'transition' }),
      sceneFixture({ id: 'logo', duration: 3, visualType: 'logo_reveal' }),
    ]),
  );
}

describe('prioritiseScenes', () => {
  it('protects the hook and the ending', () => {
    const priorities = new Map(prioritiseScenes(master()).map((p) => [p.sceneId, p]));
    expect(priorities.get('hook')!.weight).toBe(1);
    expect(priorities.get('logo')!.weight).toBeGreaterThan(0.9);
  });

  it('ranks atmosphere lowest — it is the first thing an editor cuts', () => {
    const priorities = prioritiseScenes(master());
    const atmos = priorities.find((p) => p.sceneId === 'atmos')!;
    const product = priorities.find((p) => p.sceneId === 'product1')!;
    expect(atmos.weight).toBeLessThan(product.weight);
    expect(atmos.reason).toMatch(/first to go/i);
  });
});

describe('planVariant', () => {
  it('re-edits rather than truncating — the ending survives a 15-second cut', () => {
    const plan = planVariant(master(), 'ad_15_a');
    expect(plan.sceneIds).toContain('hook');
    expect(plan.sceneIds).toContain('logo');
    expect(plan.sceneIds.length).toBeLessThan(master().scenes.length);
  });

  it('keeps scenes in narrative order, not importance order', () => {
    const plan = planVariant(master(), 'vertical_30');
    const masterOrder = master().scenes.map((s) => s.id);
    const planOrder = plan.sceneIds;
    const positions = planOrder.map((id) => masterOrder.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('lands close to the channel’s target runtime', () => {
    for (const purpose of DEFAULT_CAMPAIGN) {
      const plan = planVariant(master(), purpose);
      const total = Object.values(plan.durations).reduce((s, d) => s + d, 0);
      const target = VARIANT_SPECS[purpose].targetSeconds;
      expect(Math.abs(total - target), `${purpose}: ${total} vs ${target}`).toBeLessThanOrEqual(
        Math.max(1.5, target * 0.2),
      );
    }
  });

  it('never compresses a scene below the time needed to read it', () => {
    const plan = planVariant(master(), 'bumper_6');
    for (const id of plan.sceneIds) {
      const scene = master().scenes.find((s) => s.id === id)!;
      const words = scene.onScreenText.join(' ').split(/\s+/).filter(Boolean).length;
      if (words === 0) continue;
      expect(plan.durations[id]!).toBeGreaterThanOrEqual(0.35 + words / 2.6 + 0.3 - 0.01);
    }
  });

  it('uses the channel’s own aspect ratio and caption policy', () => {
    const vertical = planVariant(master(), 'vertical_30');
    expect(vertical.aspect).toBe('9:16');
    expect(vertical.captionsBurned).toBe(true);

    const loop = planVariant(master(), 'homepage_loop');
    expect(loop.aspect).toBe('16:9');
    expect(loop.captionsBurned).toBe(false);
  });
});

describe('planCampaign', () => {
  it('makes the three 15-second ads argue differently', () => {
    const [a, b, c] = planCampaign(master(), ['ad_15_a', 'ad_15_b', 'ad_15_c']);
    const sets = [a!.sceneIds.join(), b!.sceneIds.join(), c!.sceneIds.join()];
    // Three identical cuts would be one ad shown three times.
    expect(new Set(sets).size).toBeGreaterThan(1);
  });

  it('produces the default launch campaign', () => {
    const plans = planCampaign(master());
    expect(plans.map((p) => p.purpose)).toEqual(DEFAULT_CAMPAIGN);
  });
});

describe('variantStoryboard', () => {
  it('materialises a plan as a renderable, resequenced storyboard', () => {
    const source = master();
    const plan = planVariant(source, 'vertical_30');
    const board = variantStoryboard(source, plan, 'sbd_cut');

    expect(board.scenes).toHaveLength(plan.sceneIds.length);
    expect(board.scenes.map((s) => s.index)).toEqual(plan.sceneIds.map((_, i) => i));
    expect(storyboardDuration(board)).toBeCloseTo(
      Object.values(plan.durations).reduce((s, d) => s + d, 0),
      1,
    );
    expect(board.scenes[0]!.startTime).toBe(0);
  });

  it('gives the cut its own storyboard and its own scene rows', () => {
    // Keeping the master's ids meant persisting a cut tried to insert scenes
    // that already existed, and every campaign died on a key violation.
    const source = master();
    const plan = planVariant(source, 'vertical_30');
    const board = variantStoryboard(source, plan, 'sbd_cut');

    expect(board.id).toBe('sbd_cut');
    expect(board.scenes.every((scene) => scene.storyboardId === 'sbd_cut')).toBe(true);

    const masterIds = new Set(source.scenes.map((scene) => scene.id));
    expect(board.scenes.some((scene) => masterIds.has(scene.id))).toBe(false);
  });

  it('gives two cuts of the same film different scene rows', () => {
    const source = master();
    const a = variantStoryboard(source, planVariant(source, 'vertical_30'), 'sbd_a');
    const b = variantStoryboard(source, planVariant(source, 'vertical_30'), 'sbd_b');

    const idsA = new Set(a.scenes.map((scene) => scene.id));
    expect(b.scenes.some((scene) => idsA.has(scene.id))).toBe(false);
  });
});
