import { describe, it, expect } from 'vitest';
import { neutralRamp } from '@act-one/design';
import { BrandSystem as BrandSystemSchema } from '@act-one/core';
import type { BrandSystem, Scene } from '@act-one/core';
import { buildBlenderScript, normaliseScene, estimateRenderSeconds, planThreeDScene, RIGS, ThreeDScene } from '../index.ts';

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#2f6fed', secondaryColor: '#8fb2f7', accentColors: [], primaryCandidates: ['#2f6fed'],
  neutrals: neutralRamp('#2f6fed', 9, 0.05), canvasDark: '#08080c', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 8, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const scene: Scene = {
  id: 'scn_1', storyboardId: 'sbd_1', index: 2, startTime: 6, duration: 4,
  purpose: 'Present the product as an object', narration: '', onScreenText: [],
  visualType: 'product_ui_3d',
  assetRefs: ['ast_1'], momentIds: [],
  motionRecipe: { name: 'floating_ui', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
  cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.06, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.12, depthOfField: 0.3, easing: 'in_out_quart' },
  soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
  claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
};

describe('scene validation', () => {
  it('rejects values outside the range each rig was checked against', () => {
    expect(() => ThreeDScene.parse({ rig: 'floating_ui', depth: 99 })).toThrow();
    expect(() => ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 600 })).toThrow();
    expect(() => ThreeDScene.parse({ rig: 'floating_ui', width: 99999 })).toThrow();
    expect(() => ThreeDScene.parse({ rig: 'not_a_rig' })).toThrow();
  });

  it('rejects a colour that is not a hex triplet', () => {
    // A colour string reaches the generated script, so it is validated hard.
    expect(() => ThreeDScene.parse({ rig: 'floating_ui', accentColor: 'red' })).toThrow();
    expect(() => ThreeDScene.parse({ rig: 'floating_ui', accentColor: '#fff' })).toThrow();
  });

  it('degrades toward plainer rather than failing on an unsuitable request', () => {
    const { scene: normalised, adjustments } = normaliseScene({
      rig: 'browser_float',
      camera: 'rise',
      screenAssets: ['a.png', 'b.png', 'c.png'],
    });
    // browser_float holds one screen and does not suit a rise.
    expect(normalised.screenAssets).toHaveLength(1);
    expect(RIGS.browser_float.suitedMoves).toContain(normalised.camera);
    expect(adjustments).toHaveLength(2);
  });
});

describe('script generation', () => {
  it('never lets a filename escape its Python string literal', () => {
    const nasty = 'frame"; import os; os.system("rm -rf /"); x = "';
    const script = buildBlenderScript(
      ThreeDScene.parse({ rig: 'browser_float', screenAssets: [nasty] }),
    );
    // The payload SHOULD appear — as escaped data inside a Python string
    // literal. What must never appear is the raw, unescaped quote that would
    // close the literal and let the rest execute as code.
    expect(script).toContain(JSON.stringify(nasty));
    expect(script).not.toContain('frame"; import');
    expect(script).toContain('\\"');
  });

  it('refuses to emit a non-finite number', () => {
    const valid = ThreeDScene.parse({ rig: 'floating_ui' });
    expect(() => buildBlenderScript({ ...valid, depth: Number.NaN })).toThrow(/non-finite/);
  });

  it('runs Blender with a reproducible startup', () => {
    const script = buildBlenderScript(ThreeDScene.parse({ rig: 'floating_ui' }));
    expect(script).toContain("read_factory_settings");
    expect(script).toContain("scene.render.engine = 'CYCLES'");
  });

  it('makes screens emissive rather than lit', () => {
    const script = buildBlenderScript(
      ThreeDScene.parse({ rig: 'floating_ui', screenAssets: ['a.png'] }),
    );
    // A screen that receives key light picks up a sheen no real display has.
    expect(script).toContain('ShaderNodeEmission');
    expect(script).not.toContain("nodes['Principled BSDF'].inputs['Base Color']");
  });

  it('keys the camera over the scene’s own duration, not a fixed frame count', () => {
    const short = buildBlenderScript(ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 2 }));
    const long = buildBlenderScript(ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 8 }));
    for (const script of [short, long]) {
      expect(script).toContain('frame=scene.frame_end');
    }
    expect(short).toContain('DURATION = 2.0000');
    expect(long).toContain('DURATION = 8.0000');
  });

  it('converts brand colour to linear space, which is what Blender expects', () => {
    const script = buildBlenderScript(
      ThreeDScene.parse({ rig: 'floating_ui', backgroundColor: '#ffffff' }),
    );
    // sRGB white is 1.0 linear; a naive /255 would give the same, so check a
    // mid-tone instead.
    const mid = buildBlenderScript(
      ThreeDScene.parse({ rig: 'floating_ui', backgroundColor: '#808080' }),
    );
    expect(script).toContain('BACKGROUND = (1.0000, 1.0000, 1.0000, 1.0)');
    expect(mid).toContain('0.2159');
  });

  it('caps aperture so the interface never blurs out entirely', () => {
    const script = buildBlenderScript(ThreeDScene.parse({ rig: 'floating_ui', depthOfField: 1 }));
    expect(script).toContain('max(1.2, 8.0 - DOF * 6.0)');
  });
});

