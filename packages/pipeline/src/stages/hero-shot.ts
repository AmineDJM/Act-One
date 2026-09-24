import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REAL_PRODUCT_VISUAL_TYPES,
  newId,
  resequence,
  searchHeroShots,
  type AspectRatio,
  type BrandSystem,
  type FramingRect,
  type HeroCandidate,
  type HeroShotRecord,
  type ProductUnderstanding,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { HeroShotDirector } from '@act-one/creative';
import { readUiStructure } from '@act-one/research';
import { extractFrame } from '@act-one/sound';
import { resolveAssetUrls, type StageContext } from '../context.ts';
import { drawPreview } from './film-engine.ts';

/**
 * Finding the shot the film is remembered for.
 *
 * Our own director's complaint about our own films, for months, was never
 * that they were wrong. It was that they were competent: "it never finds an
 * image or a move that makes it memorable." Competence is what a system
 * produces when every shot is decided by the same rule, and no rule produces
 * a hero shot, because a hero shot is by definition the one that is not like
 * the others.
 *
 * So this searches rather than decides. Every panel of every capture the film
 * holds, at three shot sizes, with and without a lifted element — typically
 * a hundred or more frames, all of them real crops of the customer's own
 * interface. The measurable ones are ranked by arithmetic that can be read
 * and argued with. The handful at the top are then rendered through the
 * actual renderer at the actual frame size, and a director looks at them.
 *
 * The whole thing is written down on the storyboard: how many frames were
 * considered, which won, what the measurement said, what the director said,
 * what it cost. A hero shot nobody can argue with is how a system stops
 * improving.
 */
export type HeroShotResult = {
  record: HeroShotRecord | null;
  notes: string[];
  costUsd: number;
};

/** How many frames get rendered and looked at. More is not better: it is a choice, not a survey. */
const SHORTLIST = 6;
/** Long enough in the cut to be read, short enough that it is a shot and not a pause. */
const HERO_SECONDS = 3.2;
const PREVIEW_SECONDS = 1.2;

