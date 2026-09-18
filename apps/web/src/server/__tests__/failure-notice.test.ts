import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId, type Job, type JobKind, type JobState } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { createProject, loadProjectView } from '../projects.ts';

/**
 * What the production page says when things do not go to plan.
 *
 * Three states wear the word "error" and only one of them is one. This reads
 * the notice off a real view, through the real queue, because the rule that
 * matters — never call a production broken while it is quietly being remade —
 * is about what the jobs say, not about what a stage field says.
 */
let store: MemoryStore;

async function person(): Promise<Session> {
  resetRequest();
  request().headers.set('x-forwarded-for', `198.51.100.${Math.floor(Math.random() * 200) + 1}`);
  const session = await signUp({ email: `ada-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Ada' });
  await store.organizations.update(session.organizationId, { planId: 'studio' });
  return session;
}

async function job(
  session: Session,
  projectId: string,
  kind: JobKind,
  over: Partial<Job> = {},
): Promise<Job> {
  const now = new Date().toISOString();
  return store.jobs.enqueue({
    id: newId('job'),
    organizationId: session.organizationId,
    projectId,
    kind,
    state: 'queued' as JobState,
    payload: {},
    progress: 0,
    statusMessage: '',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    lastErrorCode: null,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    startedAt: null,
    priority: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  });
}

beforeAll(async () => {
  process.env.ACT_ONE_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), 'act-one-failure-'));
});

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('the production notice', () => {
  it('says nothing while a production is going to plan', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    expect((await loadProjectView(session, project.id)).notice).toBeNull();
  });

  it('calls a scheduled retry a shot being rebuilt, not a failure', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    // Exactly what the runner leaves behind: queued again, an attempt spent,
    // an error recorded, and a time in the future to try it.
    await job(session, project.id, 'render_film', {
      state: 'queued',
      attempts: 1,
      lastError: 'ECONNRESET',
      lastErrorCode: 'timeout',
      runAfter: new Date(Date.now() + 60_000).toISOString(),
    });

    const notice = (await loadProjectView(session, project.id)).notice;
    expect(notice).toMatchObject({ kind: 'rebuilding', tone: 'working' });
    expect(notice?.action).toBeNull();
  });

  it('calls a rejected shot refining, while the job is still running', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    const running = await job(session, project.id, 'render_film', { state: 'rendering_motion', attempts: 1 });
    await store.jobEvents.record({
      id: newId('jev'),
      organizationId: session.organizationId,
      projectId: project.id,
      jobId: running.id,
      at: new Date().toISOString(),
      step: 'motion',
      kind: 'refine',
      label: 'refining 2 shots',
      detail: null,
      status: 'active',
      index: null,
    });

    expect((await loadProjectView(session, project.id)).notice).toMatchObject({
      kind: 'refining',
      tone: 'working',
      title: 'Refining this shot',
    });
  });

  it('stops calling it refining once the shots are done', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    const running = await job(session, project.id, 'render_film', { state: 'rendering_motion', attempts: 1 });
    const event = (status: 'active' | 'done', at: string) => ({
      id: newId('jev'),
      organizationId: session.organizationId,
      projectId: project.id,
      jobId: running.id,
      at,
      step: 'motion' as const,
      kind: 'refine' as const,
      label: 'refining',
      detail: null,
      status,
      index: null,
    });
    await store.jobEvents.record(event('active', '2026-01-01T00:00:00.000Z'));
    await store.jobEvents.record(event('done', '2026-01-01T00:05:00.000Z'));

    expect((await loadProjectView(session, project.id)).notice).toBeNull();
  });

  it('names a stopped production by the phase it interrupted, and keeps our machinery out of it', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    await job(session, project.id, 'research_product', {
      state: 'failed',
      attempts: 3,
      lastError: 'OpenAI returned 429',
      lastErrorCode: 'upstream_error',
    });
    await store.projects.setStage(session.organizationId, project.id, 'failed');

    const notice = (await loadProjectView(session, project.id)).notice;
    // The provider was the problem, so the production is paused, not broken.
    expect(notice).toMatchObject({ kind: 'production_paused' });
    const text = `${notice?.title} ${notice?.body} ${notice?.detail ?? ''}`;
    expect(text).not.toMatch(/openai|429|econn/i);
  });

  it('offers the way on that matches what stopped', async () => {
    const session = await person();
    const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
    await job(session, project.id, 'research_product', {
      state: 'failed',
      attempts: 3,
      lastError: 'We could not read anything at that address.',
      lastErrorCode: 'validation_failed',
    });
    await store.projects.setStage(session.organizationId, project.id, 'failed');

    const notice = (await loadProjectView(session, project.id)).notice;
    expect(notice).toMatchObject({ kind: 'discovery_paused', title: 'Discovery paused' });
    expect(notice?.action).toEqual({ action: 'retry', label: 'Continue discovery' });
    // The one sentence written for the customer survives.
    expect(notice?.detail).toBe('We could not read anything at that address.');
  });
});
