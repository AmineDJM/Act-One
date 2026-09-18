import 'server-only';
import { AppError, newId, type Project, type RevisionRequest } from '@act-one/core';
import { RevisionCompiler } from '@act-one/creative';
import { getStore } from './store.ts';
import { buildRegistry } from './platform.ts';
import { enqueue, renderPermission, revisionAllowance } from './projects.ts';
import type { Session } from './auth.ts';

/**
 * Revisions as a conversation.
 *
 * A sentence from the customer becomes a proposal: what we understood, which
 * scenes it touches, whether the product must be captured again, and whether
 * the film will be re-rendered. It is written back and waits. Only a
 * confirmation queues work — and it is the confirmed proposal that is
 * applied, not a second reading of the sentence.
 */
export async function proposeRevision(
  session: Session,
  project: Project,
  instruction: string,
): Promise<RevisionRequest> {
  const store = getStore();
  if (!project.activeStoryboardId)
    throw new AppError('conflict', 'There is no storyboard to revise yet.');
  const storyboard = await store.storyboards.get(
    session.organizationId,
    project.activeStoryboardId,
  );
  if (!storyboard) throw new AppError('not_found', 'Storyboard not found.');

  // A proposal that could never be confirmed is not worth resolving.
  const allowance = await revisionAllowance(session, project);
  if (!allowance.allowed) throw new AppError('entitlement_required', allowance.reason);

  // One open proposal at a time: a new sentence sets the previous one aside.
  const open = (
    await store.revisions.listForStoryboard(session.organizationId, storyboard.id)
  ).filter((request) => request.status === 'proposed');
  for (const request of open) {
    await store.revisions.update(session.organizationId, request.id, {
      status: 'declined',
      decidedAt: new Date().toISOString(),
    });
  }

  const registry = await buildRegistry({
    organizationId: session.organizationId,
    projectId: project.id,
  });
  const resolved = await new RevisionCompiler(registry.llm()).resolve(instruction, storyboard, {
    organizationId: session.organizationId,
    projectId: project.id,
  });

  const filmExists = Boolean(project.latestRenderId);
  const rerender = filmExists && !resolved.needsRecapture;
  const render = filmExists ? await renderPermission(session, project) : null;

  const sceneNumbers = resolved.affectedSceneIds
    .map((id) => storyboard.scenes.findIndex((scene) => scene.id === id) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const touches =
    sceneNumbers.length === 0
      ? 'It touches the whole film.'
      : sceneNumbers.length === 1
        ? `It touches scene ${sceneNumbers[0]}.`
        : `It touches scenes ${sceneNumbers.slice(0, -1).join(', ')} and ${sceneNumbers.at(-1)}.`;
  const consequence = resolved.needsRecapture
    ? 'We will go back into your product for new footage first; the film is re-rendered once that is in.'
    : rerender
      ? render?.allowed
        ? 'The film will be re-rendered with the change.'
        : `The storyboard changes now; the film cannot be re-rendered yet: ${render?.reason ?? ''}`.trim()
      : 'The storyboard changes; nothing is rendered until you ask.';
  const quota =
    allowance.limit < 0
      ? ''
      : `This would be revision ${allowance.used + 1} of ${allowance.limit} on your plan.`;
  const reply = [resolved.summary, touches, consequence, quota, 'Shall I go ahead?']
    .filter(Boolean)
    .join(' ');

  const request: RevisionRequest = {
    id: newId('cmt'),
    projectId: project.id,
    storyboardId: storyboard.id,
    authorUserId: session.user.id,
    instruction,
    intent: resolved.intent,
    affectedSceneIds: resolved.affectedSceneIds,
    applied: false,
    appliedAt: null,
    status: 'proposed',
    proposal: { ...resolved, rerender: rerender && Boolean(render?.allowed) },
    reply,
    decidedAt: null,
    createdAt: new Date().toISOString(),
  };
  return store.revisions.create(request, session.organizationId);
}

export async function confirmRevision(
  session: Session,
  project: Project,
  requestId: string,
): Promise<{ message: string }> {
  const store = getStore();
  const request = await store.revisions.get(session.organizationId, requestId);
  if (!request || request.projectId !== project.id)
    throw new AppError('not_found', 'That proposal is gone.');
  if (request.status !== 'proposed') {
    throw new AppError('conflict', 'That proposal was already answered.');
  }
  if (!request.proposal) throw new AppError('conflict', 'That proposal has nothing to apply.');

  // The allowance is checked again at the moment it is spent.
  const allowance = await revisionAllowance(session, project);
  if (!allowance.allowed) throw new AppError('entitlement_required', allowance.reason);

  await store.revisions.update(session.organizationId, request.id, {
    status: 'confirmed',
    decidedAt: new Date().toISOString(),
  });
  await enqueue(
    project,
    'repair_scene',
    {
      storyboardId: request.storyboardId,
      instruction: request.instruction,
      authorUserId: request.authorUserId,
      revisionRequestId: request.id,
      rerender: request.proposal.rerender,
    },
    6,
  );
  return {
    message: request.proposal.rerender
      ? 'Applying it and re-rendering the film.'
      : 'Applying it to the storyboard now.',
  };
}

export async function declineRevision(
  session: Session,
  project: Project,
  requestId: string,
): Promise<void> {
  const store = getStore();
  const request = await store.revisions.get(session.organizationId, requestId);
  if (!request || request.projectId !== project.id)
    throw new AppError('not_found', 'That proposal is gone.');
  if (request.status !== 'proposed') return;
  await store.revisions.update(session.organizationId, request.id, {
    status: 'declined',
    decidedAt: new Date().toISOString(),
  });
}