describe('render estimation', () => {
  it('scales with frames, samples and resolution', () => {
    const base = ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 4 });
    const longer = ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 8 });
    const heavier = ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 4, samples: 192 });
    const uhd = ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 4, width: 3840, height: 2160 });

    expect(estimateRenderSeconds(longer)).toBeCloseTo(estimateRenderSeconds(base) * 2, -1);
    expect(estimateRenderSeconds(heavier)).toBeCloseTo(estimateRenderSeconds(base) * 2, -1);
    expect(estimateRenderSeconds(uhd)).toBeGreaterThan(estimateRenderSeconds(base) * 3);
  });

  it('prices refraction honestly', () => {
    const glass = ThreeDScene.parse({ rig: 'glass_planes', durationSeconds: 4 });
    const plain = ThreeDScene.parse({ rig: 'floating_ui', durationSeconds: 4 });
    expect(estimateRenderSeconds(glass)).toBeGreaterThan(estimateRenderSeconds(plain));
  });
});

describe('rig planning', () => {
  it('picks a rig from what the scene has, not at random', () => {
    expect(planThreeDScene({ scene, brand, screenAssetPaths: ['a.png'], aspect: '16:9' }).scene.rig).toBe('browser_float');
    expect(planThreeDScene({ scene, brand, screenAssetPaths: ['a.png', 'b.png'], aspect: '16:9' }).scene.rig).toBe('layered_depth');
    expect(planThreeDScene({ scene, brand, screenAssetPaths: ['a.png', 'b.png', 'c.png'], aspect: '16:9' }).scene.rig).toBe('floating_ui');
  });

  it('uses a handset rig for vertical formats', () => {
    expect(planThreeDScene({ scene, brand, screenAssetPaths: ['a.png'], aspect: '9:16' }).scene.rig).toBe('device_phone');
  });

  it('uses the logo rig for a logo reveal', () => {
    const logoScene = { ...scene, motionRecipe: { ...scene.motionRecipe, name: 'logo_reveal' as const } };
    expect(planThreeDScene({ scene: logoScene, brand, screenAssetPaths: [], aspect: '16:9' }).scene.rig).toBe('logo_extrusion');
  });

  it('inherits the brand’s spacing rhythm as 3D separation', () => {
    const airy = planThreeDScene({ scene, brand: { ...brand, layoutDensity: 'airy' }, screenAssetPaths: ['a.png'], aspect: '16:9' });
    const dense = planThreeDScene({ scene, brand: { ...brand, layoutDensity: 'dense' }, screenAssetPaths: ['a.png'], aspect: '16:9' });
    expect(airy.scene.depth).toBeGreaterThan(dense.scene.depth);
  });

  it('does not light with a rim for a brand that does not use glow', () => {
    const plain = planThreeDScene({ scene, brand, screenAssetPaths: ['a.png'], aspect: '16:9' });
    expect(plain.scene.lighting).toBe('studio_soft');
    const glowing = planThreeDScene({ scene, brand: { ...brand, allowsGlow: true }, screenAssetPaths: ['a.png'], aspect: '16:9' });
    expect(glowing.scene.lighting).toBe('rim_dark');
  });

  it('trades grain for turnaround on previews only', () => {
    const preview = planThreeDScene({ scene, brand, screenAssetPaths: ['a.png'], aspect: '16:9', quality: 'preview' });
    const master = planThreeDScene({ scene, brand, screenAssetPaths: ['a.png'], aspect: '16:9', quality: 'uhd' });
    expect(preview.scene.samples).toBeLessThan(master.scene.samples);
    expect(preview.scene.width).toBeLessThan(master.scene.width);
  });
});
