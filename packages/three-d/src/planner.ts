import type { BrandSystem, Scene } from '@act-one/core';
import { normaliseScene, type RigName, type ThreeDScene } from './rigs.ts';

/**
 * Chooses a rig for a scene.
 *
 * Structured selection rather than a model call. What a 3D shot should be is
 * decided by what the scene is for, how many captures it has and what the brand
 * allows — all of which we already know. Asking a model produces variety for
 * its own sake, which in 3D means a different rig every scene and a film that
 * looks like a showreel.
 */
export function planThreeDScene(params: {
  scene: Scene;
  brand: BrandSystem;
  screenAssetPaths: string[];
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  quality?: 'preview' | 'hd' | 'uhd';
}): { scene: ThreeDScene; adjustments: string[] } {
  const { scene, brand } = params;
  const screens = params.screenAssetPaths.length;

  const rig: RigName =
    scene.motionRecipe.name === 'logo_reveal'
      ? 'logo_extrusion'
      : params.aspect === '9:16'
        ? 'device_phone'
        : screens >= 3
          ? 'floating_ui'
          : screens === 2
            ? 'layered_depth'
            : 'browser_float';

  const camera =
    scene.cameraRecipe.move === 'slow_pull'
      ? 'slow_pull'
      : scene.cameraRecipe.move === 'orbit'
        ? 'orbit_left'
        : 'slow_push';

  const dimensions = {
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
  }[params.aspect];

  const scale = params.quality === 'uhd' ? 2 : params.quality === 'preview' ? 0.5 : 1;

  return normaliseScene({
    rig,
    camera,
    screenAssets: params.screenAssetPaths,
    // A brand with an airy layout gets more separation; a dense one less, so
    // the 3D staging inherits the same rhythm as the flat compositions.
    depth: brand.layoutDensity === 'airy' ? 1.6 : brand.layoutDensity === 'dense' ? 0.8 : 1.2,
    // Glow-free brands get rim lighting only where the canvas is dark enough
    // to need separation, never as decoration.
    lighting: brand.allowsGlow ? 'rim_dark' : 'studio_soft',
    background: 'void',
    backgroundColor: brand.canvasDark,
    accentColor: brand.primaryColor,
    durationSeconds: scene.duration,
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
    // Longer lens: product photography, not a game engine.
    focalLengthMm: brand.visualStyle === 'editorial' ? 85 : 50,
    depthOfField: scene.cameraRecipe.depthOfField,
    // Preview renders trade grain for turnaround; masters do not.
    samples: params.quality === 'preview' ? 24 : params.quality === 'uhd' ? 192 : 96,
  });
}
