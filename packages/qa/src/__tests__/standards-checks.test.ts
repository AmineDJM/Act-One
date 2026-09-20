import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { BrandSystem as BrandSystemSchema, newId, resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { neutralRamp, resolveTokens } from '@act-one/design';
import { colourShares, distributionIssues, runDeterministicChecks } from '../index.ts';

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#3d7bfd', secondaryColor: '#9ab8ff', accentColors: [], primaryCandidates: ['#3d7bfd'],
  neutrals: neutralRamp('#3d7bfd', 9, 0.05), canvasDark: '#07080d', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'beat', narration: '', onScreenText: ['One line'],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null,
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', handovers: {}, version: 1, scenes,
    voiceStrategy: 'none', heroShot: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
    language: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const check = (scenes: Scene[]) => runDeterministicChecks({ storyboard: board(scenes), brand, aspect: '16:9' });

describe('invented urgency', () => {
  it('is caught in copy and in narration', () => {
    const issues = check([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Only today: half price'] }),
      scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Ship faster'], narration: 'Hurry, only 3 spots left.' }),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Calm words'] }),
    ]);
    const urgency = issues.filter((i) => /invents urgency/.test(i.message));
    // Scene b trips two patterns; it is the scenes that matter, not the count.
    expect([...new Set(urgency.map((i) => i.sceneId))].sort()).toEqual(['a', 'b']);
    expect(urgency.every((i) => i.severity === 'soft_fail' && i.repair === 'rewrite_copy')).toBe(true);
  });

  it('leaves a plain deadline alone', () => {
    const issues = check([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Launching in March'] }),
      scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Ship faster'] }),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Calm words'] }),
    ]);
    expect(issues.some((i) => /invents urgency/.test(i.message))).toBe(false);
  });
});

describe('proof placement', () => {
  it('flags a block of statistics at the end and not one mid-film', () => {
    const late = check([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The problem'] }),
      scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The answer'] }),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The shift'] }),
      scene({ id: 'd', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The proof'] }),
      scene({ id: 'e', duration: 3, visualType: 'kinetic_typography', onScreenText: ['More'] }),
      scene({ id: 'f', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Even more'] }),
      scene({ id: 'g', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Still more'] }),
      scene({ id: 'h', duration: 2, visualType: 'statistic', onScreenText: ['40%', 'faster'], claimEvidenceIds: ['e1'] }),
      scene({ id: 'i', duration: 2, visualType: 'statistic', onScreenText: ['3x', 'throughput'], claimEvidenceIds: ['e2'] }),
      scene({ id: 'j', duration: 2, visualType: 'logo_reveal', onScreenText: [] }),
    ]);
    expect(late.some((i) => /stack proof at the end/.test(i.message))).toBe(true);

    const early = check([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The claim'] }),
      scene({ id: 'h', duration: 2, visualType: 'statistic', onScreenText: ['40%', 'faster'], claimEvidenceIds: ['e1'] }),
      scene({ id: 'i', duration: 2, visualType: 'statistic', onScreenText: ['3x', 'throughput'], claimEvidenceIds: ['e2'] }),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The shift'] }),
      scene({ id: 'd', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The rest'] }),
      scene({ id: 'e', duration: 3, visualType: 'kinetic_typography', onScreenText: ['And more'] }),
      scene({ id: 'j', duration: 2, visualType: 'logo_reveal', onScreenText: [] }),
    ]);
    expect(early.some((i) => /stack proof at the end/.test(i.message))).toBe(false);
  });
});

describe('continuity on one capture', () => {
  const product = (id: string, recipe: Scene['motionRecipe']['name'], move: Scene['cameraRecipe']['move'], dx: number) =>
    scene({
      id, duration: 4, visualType: 'product_ui', assetRefs: ['ast_shared'], onScreenText: ['Beat'],
      motionRecipe: { name: recipe, easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} },
      cameraRecipe: { move, fromScale: 1, toScale: 1.05, fromX: -dx / 2, toX: dx / 2, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    });

  it('calls the same framing twice a jump cut', () => {
    const issues = check([
      product('a', 'product_window', 'slow_push', 0),
      product('b', 'product_window', 'slow_push', 0),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Then words'] }),
    ]);
    expect(issues.some((i) => /jump cut/.test(i.message))).toBe(true);
  });

  it('calls a reversed drift a crossed line, and lets a changed treatment pass', () => {
    const reversed = check([
      product('a', 'product_window', 'lateral_drift', 0.06),
      product('b', 'feature_stack', 'lateral_drift', -0.06),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Then words'] }),
    ]);
    expect(reversed.some((i) => /Screen direction reversed/.test(i.message))).toBe(true);
    expect(reversed.some((i) => /jump cut/.test(i.message))).toBe(false);

    const varied = check([
      product('a', 'product_window', 'slow_push', 0),
      product('b', 'feature_stack', 'lateral_drift', 0.06),
      scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Then words'] }),
    ]);
    expect(varied.some((i) => /jump cut|reversed/.test(i.message))).toBe(false);
  });
});

describe('colour distribution', () => {
  const tokens = resolveTokens(brand, { aspect: '16:9', theme: 'dark' });

  async function frame(paint: (x: number, y: number) => string): Promise<Uint8Array> {
    const width = 320;
    const height = 180;
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const hex = paint(x, y).replace('#', '');
        const i = (y * width + x) * 3;
        data[i] = parseInt(hex.slice(0, 2), 16);
        data[i + 1] = parseInt(hex.slice(2, 4), 16);
        data[i + 2] = parseInt(hex.slice(4, 6), 16);
      }
    }
    return new Uint8Array(await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());
  }

  it('reads a composed frame as mostly canvas with a little accent', async () => {
    const shares = await colourShares(
      await frame((x, y) => (y > 150 && x < 40 ? tokens.accent : x > 60 && x < 200 && y > 60 && y < 90 ? tokens.onCanvas.primary : tokens.canvas)),
      tokens,
    );
    expect(shares.canvas).toBeGreaterThan(0.8);
    expect(shares.accent).toBeGreaterThan(0.01);
    expect(shares.accent).toBeLessThan(0.1);
    expect(distributionIssues(shares, { id: 's', startTime: 0, index: 0 })).toEqual([]);
  });

  it('refuses an accent that has become the canvas', async () => {
    const shares = await colourShares(await frame((x) => (x < 160 ? tokens.accent : tokens.canvas)), tokens);
    expect(shares.accent).toBeGreaterThan(0.45);
    const issues = distributionIssues(shares, { id: 's', startTime: 0, index: 2 });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('soft_fail');
    expect(issues[0]!.message).toMatch(/accent covers \d+% of scene 3/);
  });
});