export async function runHeroShot(
  context: StageContext,
  params: {
    storyboard: Storyboard;
    brand: BrandSystem;
    understanding: ProductUnderstanding | null;
    direction: string;
    aspect: AspectRatio;
    renderWidth: number;
    workDir: string;
  },
): Promise<HeroShotResult> {
  const notes: string[] = [];
  const { storyboard } = params;

  /*
   * Only shots the director wrote as real product can become the hero.
   *
   * Not because a generated shot could not be striking, but because the one
   * frame this film is remembered for should be a frame of the thing being
   * sold. That is the whole argument of the product.
   */
  const productScenes = storyboard.scenes.filter(
    (scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0,
  );
  if (productScenes.length === 0) {
    return { record: null, notes: ['this film has no real-product shot to build a hero out of'], costUsd: 0 };
  }

  const assetIds = [...new Set(productScenes.flatMap((scene) => scene.assetRefs))];
  const assets = await context.store.assets.getMany(context.organizationId, assetIds);
  const storage = context.registry.storage();

  const captures: { assetId: string; structure: Awaited<ReturnType<typeof readUiStructure>> }[] = [];
  for (const asset of assets) {
    if (!asset.contentType.startsWith('image/')) continue;
    const bytes = await storage.get(asset.storageKey).catch(() => null);
    if (!bytes) {
      notes.push(`${asset.id}: its bytes are not in this worker's storage, so it was not searched`);
      continue;
    }
    const structure = await readUiStructure(bytes).catch(() => null);
    if (!structure) {
      notes.push(`${asset.id}: could not be read, so it was not searched`);
      continue;
    }
    captures.push({ assetId: asset.id, structure });
  }
  if (captures.length === 0) {
    return { record: null, notes: [...notes, 'none of this film’s captures could be searched'], costUsd: 0 };
  }

  /*
   * What the film already shows, so the hero is not a shot the audience has
   * just seen. These come from the framing plans production has already
   * written, which is the only honest source: what the film shows is what
   * was planned for it, not what anybody intended.
   */
  const taken: { assetId: string; rect: FramingRect }[] = [];
  for (const scene of storyboard.scenes) {
    if (!scene.uiSequence) continue;
    const assetId = scene.assetRefs[0];
    if (!assetId) continue;
    for (const framing of scene.uiSequence.framings) {
      /*
       * What a shot showed, not what rectangle it used. A spatial shot does
       * not crop — its rectangle is the whole capture — so what the audience
       * actually saw is the panels it hung in the space.
       */
      if (framing.space === 'volume' && framing.layers.length > 0) {
        for (const layer of framing.layers) taken.push({ assetId: layer.assetId ?? assetId, rect: layer.rect });
        continue;
      }
      taken.push({ assetId, rect: framing.to });
    }
  }

  const search = searchHeroShots(
    { captures, frameAspect: aspectRatio(params.aspect), renderWidth: params.renderWidth, seconds: HERO_SECONDS, taken },
    SHORTLIST,
  );
  notes.push(...search.notes);
  if (search.candidates.length === 0) {
    return { record: null, notes, costUsd: 0 };
  }

  await context.activity({
    step: 'motion',
    kind: 'step',
    label: `looking for the shot this film is remembered for`,
    detail: `${search.considered} frames considered, ${search.candidates.length} rendered to look at`,
    status: 'active',
  });

  const frames = await renderShortlist(context, search.candidates, params);
  if (frames.length !== search.candidates.length) {
    notes.push(
      `only ${frames.length} of ${search.candidates.length} shortlisted frames rendered, so the choice was made from those`,
    );
  }
  const shortlist = search.candidates.slice(0, frames.length);
  if (shortlist.length === 0) {
    return { record: null, notes: [...notes, 'no shortlisted frame could be rendered to look at'], costUsd: 0 };
  }

  const director = new HeroShotDirector(context.registry.llm());
  const choice = await director.choose(
    {
      candidates: shortlist,
      frames,
      understanding: params.understanding,
      direction: params.direction,
    },
    { organizationId: context.organizationId, projectId: context.project.id },
  );
  const chosen = shortlist[choice.index]!;

  /*
   * Which shot in the film becomes the hero.
   *
   * The one already built around this capture, and among those the longest —
   * it has the most room to hold a frame. Failing that, the longest product
   * shot there is. The hero is not an extra scene bolted on: a film that
   * gains a shot at this stage is a film whose running time nobody agreed to.
   */
  const onCapture = productScenes.filter((scene) => scene.assetRefs.includes(chosen.assetId));
  const host = [...(onCapture.length > 0 ? onCapture : productScenes)].sort(
    (left, right) => right.duration - left.duration,
  )[0]!;

  const record: HeroShotRecord = {
    sceneId: host.id,
    assetId: chosen.assetId,
    framing: { ...chosen.framing, seconds: Math.min(HERO_SECONDS, host.duration) },
    sourceWidth: chosen.sourceWidth,
    sourceHeight: chosen.sourceHeight,
    background: chosen.background,
    mechanism: chosen.mechanism,
    considered: search.considered,
    shortlisted: shortlist.length,
    score: chosen.score,
    why: chosen.why,
    reason: choice.reason,
    giveUp: choice.giveUp,
    judged: choice.asked,
    costUsd: choice.costUsd,
    chosenAt: new Date().toISOString(),
    notes,
  };

  await context.activity({
    step: 'motion',
    kind: 'note',
    label: `hero shot: frame ${choice.index + 1} of ${shortlist.length}`,
    detail: choice.reason.slice(0, 200),
    status: 'done',
  });

  return { record, notes, costUsd: choice.costUsd };
}

/**
 * Puts the hero into the film.
 *
 * As the opening beat of the shot that hosts it, with the rest of that shot's
 * framings following in the time that is left. The hero is the thing the
 * scene is now about, so it comes first and it holds; what was planned for
 * that scene becomes what follows, rather than being thrown away.
 */
export function withHeroShot(storyboard: Storyboard, record: HeroShotRecord): Storyboard {
  return {
    ...storyboard,
    heroShot: record,
    scenes: storyboard.scenes.map((scene) => {
      if (scene.id !== record.sceneId) return scene;
      /*
       * What the scene was going to show after its subject survives — but
       * only when the hero is a frame of the same capture. Framings are
       * rectangles of a specific picture; carried across to another one they
       * are rectangles of nothing in particular.
       */
      const sameCapture = scene.assetRefs[0] === record.assetId && scene.uiSequence !== null;
      const rest = sameCapture
        ? scene.uiSequence!.framings.filter(
            (framing) => framing.role !== 'establish' && framing.role !== 'subject',
          )
        : [];
      const left = Math.max(0, scene.duration - record.framing.seconds);
      const share = rest.length > 0 ? left / rest.reduce((sum, framing) => sum + framing.seconds, 0) : 0;
      const assetRefs = scene.assetRefs.includes(record.assetId)
        ? [record.assetId, ...scene.assetRefs.filter((id) => id !== record.assetId)]
        : [record.assetId, ...scene.assetRefs];
      return {
        ...scene,
        assetRefs,
        uiSequence: {
          sourceWidth: record.sourceWidth,
          sourceHeight: record.sourceHeight,
          background: record.background,
          framings: [
            record.framing,
            ...(share > 0.15
              ? rest.map((framing) => ({ ...framing, seconds: framing.seconds * share, cut: true }))
              : []),
          ],
          notes: sameCapture ? scene.uiSequence!.notes : [],
        },
      } satisfies Scene;
    }),
  };
}

/**
 * Renders the shortlist, through the renderer that makes the film.
 *
 * One render of one short film rather than N stills: the bundle is built
 * once, the browser starts once, and what comes out is frames of the actual
 * composition — the vignette, the lift, the scale, all of it — rather than a
 * crop that resembles them.
 */
async function renderShortlist(
  context: StageContext,
  candidates: readonly HeroCandidate[],
  params: { brand: BrandSystem; aspect: AspectRatio; workDir: string },
): Promise<string[]> {
  const { urls } = await resolveAssetUrls(context, [...new Set(candidates.map((c) => c.assetId))]);
  const usable = candidates.filter((candidate) => urls[candidate.assetId]);
  if (usable.length === 0) return [];

  const id = newId('sbd');
  const storyboard: Storyboard = resequence({
    id,
    projectId: context.project.id,
    conceptId: 'cpt_hero',
    treatmentId: 'trt_hero', handovers: {},
    version: 1,
    scenes: usable.map((candidate, index) => ({
      id: `scn_hero_${index}`,
      storyboardId: id,
      index,
      startTime: 0,
      duration: PREVIEW_SECONDS,
      purpose: `Hero candidate ${index + 1}`,
      narration: '',
      onScreenText: [],
      visualType: 'product_ui' as const,
      assetRefs: [candidate.assetId],
      momentIds: [],
      motionRecipe: { name: 'product_window' as const, easing: 'out_quint' as const, delay: 0, stagger: 0, intensity: 0.6, params: {} },
      cameraRecipe: {
        move: 'static' as const, fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0,
        motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' as const,
      },
      /*
       * Held, not moving. What is being judged is a frame, and a frame of a
       * push is a frame from somewhere in the middle of a move nobody chose.
       */
      uiSequence: {
        sourceWidth: candidate.sourceWidth,
        sourceHeight: candidate.sourceHeight,
        background: candidate.background,
        framings: [{ ...candidate.framing, from: candidate.framing.to, move: 'hold' as const, seconds: PREVIEW_SECONDS }],
        notes: [],
      },
      soundCues: [],
      voiceOver: false,
      generativeNeeds: [],
      threeDSceneId: null,
      status: 'draft' as const,
      claimEvidenceIds: [],
      notes: '',
      estimatedCostUsd: 0,
    })),
    voiceStrategy: 'none',
    language: null,
    heroShot: null,
    musicDirection: '',
    status: 'draft',
    parentStoryboardId: null,
    revisionReason: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const work = await mkdtemp(path.join(params.workDir, 'hero-'));
  try {
    const outputPath = path.join(work, 'shortlist.mp4');
    await drawPreview(context, {
      props: {
        storyboard,
        brand: params.brand,
        assetUrls: urls,
        watermarkLabel: null,
        footageAssetIds: [],
      },
      aspect: params.aspect,
      quality: 'preview',
      fps: 15,
      outputPath,
    });

    const frames: string[] = [];
    for (const [index] of usable.entries()) {
      const framePath = path.join(work, `hero-${index}.jpg`);
      const at = index * PREVIEW_SECONDS + PREVIEW_SECONDS * 0.6;
      const data = await extractFrame(outputPath, at, framePath);
      if (!data) break;
      frames.push(`data:image/jpeg;base64,${Buffer.from(data).toString('base64')}`);
    }
    return frames;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function aspectRatio(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map((part) => Number(part));
  return w && h ? w / h : 16 / 9;
}
