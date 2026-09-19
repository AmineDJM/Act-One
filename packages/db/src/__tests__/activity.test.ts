import { describe, it, expect } from 'vitest';
import { newId, type JobEvent, type NewOrganization, type Organization, type Project, type ResearchSource, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * Activity and the research trail, against every store: a project's events
 * come back in order and only to their workspace; a rerun's trail replaces
 * the last one rather than piling up.
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

function project(organizationId: string, userId: string): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'), organizationId, createdByUserId: userId, name: 'Launch', websiteUrl: 'https://acme.example/',
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

function event(organizationId: string, projectId: string, jobId: string, at: string, label: string, over: Partial<JobEvent> = {}): JobEvent {
  return { id: newId('jev'), organizationId, projectId, jobId, at, step: 'research', kind: 'page', label, detail: null, status: 'done', index: 0, ...over };
}

function source(organizationId: string, projectId: string, url: string, position = 0): ResearchSource {
  return {
    id: newId('src'), organizationId, projectId, jobId: null, position, url, title: 'A page', domain: 'acme.example', pageType: 'home',
    reason: 'the homepage', visitedAt: new Date().toISOString(), screenshotAssetId: null, excerpt: '', findings: [],
    evidenceCount: 0, statusCode: 200, useful: true,
  };
}

for (const kase of storeCases()) {
  describe(`activity and sources (${kase.name})`, () => {
    it('keeps a project’s activity in order, and to its workspace', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const rival = await store.organizations.create(org('Rival'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        const jobId = newId('job');
        await store.jobEvents.record(event(acme.id, launch.id, jobId, '2026-01-01T00:00:02.000Z', '/pricing', { index: 1 }));
        await store.jobEvents.record(event(acme.id, launch.id, jobId, '2026-01-01T00:00:01.000Z', 'homepage'));
        await store.jobEvents.record(event(acme.id, launch.id, newId('job'), '2026-01-01T00:00:03.000Z', 'reading the brief', { kind: 'step', step: 'strategy', status: 'active', index: null }));

        expect((await store.jobEvents.listForJob(acme.id, jobId)).map((e) => e.label)).toEqual(['homepage', '/pricing']);
        expect((await store.jobEvents.listForProject(acme.id, launch.id)).map((e) => e.label)).toEqual(['homepage', '/pricing', 'reading the brief']);
        expect((await store.jobEvents.listForProject(acme.id, launch.id, '2026-01-01T00:00:02.500Z')).map((e) => e.label)).toEqual(['reading the brief']);
        expect(await store.jobEvents.listForProject(rival.id, launch.id)).toEqual([]);
        expect(await store.jobEvents.listForJob(rival.id, jobId)).toEqual([]);
      } finally {
        await kase.close(store);
      }
    });

    it('replaces the research trail on a rerun and hides it from other workspaces', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const rival = await store.organizations.create(org('Rival'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        await store.researchSources.replaceForProject(acme.id, launch.id, [source(acme.id, launch.id, 'https://acme.example/pricing', 1), source(acme.id, launch.id, 'https://acme.example/', 0)]);
        expect((await store.researchSources.listForProject(acme.id, launch.id)).map((s) => s.url)).toEqual(['https://acme.example/', 'https://acme.example/pricing']);
        await store.researchSources.replaceForProject(acme.id, launch.id, [source(acme.id, launch.id, 'https://acme.example/features')]);
        expect((await store.researchSources.listForProject(acme.id, launch.id)).map((s) => s.url)).toEqual(['https://acme.example/features']);
        expect(await store.researchSources.listForProject(rival.id, launch.id)).toEqual([]);
      } finally {
        await kase.close(store);
      }
    });
  });
}
