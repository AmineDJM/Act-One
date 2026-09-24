import { sceneWindows, type Scene, type Storyboard, type UiSequence } from '@act-one/core';
import type { DesignTokens } from '@act-one/design';
import type { StagedAsset } from './assets.ts';
import type { Canvas } from './canvas.ts';
import { isProductRecipe, productWindowBox } from './studio.ts';
import { inFrameWords, typesetScene } from './typeset.ts';
import { FILMED_RECIPES, filmedSequence } from './ui-sequence.ts';
import type { ScenePacket, SceneTiming } from './types.ts';

export type PacketInput = {
  storyboard: Storyboard;
  brandName: string;
  canvas: Canvas;
  staged: ReadonlyMap<string, StagedAsset>;
  logo: StagedAsset | null;
  cta: string;
  tagline: string;
  /** The tokens the type is set with: the authoring canvas's, the same the Remotion engine lays out with at HD. */
  design: DesignTokens;
};

/** The composition id of the scene at `index`: stable, sortable, safe as a file name. */
export function frameIdFor(index: number): string {
  return `scene-${String(index + 1).padStart(2, '0')}`;
}

/** One packet per scene, in film order. */
export function buildPackets(input: PacketInput): ScenePacket[] {
  const scenes = [...input.storyboard.scenes].sort((a, b) => a.index - b.index);
  const windows = new Map(sceneWindows(input.storyboard).map((window) => [window.sceneId, window]));

  return scenes.map((scene, position) => {
    const window = windows.get(scene.id);
    if (!window) throw new Error(`Scene ${scene.id} has no window; the storyboard's scene list is inconsistent.`);
    const previous = position > 0 ? scenes[position - 1]! : null;

    const assets = scene.assetRefs
      .map((id) => input.staged.get(id))
      .filter((asset): asset is StagedAsset => asset !== undefined);
    const clip = assets.find((asset) => asset.kind === 'video') ?? null;
    const hasImage = assets.some((asset) => asset.kind === 'image');

    return {
      frameId: frameIdFor(position),
      sceneId: scene.id,
      index: position,
      sceneCount: scenes.length,
      canvas: { aspect: input.canvas.aspect, width: input.canvas.width, height: input.canvas.height },
      timing: timingOf(window, scene, previous ? input.storyboard.handovers[previous.id] : undefined, input.storyboard.handovers[scene.id]),
      purpose: scene.purpose,
      onScreenText: [...scene.onScreenText],
      typeset: typesetScene(
        {
          recipe: scene.motionRecipe.name,
          index: scene.index,
          onScreenText: scene.onScreenText,
          hasClip: clip !== null,
          hasImage,
          hasLogo: input.logo !== null,
          brandName: input.brandName,
          cta: input.cta,
          tagline: input.tagline,
        },
        input.design,
      ),
      narration: scene.narration,
      visualType: scene.visualType,
      recipe: {
        name: scene.motionRecipe.name,
        easing: scene.motionRecipe.easing,
        delaySeconds: scene.motionRecipe.delay,
        staggerSeconds: scene.motionRecipe.stagger,
        intensity: scene.motionRecipe.intensity,
        params: { ...scene.motionRecipe.params },
      },
      camera: { ...scene.cameraRecipe },
      uiSequence: scene.uiSequence ? withLayerPaths(scene.uiSequence, input.staged) : null,
      assets,
      clip,
      productWindow:
        isProductRecipe(scene.motionRecipe.name) && hasImage
          ? productWindowBox({ recipe: scene.motionRecipe.name, visualType: scene.visualType, params: scene.motionRecipe.params }, input.design)
          : null,
      // Filmed exactly when the engine's composition would film it: a usable plan over a capture.
      inFrameWords:
        FILMED_RECIPES.has(scene.motionRecipe.name) && assets[0]?.kind === 'image' && filmedSequence(scene.uiSequence ?? null) !== null
          ? inFrameWords(scene.onScreenText, input.design)
          : null,
      brand: { name: input.brandName, logo: input.logo, cta: input.cta, tagline: input.tagline },
      isFinalScene: position === scenes.length - 1,
    } satisfies ScenePacket;
  });
}

function timingOf(
  window: { fromSeconds: number; toSeconds: number; arriveSeconds: number; departSeconds: number },
  scene: Scene,
  incoming: Storyboard['handovers'][string] | undefined,
  outgoing: Storyboard['handovers'][string] | undefined,
): SceneTiming {
  return {
    mountedSeconds: round3(window.toSeconds - window.fromSeconds),
    // Measured from the mount, which is earlier than the beat when the scene arrives through an overlap.
    beatStart: round3(scene.startTime - window.fromSeconds),
    beatDuration: scene.duration,
    arrives: window.arriveSeconds > 0 && incoming ? { through: incoming.kind, seconds: window.arriveSeconds } : null,
    leaves: window.departSeconds > 0 && outgoing ? { through: outgoing.kind, seconds: window.departSeconds } : null,
  };
}

/**
 * The sequence, with every layer's source named by its project path.
 *
 * A layer cut from another capture names that capture by asset id; the scene
 * can only place files by path, so the id is resolved here, and a layer whose
 * capture could not be staged says so instead of pointing at nothing.
 */
function withLayerPaths(sequence: UiSequence, staged: ReadonlyMap<string, StagedAsset>): unknown {
  return {
    ...sequence,
    framings: sequence.framings.map((framing) => ({
      ...framing,
      layers: framing.layers.map((layer) => {
        const { assetId, ...rest } = layer;
        if (!assetId) return { ...rest, source: 'own capture' };
        const asset = staged.get(assetId);
        return { ...rest, source: asset ? asset.path : 'unavailable: leave this layer out' };
      }),
    })),
  };
}

/** Every asset id a storyboard's scenes can place, including captures cut into another scene's layers. */
export function referencedAssetIds(storyboard: Storyboard): string[] {
  const ids = new Set<string>();
  for (const scene of storyboard.scenes) {
    for (const id of scene.assetRefs) ids.add(id);
    for (const framing of scene.uiSequence?.framings ?? []) {
      for (const layer of framing.layers) if (layer.assetId) ids.add(layer.assetId);
    }
  }
  return [...ids];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
