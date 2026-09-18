import {
  AppError,
  MODE_BUDGETS,
  REAL_PRODUCT_VISUAL_TYPES,
  usdToCredits,
  type GenerativeNeed,
  type Scene,
} from '@act-one/core';
import { planThreeDScene, renderThreeDScene, isBlenderAvailable } from '@act-one/three-d';
import { ingestAsset, resolveAssetUrls, type StageContext } from '../context.ts';

/**
 * Scene asset generation.
 *
 * Fills in what a storyboard asks for and does not yet have: generated
 * cinematography for atmospheric scenes, 3D staging for hero shots. Runs before
 * the render so the motion engine never waits on a provider mid-frame.
 *
 * Every generated asset is copied into our own storage immediately. Higgsfield
 * URLs expire; a film we cannot re-render in six months is not a deliverable.
 */
export type AssetResult = {
  generated: number;
  skipped: number;
  failed: number;
  costUsd: number;
  notes: string[];
};

export async function runSceneAssets(
  context: StageContext,
  options: { storyboardId: string; sceneIds?: string[] },
): Promise<AssetResult> {
  const { store, registry, project, organizationId } = context;

  const storyboard = await store.storyboards.get(organizationId, options.storyboardId);
  if (!storyboard) throw new AppError('not_found', 'Storyboard not found.');

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  const scope = options.sceneIds ? new Set(options.sceneIds) : null;
  const scenes = storyboard.scenes.filter((scene) => !scope || scope.has(scene.id));

  const result: AssetResult = { generated: 0, skipped: 0, failed: 0, costUsd: 0, notes: [] };

  /*
   * Spend is capped against the film's own length, so a long storyboard cannot
   * quietly authorise a proportionally enormous bill.
   *
   * And the allowance belongs to the production, not to this attempt. A job
   * that fails after generating half its shots is retried automatically — with
   * a fresh budget, three attempts could spend three times what the customer
   * agreed to. What this production has already spent on generated media comes
   * off the top.
   */
  const budget = MODE_BUDGETS[project.brief.creativeMode];
  const allowance = budget.maxCostPerSecondUsd * storyboard.scenes.reduce((sum, s) => sum + s.duration, 0);
  const spent = (await store.costs.listForProject(organizationId, project.id))
    .filter((cost) => cost.operation.startsWith('media.') && cost.succeeded)
    .reduce((sum, cost) => sum + (cost.actualCostUsd || cost.estimatedCostUsd), 0);
  let remaining = Math.max(0, allowance - spent);
  if (spent > 0) {
    result.notes.push(`$${spent.toFixed(2)} of the $${allowance.toFixed(2)} media allowance was already spent on this production.`);
  }

  const organization = await store.organizations.get(organizationId);
  const blenderReady = await isBlenderAvailable();

  await context.activity({ step: 'captures', kind: 'step', label: `preparing ${scenes.length} scenes`, status: 'active' });
  for (const [index, scene] of scenes.entries()) {
    await context.progress(index / Math.max(1, scenes.length), `Preparing scene ${scene.index + 1}`);

    if (needsThreeD(scene)) {
      const outcome = await renderThreeD(context, scene, brand, blenderReady);
      if (outcome === 'generated') result.generated += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else result.failed += 1;
      continue;
    }

    /*
     * A scene that shows the product shows the product. Generative media is
     * allowed to support, contextualise and metaphorise around it, and is never
     * allowed to stand in for it — so a generated shot is not written into a
     * product scene even if one somehow asks for it. The storyboard engine
     * already routes these apart; this is the second lock, because the cost of
     * it being wrong is showing a founder an interface that is not theirs.
     */
    if (REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.generativeNeeds.length > 0) {
      result.skipped += scene.generativeNeeds.length;
      result.notes.push(
        `Scene ${scene.index + 1}: shows the product, so it is not generated.`,
      );
      continue;
    }

    for (const need of scene.generativeNeeds) {
      if (scene.assetRefs.length > 0) {
        result.skipped += 1;
        continue;
      }

      const media = registry.mediaOrNull();
      if (!media) {
        // Generative media is off for this deployment. The storyboard engine
        // routes around it, so this is a configuration state rather than a
        // failure — the scene falls back to typography at render time.
        result.skipped += 1;
        result.notes.push(`Scene ${scene.index + 1}: generative media is disabled.`);
        continue;
      }

      const estimate = await media.estimateCost({
        prompt: need.brief,
        aspect: need.aspect,
        tier: tierFor(project.brief.creativeMode),
        durationSeconds: need.durationSeconds,
      });

      if (estimate > remaining) {
        result.skipped += 1;
        result.notes.push(
          `Scene ${scene.index + 1}: skipped, $${estimate.toFixed(2)} would exceed the remaining budget.`,
        );
        continue;
      }

      // Credits are checked before the call, not after: a customer who cannot
      // afford a shot should be told, not billed.
      const credits = usdToCredits(estimate);
      if (organization && organization.creditBalance < credits) {
        result.skipped += 1;
        result.notes.push(`Scene ${scene.index + 1}: skipped, not enough credits.`);
        continue;
      }

      try {
        const asset = await generateShot(context, scene, need, estimate);
        if (asset) {
          result.generated += 1;
          result.costUsd += estimate;
          remaining -= estimate;
          if (organization) await store.organizations.adjustCredits(organizationId, -credits);
        } else {
          result.failed += 1;
        }
      } catch (error) {
        // A failed shot is not a failed film. The scene keeps its brief and
        // QA will flag it if the gap matters.
        result.failed += 1;
        result.notes.push(`Scene ${scene.index + 1}: ${(error as Error).message.slice(0, 120)}`);
      }
    }
  }

  await context.activity({
    step: 'captures',
    kind: 'step',
    label: `${result.generated} shot${result.generated === 1 ? '' : 's'} generated, ${result.skipped} scene${result.skipped === 1 ? '' : 's'} on real capture`,
    status: 'done',
  });
  await context.progress(1, `${result.generated} generated, ${result.skipped} skipped`);
  return result;
}

