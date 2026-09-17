import { describe, it, expect } from 'vitest';
import { AssetKind, AssetOrigin, isRealProductAsset } from '../index.ts';

/**
 * The product's one absolute rule: a film may never show invented software as
 * somebody's real interface. Everything downstream — shot routing, scene asset
 * generation, the check the renderer runs before it spends money — asks this
 * one question, so this is where the rule is actually written down.
 */
describe('what may stand for the product', () => {
  it('accepts what the agent observed in the real product', () => {
    expect(isRealProductAsset({ origin: 'captured', kind: 'screenshot' })).toBe(true);
    expect(isRealProductAsset({ origin: 'captured', kind: 'screen_recording' })).toBe(true);
  });

  it('accepts what the customer handed us', () => {
    expect(isRealProductAsset({ origin: 'uploaded', kind: 'screenshot' })).toBe(true);
    expect(isRealProductAsset({ origin: 'uploaded', kind: 'brand_image' })).toBe(true);
  });

  it('refuses anything a model made, whatever it is called', () => {
    for (const kind of AssetKind.options) {
      expect(isRealProductAsset({ origin: 'generated', kind }), `generated ${kind}`).toBe(false);
    }
  });

  it('refuses our own output, which is not evidence of anything', () => {
    // Typography, 3D staging and scene renders are ours. A 3D hero shot stages
    // a real capture and keeps pointing at that capture, so it passes on the
    // strength of the capture rather than of the render.
    expect(isRealProductAsset({ origin: 'rendered', kind: 'threed_render' })).toBe(false);
    expect(isRealProductAsset({ origin: 'rendered', kind: 'scene_render' })).toBe(false);
  });

  it('refuses sound, which cannot show an interface', () => {
    for (const origin of AssetOrigin.options) {
      expect(isRealProductAsset({ origin, kind: 'audio_music' }), origin).toBe(false);
      expect(isRealProductAsset({ origin, kind: 'audio_voice' }), origin).toBe(false);
    }
  });
});
