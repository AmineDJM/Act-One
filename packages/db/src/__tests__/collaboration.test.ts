import { describe, it, expect, beforeEach } from 'vitest';
import { newId, type Comment, type Organization, type Project, type User } from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';

function org(name: string): Organization {
  return {
    id: newId('org'), name, slug: name.toLowerCase(), planId: 'free', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(email: string): User {
  return {
    id: newId('usr'), email, name: email.split('@')[0]!, avatarUrl: null,
    isSuperAdmin: false, createdAt: new Date().toISOString(),
  };
}

function comment(organizationId: string, projectId: string, authorUserId: string, over: Partial<Comment> = {}): Comment {
  return {
    id: newId('cmt'), organizationId, projectId, target: 'project', targetId: projectId,
    authorUserId, body: 'The opening holds too long.', atSeconds: null,
    resolvedAt: null, resolvedByUserId: null, createdAt: new Date().toISOString(), ...over,
  };
}

describe('comments', () => {
  let store: MemoryStore;
  let acme: Organization;
  let rival: Organization;
  let author: User;

  beforeEach(async () => {
    store = new MemoryStore();
    acme = org('Acme');
    rival = org('Rival');
    author = user('lead@acme.com');
    await store.organizations.create(acme);
    await store.organizations.create(rival);
    await store.users.create(author);
  });

  it('keeps one workspace out of another workspace\'s notes', async () => {
    // The blunt rule the whole store is held to: another tenant's project id
    // behaves as if it does not exist.
    await store.comments.create(comment(acme.id, 'prj_acme', author.id));
    expect(await store.comments.listForProject(rival.id, 'prj_acme')).toEqual([]);
    expect(await store.comments.listForProject(acme.id, 'prj_acme')).toHaveLength(1);
  });

  it('records who resolved a note and when', async () => {
    const created = await store.comments.create(comment(acme.id, 'prj_acme', author.id));
    const resolved = await store.comments.resolve(acme.id, created.id, author.id);

    expect(resolved.resolvedByUserId).toBe(author.id);
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('refuses to resolve a note belonging to another workspace', async () => {
    const created = await store.comments.create(comment(acme.id, 'prj_acme', author.id));
    await expect(store.comments.resolve(rival.id, created.id, author.id)).rejects.toThrow();
  });

  it('keeps the second a timeline note refers to', async () => {
    // "the cut at 0:14 is too fast" and "the cut is too fast" are different
    // notes, and only one can be acted on without watching the film again.
    const created = await store.comments.create(
      comment(acme.id, 'prj_acme', author.id, { target: 'render', targetId: 'rnd_1', atSeconds: 14.5 }),
    );
    expect(created.atSeconds).toBe(14.5);
  });

  it('lists a project\'s notes without pulling in another project\'s', async () => {
    await store.comments.create(comment(acme.id, 'prj_a', author.id));
    await store.comments.create(comment(acme.id, 'prj_b', author.id));
    expect(await store.comments.listForProject(acme.id, 'prj_a')).toHaveLength(1);
  });
});