async function generateShot(
  context: StageContext,
  scene: Scene,
  need: GenerativeNeed,
  estimate: number,
): Promise<string | null> {
  const { store, registry, project, organizationId } = context;
  const media = registry.media();
  const call = { organizationId, projectId: project.id, sceneId: scene.id, signal: context.signal };

  // Anchoring to a reference keeps generated footage in the brand's own palette
  // instead of the model's default look, which is the single biggest reason
  // generated shots read as bolted on.
  const referenceUrls = need.referenceAssetIds.length
    ? Object.values(await resolveAssetUrls(context, need.referenceAssetIds))
    : [];

  const job = await media.generateVideo(
    {
      prompt: buildPrompt(need),
      aspect: need.aspect,
      tier: tierFor(project.brief.creativeMode),
      durationSeconds: need.durationSeconds,
      ...(referenceUrls[0] ? { initImageUrl: referenceUrls[0] } : {}),
      referenceUrls,
      motionStrength: 0.45,
    },
    call,
  );

  const finished = await media.waitForJob(job.id, call, 8 * 60_000);
  if (finished.status !== 'succeeded' || finished.outputUrls.length === 0) {
    return null;
  }

  const stored = await ingestAsset(context, {
    url: finished.outputUrls[0]!,
    kind: 'generated_video',
    origin: 'generated',
    // Never customer_owned. The rights tag is what stops a generated shot
    // being treated as real product footage anywhere downstream.
    rights: 'generated_derivative',
    extension: 'mp4',
    contentType: 'video/mp4',
    sceneId: scene.id,
    provider: 'higgsfield',
    model: finished.model,
    costUsd: estimate,
    durationSeconds: need.durationSeconds,
    // Where the shot came from, kept: a generated clip anchored to a real
    // still is that still's descendant, and the library shows the line.
    source: 'generated',
    parentAssetId: need.referenceAssetIds[0] ?? null,
    name: `Generated shot, scene ${scene.index + 1}`,
    description: need.brief.slice(0, 300),
  });

  await store.storyboards.updateScene(organizationId, scene.id, {
    assetRefs: [stored.asset.id],
    status: 'ready',
  });

  return stored.asset.id;
}

async function renderThreeD(
  context: StageContext,
  scene: Scene,
  brand: NonNullable<Awaited<ReturnType<StageContext['store']['brands']['get']>>>,
  blenderReady: boolean,
): Promise<'generated' | 'skipped' | 'failed'> {
  if (!blenderReady) {
    // The motion engine stages the same capture flat instead. A missing 3D
    // host degrades the shot, it does not lose the scene.
    await context.store.storyboards.updateScene(context.organizationId, scene.id, {
      visualType: 'screenshot_motion',
      notes: `${scene.notes} [3D unavailable; staged flat]`.trim(),
    });
    return 'skipped';
  }

  const screenUrls = Object.values(await resolveAssetUrls(context, scene.assetRefs));
  if (screenUrls.length === 0) return 'skipped';

  const { scene: threeD } = planThreeDScene({
    scene,
    brand,
    screenAssetPaths: screenUrls,
    aspect: '16:9',
  });

  const result = await renderThreeDScene({
    scene: threeD,
    ...(context.signal ? { signal: context.signal } : {}),
  });

  return result.ok ? 'generated' : 'failed';
}

/**
 * Turns a shot brief into a prompt.
 *
 * The negative instruction is not decoration. Every generative model will
 * cheerfully render text, and text inside a generated frame is the single
 * clearest sign a film was machine-made — it is always slightly wrong, and it
 * is always the thing a viewer looks at.
 */
function buildPrompt(need: GenerativeNeed): string {
  const constraints = [
    'cinematic',
    'shallow depth of field',
    'natural motion',
    need.mustNotContainText ? 'absolutely no text, no letters, no numbers, no signage, no UI' : '',
    'no watermarks',
    'no logos',
  ].filter(Boolean);

  return `${need.brief.trim()}. ${constraints.join(', ')}.`;
}

function needsThreeD(scene: Scene): boolean {
  return scene.visualType === 'product_ui_3d' || scene.visualType === 'cinematic_3d';
}

function tierFor(mode: 'authentic' | 'studio' | 'cinematic'): 'authentic' | 'studio' | 'cinematic' {
  return mode;
}
