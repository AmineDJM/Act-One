import { AppError, newId, resequence, storyboardDuration } from '@act-one/core';
import { DEFAULT_CAMPAIGN, campaignFor, planCampaign, toVariant, variantStoryboard } from '@act-one/creative';
import type { StageContext } from '../context.ts';
import { runRender } from './render.ts';

/**
 * Campaign stage.
 *
 * Re-cuts the approved material for each channel. Every variant is a genuine
 * re-edit — different scene selection, re-timed, recomposed for its own frame —
 * because a cropped master is the single most recognisable sign that a
 * "campaign" was generated rather than cut.
 *
 * No new creative decisions are made here, so nothing needs re-approving.
 */
export async function runCampaign(
  context: StageContext,
  options: { renderId: string; purposes?: typeof DEFAULT_CAMPAIGN },
): Promise<{ variantIds: string[] }> {
  const { store, project, organizationId } = context;

  const master = await store.renders.get(organizationId, options.renderId);
  if (!master) throw new AppError('not_found', 'Master render not found.');

  const storyboard = await store.storyboards.get(organizationId, master.storyboardId);
  if (!storyboard) throw new AppError('conflict', 'The storyboard behind this film is missing.');

  // A vertical master does not need four vertical re-crops of itself.
  const purposes = options.purposes ?? campaignFor(project.brief.filmCut);
  const plans = planCampaign(storyboard, purposes);

  const variants = plans.map((plan) => toVariant({ renderId: master.id, projectId: project.id, plan }));
  await store.variants.createMany(variants);

  const rendered: string[] = [];

  for (const [index, plan] of plans.entries()) {
    const variant = variants[index]!;
    await context.progress(index / plans.length, `Cutting ${plan.purpose.replace(/_/g, ' ')}`);

    // Each cut is its own storyboard, persisted so the variant can be
    // re-rendered later without re-deriving the edit.
    const cut = resequence(variantStoryboard(storyboard, plan, newId('sbd')));
    const cutBoard = await store.storyboards.create(
      {
        ...cut,
        version: (await store.storyboards.nextVersion(organizationId, project.id)),
        status: 'approved',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      organizationId,
    );

    try {
      const result = await runRender(context, {
        storyboardId: cutBoard.id,
        aspect: plan.aspect,
        // Resolution and watermark come from the plan, the same as the master's
        // did — a cut of a clean 4K film is a clean 4K cut.
        // Vision QA already ran on the master, and these are the same frames
        // recomposed — paying for it again per cut is waste.
        skipVisionQa: true,
        maxRepairAttempts: 1,
        kind: 'cut',
        /*
         * Burned in where the format says so, which is every vertical and
         * square cut. Those are watched muted in a feed, where a caption the
         * viewer has to switch on is a caption nobody reads — and the plan
         * has already decided it, per purpose, from the channel's own spec.
         */
        burnCaptions: plan.captionsBurned,
      });

      await store.variants.update(organizationId, variant.id, {
        status: 'completed',
        assetId: result.assetId,
      });
      rendered.push(variant.id);
    } catch (error) {
      // One failed cut must not lose the rest of the campaign.
      await store.variants.update(organizationId, variant.id, { status: 'failed' });
      console.error(`[campaign] ${plan.purpose} failed:`, (error as Error).message);
    }
  }

  await context.progress(1, `${rendered.length} of ${plans.length} cuts ready`);
  return { variantIds: rendered };
}

