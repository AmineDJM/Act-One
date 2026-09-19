import { describe, it, expect } from 'vitest';
import { BrandSystem, newId, type NewOrganization, type Organization, type Project, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The brand belongs to a project, against every store: a project finds its
 * own DNA and nobody else's, a stored brand comes back whole with every
 * later field defaulted, and a workspace boundary is a wall.
 */
function org(name: string): NewOrganization {
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
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null, keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
      voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null, tone: null,
      voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null, createdAt: now, updatedAt: now,
  };
}

let tick = 0;
function brand(organizationId: string, projectId: string | null, over: Partial<BrandSystem> = {}): BrandSystem {
  tick += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  return BrandSystem.parse({
    id: newId('brd'), organizationId, projectId, name: 'Acme', primaryColor: '#2f6fed', secondaryColor: '#0a0a0c',
    sources: ['https://acme.example/'], createdAt: at, updatedAt: at, ...over,
  });
}

for (const kase of storeCases()) {
  describe(`the brand of a project (${kase.name})`, () => {
    it('finds a project’s own DNA, the newest when it has several, and none across a wall', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const rival = await store.organizations.create(org('Rival'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id, 'Launch'));
        const relaunch = await store.projects.create(project(acme.id, member.id, 'Relaunch'));

        const first = await store.brands.create(brand(acme.id, launch.id));
        const second = await store.brands.create(brand(acme.id, launch.id, { primaryColor: '#ff5f5f' }));
        await store.brands.create(brand(acme.id, null));

        expect((await store.brands.getForProject(acme.id, launch.id))?.id).toBe(second.id);
        expect(await store.brands.getForProject(acme.id, relaunch.id)).toBeNull();
        expect(await store.brands.getForProject(rival.id, launch.id)).toBeNull();
        expect(await store.brands.get(rival.id, first.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('keeps the newer fields, and a patch to them', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id, 'Launch'));
        const created = await store.brands.create(
          brand(acme.id, launch.id, {
            communication: { language: 'en', vocabulary: ['reconcile'], positioning: '', claims: [], naming: 'Acme', tagline: 'Close the books.', wordsToAvoid: ['cheap'] },
            iconography: 'outline',
            signals: [{ id: newId('bsg'), field: 'primaryColor', label: 'Primary colour', current: '#2f6fed', proposed: '#ff5f5f', reason: 'x', sourceUrl: null, projectId: launch.id, foundAt: new Date().toISOString(), status: 'pending', decidedAt: null }],
          }),
        );
        const read = await store.brands.get(acme.id, created.id);
        expect(read?.communication.tagline).toBe('Close the books.');
        expect(read?.iconography).toBe('outline');
        expect(read?.signals).toHaveLength(1);

        const patched = await store.brands.update(acme.id, created.id, { overrides: ['colors'], confirmedByUser: true, confirmedAt: '2026-02-01T00:00:00.000Z' });
        expect(patched.overrides).toEqual(['colors']);
        expect(patched.confirmedAt).toBe('2026-02-01T00:00:00.000Z');
        expect((await store.brands.list(acme.id)).find((candidate) => candidate.id === created.id)?.confirmedByUser).toBe(true);
      } finally {
        await kase.close(store);
      }
    });
  });
}
