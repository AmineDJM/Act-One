import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newId, retryDelayMs, type Job, type Organization } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueSlug } from './stores.ts';

function job(organizationId: string, over: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: newId('job'),
    organizationId,
    projectId: null,
    kind: 'render_film',
    state: 'queued',
    payload: {},
    progress: 0,
    statusMessage: '',
    attempts: 0,
    maxAttempts: 3,
    lastError: null, lastErrorCode: null,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    startedAt: null,
    priority: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe.each(storeCases())('job queue ($name)', ({ open, close, clearJobs }) => {
  let store: Store;
  let org: Organization;

  afterEach(async () => {
    await close(store);
  });

  beforeEach(async () => {
    store = await open();
    await clearJobs(store);
    org = await store.organizations.create({
      id: newId('org'),
      name: 'Acme',
      slug: uniqueSlug('acme'),
      planId: 'free',
      stripeCustomerId: null,
      creditBalance: 0,
      maxProjectCostUsd: 120,
      isSuspended: false,
      createdAt: new Date().toISOString(),
    });
  });

  it('claims at most once per job across workers', async () => {
    await store.jobs.enqueue(job(org.id));
    const first = await store.jobs.claim('worker-1');
    const second = await store.jobs.claim('worker-2');

    expect(first).not.toBeNull();
    expect(first?.lockedBy).toBe('worker-1');
    expect(second).toBeNull();
  });

  it('respects priority then age', async () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    await store.jobs.enqueue(job(org.id, { kind: 'render_film', priority: 0, runAfter: older }));
    await store.jobs.enqueue(job(org.id, { kind: 'research_product', priority: 10 }));

    expect((await store.jobs.claim('w'))?.kind).toBe('research_product');
    expect((await store.jobs.claim('w'))?.kind).toBe('render_film');
  });

  it('does not claim jobs scheduled for the future', async () => {
    await store.jobs.enqueue(
      job(org.id, { runAfter: new Date(Date.now() + 60_000).toISOString() }),
    );
    expect(await store.jobs.claim('w')).toBeNull();
  });

  it('filters by kind so a render worker never picks up research', async () => {
    await store.jobs.enqueue(job(org.id, { kind: 'research_product' }));
    expect(await store.jobs.claim('w', ['render_film'])).toBeNull();
    expect((await store.jobs.claim('w', ['research_product']))?.kind).toBe('research_product');
  });

  it('requeues a failure until attempts are exhausted, then fails permanently', async () => {
    const enqueued = await store.jobs.enqueue(job(org.id, { maxAttempts: 2 }));

    await store.jobs.claim('w');
    let failed = await store.jobs.fail(
      enqueued.id,
      'provider timeout',
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(failed.state).toBe('queued');
    expect(failed.lockedBy).toBeNull();

    await store.jobs.update(enqueued.id, { runAfter: new Date().toISOString() });
    await store.jobs.claim('w');
    failed = await store.jobs.fail(
      enqueued.id,
      'provider timeout',
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(failed.attempts).toBe(2);
    expect(failed.state).toBe('failed');
  });

  it('reclaims jobs whose worker died holding the lock', async () => {
    const enqueued = await store.jobs.enqueue(job(org.id));
    const claimed = await store.jobs.claim('doomed-worker');
    expect(claimed?.lockedBy).toBe('doomed-worker');

    // A negative age threshold makes every held lock look expired, which is
    // how we exercise the reaper without sleeping in a test.
    const reaped = await store.jobs.reapStale(-1);
    expect(reaped).toBe(1);
    const reclaimed = await store.jobs.get(org.id, enqueued.id);
    expect(reclaimed?.lockedBy).toBeNull();
    expect(reclaimed?.state).toBe('queued');
  });

  it('scopes job reads by organisation', async () => {
    const other = await store.organizations.create({
      id: newId('org'),
      name: 'Globex',
      slug: uniqueSlug('globex'),
      planId: 'free',
      stripeCustomerId: null,
      creditBalance: 0,
      maxProjectCostUsd: 120,
      isSuspended: false,
      createdAt: new Date().toISOString(),
    });
    const enqueued = await store.jobs.enqueue(job(org.id));
    expect(await store.jobs.get(other.id, enqueued.id)).toBeNull();
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially within a jittered band and respects the cap', () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const delay = retryDelayMs(attempt, 2000, 60_000);
      const base = Math.min(60_000, 2000 * 2 ** (attempt - 1));
      expect(delay).toBeGreaterThanOrEqual(base * 0.8);
      expect(delay).toBeLessThanOrEqual(base * 1.2);
    }
  });
});

describe.each(storeCases())('job timing on $name', ({ open, close, clearJobs }) => {
  let store: Store;
  let organizationId = '';

  beforeEach(async () => {
    store = await open();
    await clearJobs(store);
    const organization = await store.organizations.create({
      id: newId('org'),
      name: 'Timing',
      slug: uniqueSlug('timing'),
      planId: 'free',
      stripeCustomerId: null,
      creditBalance: 0,
      maxProjectCostUsd: 120,
      isSuspended: false,
      createdAt: new Date().toISOString(),
    });
    organizationId = organization.id;
  });

  afterEach(async () => {
    await close(store);
  });

  it('remembers when a job began, even after it is done', async () => {
    const queued = await store.jobs.enqueue(job(organizationId, { kind: 'generate_concepts' }));
    const claimed = await store.jobs.claim('worker-1', ['generate_concepts']);
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.startedAt).not.toBeNull();
    const done = await store.jobs.complete(queued.id, 'completed', 'Done');
    expect(done.lockedAt).toBeNull();
    expect(done.startedAt).toBe(claimed?.startedAt);
  });

  it('calls one finished job an anecdote and three a typical duration', async () => {
    const finished = (msAgoStart: number, msAgoEnd: number) => {
      const end = Date.now() - msAgoEnd;
      return job(organizationId, {
        kind: 'build_storyboard',
        state: 'completed',
        progress: 1,
        startedAt: new Date(end - msAgoStart).toISOString(),
        updatedAt: new Date(end).toISOString(),
        createdAt: new Date(end - msAgoStart - 1000).toISOString(),
      });
    };
    expect(await store.jobs.typicalDurationMs('build_storyboard')).toBeNull();
    await store.jobs.enqueue(finished(90_000, 30_000));
    expect(await store.jobs.typicalDurationMs('build_storyboard')).toBeNull();
    await store.jobs.enqueue(finished(120_000, 20_000));
    await store.jobs.enqueue(finished(600_000, 10_000));
    // The median, so one slow outlier does not become the forecast.
    expect(await store.jobs.typicalDurationMs('build_storyboard')).toBe(120_000);
    expect(await store.jobs.typicalDurationMs('render_film')).toBeNull();
  });
});
