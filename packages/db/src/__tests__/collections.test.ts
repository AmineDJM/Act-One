import { describe, it, expect } from 'vitest';
import { newId, type CollectionEntry, type Organization, type Project, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The gallery's records, against every store: one address per film, an
 * entry found by its project and by its address, the public list in
 * editorial order, and a patch that keeps the columns and the document in
 * step.
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

function project(organizationId: string, userId: string): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'), organizationId, createdByUserId: userId, name: 'Launch', websiteUrl: 'https://acme.example/',
    supplementalUrls: [], brandId: null, productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
    latestRenderId: null, stage: 'film_ready',
    brief: {
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null, keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
      voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null, tone: null,
      voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null, createdAt: now, updatedAt: now,
  };
}

let tick = 0;
function entry(organizationId: string, projectId: string, userId: string, over: Partial<CollectionEntry> = {}): CollectionEntry {
  tick += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  return {
    id: newId('col'), slug: `acme-${newId('col').slice(-6).toLowerCase()}`, previousSlugs: [], organizationId, projectId, renderId: newId('rnd'), masterAssetId: newId('ast'),
    posterAssetId: null, stillAssetIds: [], company: 'Acme', productUrl: 'https://acme.example/', title: 'One run', tagline: '', concept: '',
    category: 'saas', launchDate: null, durationSeconds: 19, status: 'pending', featured: false, launchOfTheWeek: false, original: false, position: 0,
    consent: { grantedByUserId: userId, grantedAt: at, statement: 'I consent.', byStaff: false },
    submittedByUserId: userId, submittedAt: at, decidedByUserId: null, decidedAt: null, publishedAt: null, editorialNote: '', seoTitle: '', seoDescription: '',
    createdAt: at, updatedAt: at, ...over,
  };
}

for (const kase of storeCases()) {
  describe(`collections (${kase.name})`, () => {
    it('keeps one address per film and finds an entry by project and by address', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        const first = await store.collections.create(entry(acme.id, launch.id, member.id));
        await expect(store.collections.create(entry(acme.id, launch.id, member.id, { slug: first.slug }))).rejects.toThrow();
        const second = await store.collections.create(entry(acme.id, launch.id, member.id, { status: 'withdrawn' }));
        expect((await store.collections.getForProject(acme.id, launch.id))?.id).toBe(second.id);
        expect((await store.collections.getBySlug(first.slug))?.id).toBe(first.id);
        expect(await store.collections.getBySlug('nobody')).toBeNull();

        // A film that moved keeps answering at the address it used to have.
        const after = `moved-${newId('col').slice(-8).toLowerCase()}`;
        await store.collections.update(first.id, { slug: after, previousSlugs: [first.slug] });
        expect(await store.collections.getBySlug(first.slug)).toBeNull();
        expect((await store.collections.getByFormerSlug(first.slug))?.id).toBe(first.id);
        expect(await store.collections.getByFormerSlug(after)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('lists by status in editorial order and keeps columns and document in step', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        const late = await store.collections.create(entry(acme.id, launch.id, member.id, { status: 'published', position: 5, publishedAt: '2026-03-01T00:00:00.000Z' }));
        const early = await store.collections.create(entry(acme.id, launch.id, member.id, { status: 'published', position: 1, publishedAt: '2026-01-01T00:00:00.000Z' }));
        const pending = await store.collections.create(entry(acme.id, launch.id, member.id));
        // The database outlives the test process, so every list is read through
        // this organisation's entries only.
        const mine = (entries: CollectionEntry[]) => entries.filter((item) => item.organizationId === acme.id).map((item) => item.id);
        expect(mine(await store.collections.list({ status: 'published' }))).toEqual([early.id, late.id]);
        expect(mine(await store.collections.list({ status: 'pending' }))).toEqual([pending.id]);

        // An address that no earlier run of this suite left in the database.
        const address = `acme-featured-${newId('col').slice(-6).toLowerCase()}`;
        const featured = await store.collections.update(late.id, { featured: true, position: 0, category: 'ai', slug: address });
        expect(featured).toMatchObject({ featured: true, position: 0, category: 'ai', slug: address });
        expect(mine(await store.collections.list({ featured: true }))).toEqual([late.id]);
        expect(mine(await store.collections.list({ category: 'ai' }))).toEqual([late.id]);
        expect((await store.collections.getBySlug(address))?.id).toBe(late.id);
        await expect(store.collections.update(early.id, { slug: address })).rejects.toThrow();
        const counts = await store.collections.countByStatus();
        expect(counts['published']).toBeGreaterThanOrEqual(2);
      } finally {
        await kase.close(store);
      }
    });
  });
}
