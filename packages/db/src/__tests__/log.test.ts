import { describe, it, expect, beforeEach } from 'vitest';
import { matchesLogQuery, redactDetail, redactMessage, type OperationalEvent } from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';

function event(over: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    id: 'evt_1',
    at: '2026-01-01T00:00:00.000Z',
    level: 'info',
    source: 'worker',
    event: 'job.succeeded',
    message: 'rendered',
    organizationId: null,
    projectId: null,
    jobId: null,
    actorUserId: null,
    durationMs: null,
    detail: {},
    ...over,
  };
}

describe('log redaction', () => {
  it('drops the value of anything named like a credential', () => {
    const clean = redactDetail({ apiKey: 'sk-live-abcdef', Authorization: 'Bearer x', model: 'gpt-4.1' });
    expect(clean['apiKey']).toBe('[redacted]');
    expect(clean['Authorization']).toBe('[redacted]');
    expect(clean['model']).toBe('gpt-4.1');
  });

  it('finds a key that arrived inside a message instead of its own field', () => {
    // Provider errors quote the failing request, and that request was
    // authenticated. A log an operator can read is a log an operator can leak.
    const message = redactMessage('POST failed with sk-proj-A1b2C3d4E5f6G7h8 in header');
    expect(message).not.toContain('sk-proj-A1b2C3d4E5f6G7h8');
    expect(message).toContain('[redacted]');
  });

  it('reaches keys nested inside detail objects and arrays', () => {
    const clean = redactDetail({ request: { headers: { authorization: 'Bearer secret' } }, tries: [{ token: 'abc' }] });
    const request = clean['request'] as Record<string, Record<string, unknown>>;
    expect(request['headers']?.['authorization']).toBe('[redacted]');
    expect((clean['tries'] as Record<string, unknown>[])[0]?.['token']).toBe('[redacted]');
  });

  it('leaves ordinary text alone', () => {
    expect(redactMessage('We could not read anything at https://linear.app/')).toBe(
      'We could not read anything at https://linear.app/',
    );
  });
});

describe('matchesLogQuery', () => {
  it('treats minLevel as "this severity or worse"', () => {
    expect(matchesLogQuery(event({ level: 'error' }), { minLevel: 'warn' })).toBe(true);
    expect(matchesLogQuery(event({ level: 'warn' }), { minLevel: 'warn' })).toBe(true);
    expect(matchesLogQuery(event({ level: 'info' }), { minLevel: 'warn' })).toBe(false);
  });

  it('searches the event name as well as the message', () => {
    expect(matchesLogQuery(event({ event: 'provider.unhealthy' }), { search: 'unhealthy' })).toBe(true);
    expect(matchesLogQuery(event({ message: 'browser would not launch' }), { search: 'browser' })).toBe(true);
    expect(matchesLogQuery(event(), { search: 'nothing like this' })).toBe(false);
  });
});

describe('operational log', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it('redacts on the way in, not on the way out', async () => {
    // Storing the secret and hiding it in the view would still leave it in the
    // database and in any backup taken afterwards.
    const stored = await store.log.record({
      level: 'error',
      source: 'provider',
      event: 'provider.failed',
      message: 'auth failed for sk-live-9Z8y7X6w5V4u3T2s',
      organizationId: null,
      projectId: null,
      jobId: null,
      actorUserId: null,
      durationMs: null,
      detail: { apiKey: 'sk-live-9Z8y7X6w5V4u3T2s' },
    });

    expect(stored.message).not.toContain('sk-live-9Z8y7X6w5V4u3T2s');
    expect(stored.detail['apiKey']).toBe('[redacted]');
  });

  it('returns newest first', async () => {
    for (const [id, at] of [['a', '2026-01-01T00:00:00.000Z'], ['b', '2026-01-03T00:00:00.000Z'], ['c', '2026-01-02T00:00:00.000Z']]) {
      await store.log.record({ ...event({ id, at }), id, at });
    }
    const rows = await store.log.list();
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('counts by level and ranks the events happening most often', async () => {
    const since = '2026-01-01T00:00:00.000Z';
    for (let i = 0; i < 3; i += 1) {
      await store.log.record({ ...event({ id: `e${i}`, level: 'error', event: 'job.failed' }), id: `e${i}` });
    }
    await store.log.record({ ...event({ id: 'w1', level: 'warn', event: 'provider.slow' }), id: 'w1' });

    const counts = await store.log.levelCounts(since);
    expect(counts.error).toBe(3);
    expect(counts.warn).toBe(1);

    const top = await store.log.topEvents(since);
    expect(top[0]).toMatchObject({ event: 'job.failed', count: 3, level: 'error' });
  });

  it('never throws from recordSafely, whatever the store does', () => {
    const broken = new MemoryStore();
    // Simulate the database being the thing that is unwell.
    Object.defineProperty(broken, 'tables', {
      get() {
        throw new Error('connection lost');
      },
    });
    expect(() => broken.log.recordSafely(event())).not.toThrow();
  });

  it('prunes by age and reports how many rows went', async () => {
    await store.log.record({ ...event({ id: 'old', at: '2025-01-01T00:00:00.000Z' }), id: 'old', at: '2025-01-01T00:00:00.000Z' });
    await store.log.record({ ...event({ id: 'new', at: '2026-06-01T00:00:00.000Z' }), id: 'new', at: '2026-06-01T00:00:00.000Z' });

    expect(await store.log.prune('2026-01-01T00:00:00.000Z')).toBe(1);
    expect((await store.log.list()).map((r) => r.id)).toEqual(['new']);
  });
});
