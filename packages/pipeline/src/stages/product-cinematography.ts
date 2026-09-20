import {
  REAL_PRODUCT_VISUAL_TYPES,
  planUiSequence,
  type AspectRatio,
  type RepairAction,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { readUiStructure } from '@act-one/research';
import type { StageContext } from '../context.ts';

/**
 * Filming the product.
 *
 * Between a capture existing and a capture being on screen there is a step
 * nobody was doing: deciding what the shot is. Without it the renderer gets
 * an image and a scene duration and does the only thing it can — show the
 * whole image, centred, for the length of the beat — and the result is a
 * slide, whatever the storyboard called it.
 *
 * This is that step. For every scene the director wrote as real product, it
 * reads the structure out of the actual bytes and plans a sequence of
 * framings: what the screen is about, where the work happens, what came of
 * it. The plan is stored on the scene, so it can be inspected, criticised and
 * repaired like any other creative decision rather than living inside the
 * renderer as a coincidence.
 *
 * Two things it deliberately does not do. It does not fall back to the flat
 * treatment quietly — when a capture cannot carry a sequence, the plan says
 * so in its notes and those notes travel with the scene. And it does not
 * touch a single pixel of the customer's interface.
 */
export type CinematographyShortfall = {
  sceneId: string;
  message: string;
  repair: RepairAction;
};

export type ProductCinematographyResult = {
  /** Scenes that came back with framings to cut between. */
  filmed: number;
  /** Scenes the director wrote as real product that could not be filmed. */
  unfilmed: number;
  /**
   * Where the shot the director asked for was not the shot production could
   * make, per scene.
   *
   * These become findings rather than log lines. A film whose product shots
   * all stayed wide because every capture was a thousand pixels across looks
   * exactly like a film that chose wide shots, and the difference only exists
   * if somebody wrote it down at the moment it happened.
   */
  shortfalls: CinematographyShortfall[];
  notes: string[];
};

/** Captures alone are filmed; a clip is already moving and a logo is not a screen. */
const FILMABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function filmTheProduct(
  context: StageContext,
  storyboard: Storyboard,
  options: { aspect: AspectRatio; renderWidth: number },
): Promise<{ storyboard: Storyboard; result: ProductCinematographyResult }> {
  const frameAspect = aspectRatio(options.aspect);
  const result: ProductCinematographyResult = { filmed: 0, unfilmed: 0, shortfalls: [], notes: [] };

  const candidates = storyboard.scenes.filter(
    (scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0,
  );
  if (candidates.length === 0) return { storyboard, result };

  const assets = await context.store.assets.getMany(
    context.organizationId,
    [...new Set(candidates.flatMap((scene) => scene.assetRefs))],
  );
  const byId = new Map(assets.map((asset) => [asset.id, asset] as const));
  const storage = context.registry.storage();

  /*
   * One read of the bytes per distinct capture, not per scene.
   *
   * The same screenshot commonly carries two or three beats of a film, and
   * the structure of an image does not depend on which scene is asking.
   */
  const structures = new Map<string, Awaited<ReturnType<typeof readUiStructure>> | null>();

  const filmed = new Map<string, Scene['uiSequence']>();
  for (const scene of candidates) {
    const assetId = scene.assetRefs.find((id) => {
      const asset = byId.get(id);
      return asset ? FILMABLE.has(asset.contentType) : false;
    });
    if (!assetId) {
      result.unfilmed += 1;
      result.notes.push(`${label(scene)}: no still capture among its material, so it was not filmed`);
      result.shortfalls.push({
        sceneId: scene.id,
        message:
          `This shot was written as the real product, and none of its material is a still capture that ` +
          `could be filmed. It plays as the whole asset held for the beat.`,
        repair: 'recapture_product',
      });
      continue;
    }

    if (!structures.has(assetId)) {
      const asset = byId.get(assetId)!;
      const bytes = await storage.get(asset.storageKey).catch(() => null);
      structures.set(assetId, bytes ? await readUiStructure(bytes).catch(() => null) : null);
    }
    const structure = structures.get(assetId) ?? null;
    if (!structure) {
      result.unfilmed += 1;
      result.notes.push(`${label(scene)}: its capture could not be read, so it was not filmed`);
      result.shortfalls.push({
        sceneId: scene.id,
        message:
          `The capture for this shot could not be read, so no framings were planned for it and it plays ` +
          `as the whole image held for the beat.`,
        repair: 'recapture_product',
      });
      continue;
    }

    const sequence = planUiSequence(structure, {
      seconds: scene.duration,
      frameAspect,
      renderWidth: options.renderWidth,
      hasWords: scene.onScreenText.some((line) => line.trim().length > 0),
    });
    filmed.set(scene.id, sequence);
    result.filmed += 1;
    for (const note of sequence.notes) result.notes.push(`${label(scene)}: ${note}`);
    /*
     * A plan whose framings are all nearly the whole capture is a plan that
     * could not be carried out. The cuts are still there and the shot still
     * moves, but nothing in it is a closer look at anything, which is the
     * entire reason the step exists.
     */
    const asset = byId.get(assetId)!;
    const tightest = Math.min(...sequence.framings.map((framing) => framing.to.width));
    if (sequence.framings.length > 1 && tightest > 0.85) {
      result.shortfalls.push({
        sceneId: scene.id,
        message:
          `The product could not be framed in this shot: its capture is ${structure.width}px across, and at ` +
          `${options.renderWidth}px wide the tightest crop it can carry is ${Math.round(tightest * 100)}% of ` +
          `the screen. Every framing shows almost the whole interface, so nothing in it is legible. ` +
          `A capture of at least ${Math.ceil((options.renderWidth * 2) / 100) * 100}px would let this shot ` +
          `hold one panel.` + (asset.sourceUrl ? ` Taken from ${asset.sourceUrl}.` : ''),
        repair: 'recapture_product',
      });
    }
  }

  if (filmed.size === 0) return { storyboard, result };

  const next: Storyboard = {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) =>
      filmed.has(scene.id) ? { ...scene, uiSequence: filmed.get(scene.id)! } : scene,
    ),
  };
  await context.store.storyboards.update(context.organizationId, storyboard.id, { scenes: next.scenes });
  return { storyboard: next, result };
}

function label(scene: Scene): string {
  return `scene ${scene.index + 1}`;
}

function aspectRatio(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map((part) => Number(part));
  return w && h ? w / h : 16 / 9;
}
