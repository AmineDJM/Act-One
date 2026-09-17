import 'server-only';
import { AppError, can, newId, type Comment, type CommentTarget } from '@act-one/core';
import type { Session } from './auth.ts';
import { getStore } from './store.ts';

export type CommentView = Comment & { authorName: string; authorEmail: string };

/**
 * Comments on a project.
 *
 * The reviewer role has existed since the first migration and the settings page
 * has been telling people reviewers "can read and comment" — with nothing to
 * comment with. A role that grants a capability the product does not have is a
 * promise the product breaks the first time somebody takes it up.
 *
 * Timeline comments carry the second they refer to, because "the cut at 0:14 is
 * too fast" and "the cut is too fast" are different notes, and only one of them
 * can be acted on without watching the whole film again.
 */
export async function postComment(
  session: Session,
  input: { projectId: string; target: CommentTarget; targetId: string; body: string; atSeconds: number | null },
): Promise<Comment> {
  if (!can(session.actor, 'comment:write')) {
    throw new AppError('forbidden', 'Your role cannot comment.');
  }

  const body = input.body.trim();
  if (!body) throw new AppError('validation_failed', 'Write something first.');

  const store = getStore();
  // Scoped read: a target id from another workspace must not become a comment
  // in this one.
  const project = await store.projects.get(session.organizationId, input.projectId);
  if (!project) throw new AppError('not_found', 'Project not found.');

  return store.comments.create({
    id: newId('cmt'),
    organizationId: session.organizationId,
    projectId: project.id,
    target: input.target,
    targetId: input.targetId,
    authorUserId: session.user.id,
    body: body.slice(0, 4000),
    atSeconds: input.atSeconds,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: new Date().toISOString(),
  });
}

export async function resolveComment(session: Session, commentId: string): Promise<void> {
  if (!can(session.actor, 'comment:write')) {
    throw new AppError('forbidden', 'Your role cannot resolve comments.');
  }
  await getStore().comments.resolve(session.organizationId, commentId, session.user.id);
}

/** Every comment on a project, with who wrote it. */
export async function loadComments(session: Session, projectId: string): Promise<CommentView[]> {
  const store = getStore();
  const comments = await store.comments.listForProject(session.organizationId, projectId);
  if (comments.length === 0) return [];

  // One lookup per person rather than per comment: a lively thread is mostly
  // the same three people.
  const members = await store.memberships.listForOrganization(session.organizationId);
  const byUser = new Map(members.map((member) => [member.userId, member.user]));

  return comments.map((comment) => {
    const author = byUser.get(comment.authorUserId);
    return {
      ...comment,
      authorName: author?.name || author?.email || 'Someone',
      authorEmail: author?.email ?? '',
    };
  });
}
