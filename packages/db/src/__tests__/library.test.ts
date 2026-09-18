import { describe, it, expect } from 'vitest';
import { newId, type AssetInput, type Organization, type Project, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The library, against every store: one file, any number of projects; a
 * project sees what is attached to it and what is shared with all; the
 * search reads what the classifier wrote; a version knows its original;
 * and none of it crosses a workspace boundary.
 */
function org(name: string): Organization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(email: string): User {
  const [local = 'someone', domain = 'example.com'] = email.split('@');
  return { id: newId('usr'), email: uniqueEmail(local, domain), name: local, avatarUrl: null, isSuperAdmin: false, createdAt: new Date().toISOString() };
}

function project(organizationId: string, userId: string, name: string): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'), organizationId, createdByUserId: userId, name, websiteUrl: `https://${name.toLowerCase()}.example/`,
    supplementalUrls: [], brandId: null, productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
    latestRenderId: null, stage: 'created',
    brief: {
      targetAudience: null, goal: null, keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
      voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null, tone: null,
      voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null, createdAt: now, updatedAt: now,
  };
}

let tick = 0;
function upload(organizationId: string, name: string, over: Partial<AssetInput> = {}): AssetInput {
  const id = newId('ast');
  tick += 1;
  return {
    id, organizationId, kind: 'user_upload', origin: 'uploaded', rights: 'customer_owned',
    storageKey: `org/${organizationId}/library/${id}.png`, contentType: 'image/png', bytes: 2048,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString(),
    library: true, name, source: 'upload', ...over,
  };
}

