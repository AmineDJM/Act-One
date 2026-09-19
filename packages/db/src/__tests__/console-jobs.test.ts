import { describe, it, expect } from 'vitest';
import { newId, type Job, type Organization, type Project, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The console's view of the queue, against every store: recent jobs across
 * the platform, narrowed by state, kind, workspace and project; any job by
 * id; and the log narrowed to one job.
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
function job(organizationId: string, projectId: string, kind: Job['kind'], state: Job['state']): Job {
  tick += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  return {
    id: newId('job'), organizationId, projectId, kind, state, payload: {}, progress: 0, statusMessage: '', attempts: 0, maxAttempts: 3,
    lastError: null, lastErrorCode: null, runAfter: at, lockedBy: null, lockedAt: null, startedAt: null, priority: 0, createdAt: at, updatedAt: at,
  };
}

for (const kase of storeCases()) {
  describe(`the console’s queue (${kase.name})`, () => {
    it('lists recent jobs across workspaces, newest first, narrowed as asked', async () => {
      const store: Store = await kase.open();
      try {
        await kase.clearJobs(store);
        const acme = await store.organizations.create(org('Acme'));
        const rival = await store.organizations.create(org('Rival'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        const theirs = await store.projects.create(project(rival.id, member.id));

        const research = await store.jobs.enqueue(job(acme.id, launch.id, 'research_product', 'completed'));
        const concepts = await store.jobs.enqueue(job(acme.id, launch.id, 'generate_concepts', 'failed'));
        const other = await store.jobs.enqueue(job(rival.id, theirs.id, 'research_product', 'queued'));

        const all = await store.jobs.listRecent();
        expect(all.map((entry) => entry.id)).toEqual([other.id, concepts.id, research.id]);
        expect((await store.jobs.listRecent({ state: 'failed' })).map((entry) => entry.id)).toEqual([concepts.id]);
        expect((await store.jobs.listRecent({ kind: 'research_product' })).map((entry) => entry.id)).toEqual([other.id, research.id]);
        expect((await store.jobs.listRecent({ organizationId: acme.id })).map((entry) => entry.id)).toEqual([concepts.id, research.id]);
        expect((await store.jobs.listRecent({ projectId: theirs.id })).map((entry) => entry.id)).toEqual([other.id]);
        expect((await store.jobs.listRecent({ since: concepts.createdAt })).map((entry) => entry.id)).toEqual([other.id, concepts.id]);
        expect((await store.jobs.listRecent({ limit: 1 })).map((entry) => entry.id)).toEqual([other.id]);

        expect((await store.jobs.getAny(other.id))?.organizationId).toBe(rival.id);
        expect(await store.jobs.getAny('job_missing')).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('narrows the log to one job', async () => {
      const store: Store = await kase.open();
      try {
        const acme = await store.organizations.create(org('Acme'));
        const member = await store.users.create(user('lead@acme.com'));
        const launch = await store.projects.create(project(acme.id, member.id));
        const one = await store.jobs.enqueue(job(acme.id, launch.id, 'research_product', 'failed'));
        const two = await store.jobs.enqueue(job(acme.id, launch.id, 'generate_concepts', 'completed'));
        await store.log.record({ level: 'error', source: 'worker', event: 'research.failed', message: 'x', organizationId: acme.id, projectId: launch.id, jobId: one.id, actorUserId: null, durationMs: null, detail: {} });
        await store.log.record({ level: 'info', source: 'worker', event: 'concepts.done', message: 'y', organizationId: acme.id, projectId: launch.id, jobId: two.id, actorUserId: null, durationMs: null, detail: {} });
        const entries = await store.log.list({ jobId: one.id });
        expect(entries.map((entry) => entry.event)).toEqual(['research.failed']);
      } finally {
        await kase.close(store);
      }
    });
  });
}
