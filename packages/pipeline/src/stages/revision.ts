import { AppError, newId } from '@act-one/core';
import { RevisionCompiler, applyRevision, toRevisionRequest } from '@act-one/creative';
import type { StageContext } from '../context.ts';

/**
 * Revision stage.
 *
 * Resolves a customer's sentence into a scoped edit, applies it, and records
 * which scenes changed so the render that follows touches only those.
 */
export async function runRevision(
  context: StageContext,
  options: {
    storyboardId: string;
    instruction: string;
    authorUserId: string;
    /** The proposal the customer confirmed, when the revision came from the conversation. */
    revisionRequestId?: string;
    /** Re-render the film once the storyboard has changed: what "regenerate" means. */
    rerender?: boolean;
  },
): Promise<{ changedSceneIds: string[]; summary: string; needsRecapture: boolean }> {
  const { store, registry, project, organizationId } = context;

  const storyboard = await store.storyboards.get(organizationId, options.storyboardId);
  if (!storyboard) throw new AppError('not_found', 'Storyboard not found.');

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  await context.progress(0.2, 'Working out what you meant');

  // What the customer confirmed is what is applied — not a fresh reading of
  // their sentence that might land somewhere else.
  const confirmed = options.revisionRequestId
    ? await store.revisions.get(organizationId, options.revisionRequestId)
    : null;
  const resolved =
    confirmed?.proposal ??
    (await new RevisionCompiler(registry.llm()).resolve(options.instruction, storyboard, {
      organizationId,
      projectId: project.id,
      signal: context.signal,
    }));

  const request =
    confirmed ??
    (await store.revisions.create(
      {
        ...toRevisionRequest({
          projectId: project.id,
          storyboardId: storyboard.id,
          authorUserId: options.authorUserId,
          instruction: options.instruction,
          resolved,
        }),
        status: 'confirmed',
        proposal: { ...resolved, rerender: Boolean(options.rerender) },
        reply: resolved.summary,
        decidedAt: new Date().toISOString(),
      },
      organizationId,
    ));

  await context.progress(0.6, resolved.summary);

  const applied = applyRevision(storyboard, resolved, brand);
  await store.storyboards.replaceScenes(organizationId, storyboard.id, applied.storyboard.scenes);

  if (applied.storyboard.voiceStrategy !== storyboard.voiceStrategy) {
    await store.storyboards.update(organizationId, storyboard.id, {
      voiceStrategy: applied.storyboard.voiceStrategy,
    });
  }

  await store.revisions.markApplied(organizationId, request.id, applied.changedSceneIds);
  await store.revisions.update(organizationId, request.id, { status: 'applied' });

  // Recapture needs the browser and the customer's credentials, so it is its
  // own job rather than something done inline here.
  if (resolved.needsRecapture && applied.changedSceneIds.length > 0) {
    const now = new Date().toISOString();
    await store.jobs.enqueue({
      id: newId('job'),
      organizationId,
      projectId: project.id,
      kind: 'capture_product_moments',
      state: 'queued',
      payload: {
        storyboardId: storyboard.id,
        sceneIds: applied.changedSceneIds,
        subject: resolved.requestedSubject,
      },
      progress: 0,
      statusMessage: '',
      attempts: 0,
      maxAttempts: 2,
      lastError: null,
      runAfter: now,
      lockedBy: null,
      lockedAt: null,
      startedAt: null,
      priority: 7,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Regenerating the film is the point of confirming a change once one
  // exists. A change that needs new capture waits for it instead.
  if (options.rerender && !resolved.needsRecapture) {
    const now = new Date().toISOString();
    await store.jobs.enqueue({
      id: newId('job'),
      organizationId,
      projectId: project.id,
      kind: 'render_film',
      state: 'queued',
      payload: { storyboardId: storyboard.id },
      progress: 0,
      statusMessage: '',
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      runAfter: now,
      lockedBy: null,
      lockedAt: null,
      startedAt: null,
      priority: 5,
      createdAt: now,
      updatedAt: now,
    });
  }

  await context.progress(1, resolved.summary);
  return {
    changedSceneIds: applied.changedSceneIds,
    summary: resolved.summary,
    needsRecapture: resolved.needsRecapture,
  };
}