for (const kase of storeCases()) {
  describe(`the library (${kase.name})`, () => {
    async function open() {
      const store: Store = await kase.open();
      const acme = await store.organizations.create(org('Acme'));
      const rival = await store.organizations.create(org('Rival'));
      const member = await store.users.create(user('lead@acme.com'));
      const launch = await store.projects.create(project(acme.id, member.id, 'Launch'));
      const relaunch = await store.projects.create(project(acme.id, member.id, 'Relaunch'));
      const theirs = await store.projects.create(project(rival.id, member.id, 'Theirs'));
      return { store, acme, rival, member, launch, relaunch, theirs };
    }

    it('fills in the library fields a caller leaves out', async () => {
      const { store, acme } = await open();
      try {
        const created = await store.assets.create(upload(acme.id, 'Founder at desk'));
        expect(created.category).toBe('other');
        expect(created.categorySource).toBe('none');
        expect(created.tags).toEqual([]);
        expect(created.favorite).toBe(false);
        expect(created.approved).toBe(false);
        expect(created.parentAssetId).toBeNull();
        expect(created.projectId).toBeNull();
        const read = await store.assets.get(acme.id, created.id);
        expect(read).toEqual(created);
      } finally {
        await kase.close(store);
      }
    });

    it('shares an asset with every project until it is attached to some', async () => {
      const { store, acme, launch, relaunch } = await open();
      try {
        const shared = await store.assets.create(upload(acme.id, 'Wordmark'));
        const only = await store.assets.create(upload(acme.id, 'Launch hero'));
        await store.assets.setProjects(acme.id, only.id, [launch.id]);

        const forLaunch = await store.assets.listLibraryForProject(acme.id, launch.id);
        const forRelaunch = await store.assets.listLibraryForProject(acme.id, relaunch.id);
        expect(forLaunch.map((asset) => asset.name)).toEqual(['Launch hero', 'Wordmark']);
        expect(forRelaunch.map((asset) => asset.name)).toEqual(['Wordmark']);

        // Attaching adds; setting replaces; setting nothing shares again.
        await store.assets.attachToProjects(acme.id, only.id, [relaunch.id, relaunch.id]);
        expect((await store.assets.listProjectLinks(acme.id, [only.id])).map((link) => link.projectId).sort()).toEqual(
          [launch.id, relaunch.id].sort(),
        );
        await store.assets.setProjects(acme.id, only.id, [relaunch.id]);
        expect((await store.assets.listLibraryForProject(acme.id, launch.id)).map((asset) => asset.name)).toEqual(['Wordmark']);
        await store.assets.setProjects(acme.id, only.id, []);
        expect((await store.assets.listLibraryForProject(acme.id, launch.id)).map((asset) => asset.name)).toEqual(['Launch hero', 'Wordmark']);
      } finally {
        await kase.close(store);
      }
    });

    it('searches what the classifier wrote, and narrows by category, source and flags', async () => {
      const { store, acme } = await open();
      try {
        await store.assets.create(upload(acme.id, 'IMG_2041', { category: 'founder', categorySource: 'inferred', description: 'A woman at a standing desk in a bright office', tags: ['portrait', 'office'] }));
        await store.assets.create(upload(acme.id, 'pricing', { category: 'screenshot', source: 'browser_research', sourceUrl: 'https://acme.example/pricing', approved: true }));
        await store.assets.create(upload(acme.id, 'logo', { category: 'logo', favorite: true }));
        // Not in the library: a poster frame the pipeline made.
        await store.assets.create(upload(acme.id, 'poster', { library: false, kind: 'poster_frame', origin: 'rendered' }));

        const names = async (filter: Parameters<typeof store.assets.listLibrary>[1]) =>
          (await store.assets.listLibrary(acme.id, filter)).map((asset) => asset.name);

        expect(await names({})).toEqual(['logo', 'pricing', 'IMG_2041']);
        expect(await names({ query: 'standing desk' })).toEqual(['IMG_2041']);
        expect(await names({ query: 'PORTRAIT' })).toEqual(['IMG_2041']);
        expect(await names({ query: 'acme.example/pricing' })).toEqual(['pricing']);
        expect(await names({ category: 'logo' })).toEqual(['logo']);
        expect(await names({ source: 'browser_research' })).toEqual(['pricing']);
        expect(await names({ favorite: true })).toEqual(['logo']);
        expect(await names({ approved: true })).toEqual(['pricing']);
        expect(await names({ query: '%' })).toEqual([]);
      } finally {
        await kase.close(store);
      }
    });

    it('keeps a correction, and a version points at its original', async () => {
      const { store, acme, member } = await open();
      try {
        const original = await store.assets.create(upload(acme.id, 'hero', { uploadedByUserId: member.id }));
        const corrected = await store.assets.update(acme.id, original.id, { category: 'product', categorySource: 'user', tags: ['hero', 'v1'] });
        expect(corrected.category).toBe('product');
        expect(corrected.categorySource).toBe('user');
        expect(corrected.tags).toEqual(['hero', 'v1']);

        const version = await store.assets.create(upload(acme.id, 'hero v2', { parentAssetId: original.id, source: 'edited' }));
        expect((await store.assets.listVersions(acme.id, original.id)).map((asset) => asset.id)).toEqual([version.id]);

        // Deleting the original leaves the version standing, on its own.
        await store.assets.delete(acme.id, original.id);
        expect(await store.assets.get(acme.id, original.id)).toBeNull();
        expect((await store.assets.get(acme.id, version.id))?.parentAssetId).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('never crosses a workspace boundary', async () => {
      const { store, acme, rival, launch, theirs } = await open();
      try {
        const ours = await store.assets.create(upload(acme.id, 'ours'));
        expect(await store.assets.listLibrary(rival.id)).toEqual([]);
        await expect(store.assets.setProjects(rival.id, ours.id, [theirs.id])).rejects.toThrow();
        await expect(store.assets.setProjects(acme.id, ours.id, [theirs.id])).rejects.toThrow();
        await expect(store.assets.attachToProjects(rival.id, ours.id, [theirs.id])).rejects.toThrow();
        await store.assets.setProjects(acme.id, ours.id, [launch.id]);
        // A refused list changes nothing.
        await expect(store.assets.setProjects(acme.id, ours.id, [launch.id, theirs.id])).rejects.toThrow();
        expect((await store.assets.listProjectLinks(acme.id, [ours.id])).map((link) => link.projectId)).toEqual([launch.id]);
        expect(await store.assets.listProjectLinks(rival.id, [ours.id])).toEqual([]);
        expect(await store.assets.listLibraryForProject(rival.id, theirs.id)).toEqual([]);
        expect(await store.assets.listVersions(rival.id, ours.id)).toEqual([]);
      } finally {
        await kase.close(store);
      }
    });
  });
}
