import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Benchmark, freshStages, newId } from '@act-one/core';
import type { PgStore } from '../pg-store.ts';
import type { Store } from '../store.ts';
import { postgresAvailable, storeCases, uniqueSlug } from './stores.ts';

/**
 * The benchmark library, against every store: one row per film, found by
 * its bytes, listed and filtered for a console that may hold hundreds, and
 * changed atomically by a worker while an operator changes it too.
 */
let tick = 0;
function benchmark(over: Partial<Benchmark> = {}): Benchmark {
  tick += 1;
  const at = new Date(Date.UTC(2026, 8, 1, 0, 0, tick)).toISOString();
  const id = newId('bmk');
  return Benchmark.parse({
    id,
    title: `Reference film ${tick}`,
    source: {
      storageKey: `platform/benchmarks/${id}/source.mp4`,
      fileName: `film-${tick}.mp4`,
      bytes: 1024,
      sha256: createHash('sha256').update(`${id}-${tick}`).digest('hex'),
      contentType: 'video/mp4',
      container: 'mp4',
      uploadedByUserId: null,
      uploadedAt: at,
    },
    stages: freshStages(),
    analysis: {},
    createdAt: at,
    updatedAt: at,
    ...over,
  });
}

for (const kase of storeCases()) {
  describe(`the benchmark library (${kase.name})`, () => {
    it('holds each film once, and finds it by id and by its bytes', async () => {
      const store: Store = await kase.open();
      try {
        const film = await store.benchmarks.create(benchmark());
        expect((await store.benchmarks.get(film.id))?.title).toBe(film.title);
        expect((await store.benchmarks.getBySha256(film.source.sha256))?.id).toBe(film.id);
        const again = benchmark();
        again.source.sha256 = film.source.sha256;
        await expect(store.benchmarks.create(again)).rejects.toThrow(/already in the library/);
        expect(await store.benchmarks.get(newId('bmk'))).toBeNull();
        await store.benchmarks.delete(film.id);
        expect(await store.benchmarks.get(film.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('lists newest first, filtered and paged, and counts what it filters', async () => {
      const store: Store = await kase.open();
      try {
        const marker = `batch${newId('bmk').slice(-6)}`;
        const made: Benchmark[] = [];
        for (let i = 0; i < 5; i += 1) {
          made.push(await store.benchmarks.create(benchmark({ title: `${marker} ${i}`, status: i < 2 ? 'ready' : 'uploaded', retrieval: i === 0 ? 'disabled' : 'enabled' })));
        }
        const page = await store.benchmarks.list({ search: marker, limit: 2 });
        expect(page.map((film) => film.title)).toEqual([`${marker} 4`, `${marker} 3`]);
        const next = await store.benchmarks.list({ search: marker, limit: 2, offset: 2 });
        expect(next.map((film) => film.title)).toEqual([`${marker} 2`, `${marker} 1`]);
        expect(await store.benchmarks.count({ search: marker })).toBe(5);
        expect(await store.benchmarks.count({ search: marker, status: 'ready' })).toBe(2);
        expect(await store.benchmarks.count({ search: marker, status: ['ready', 'uploaded'], retrieval: 'enabled' })).toBe(4);
        // A search is matched as text: its wildcards mean nothing.
        expect(await store.benchmarks.count({ search: `${marker}%` })).toBe(0);
        expect((await store.benchmarks.countByStatus())['ready']).toBeGreaterThanOrEqual(2);
        for (const film of made) await store.benchmarks.delete(film.id);
      } finally {
        await kase.close(store);
      }
    });

    it('changes one film atomically, so concurrent changes do not undo each other', async () => {
      const store: Store = await kase.open();
      try {
        const film = await store.benchmarks.create(benchmark());
        await Promise.all([
          store.benchmarks.mutate(film.id, (current) => ({ ...current, stages: { ...current.stages, forensics: { ...current.stages.forensics, status: 'completed' } } })),
          store.benchmarks.mutate(film.id, (current) => ({ ...current, retrieval: 'disabled' })),
          store.benchmarks.mutate(film.id, (current) => ({ ...current, analysis: { ...current.analysis, costUsd: current.analysis.costUsd + 0.5 } })),
          store.benchmarks.mutate(film.id, (current) => ({ ...current, analysis: { ...current.analysis, costUsd: current.analysis.costUsd + 0.25 } })),
        ]);
        const after = (await store.benchmarks.get(film.id))!;
        expect(after.stages.forensics.status).toBe('completed');
        expect(after.retrieval).toBe('disabled');
        expect(after.analysis.costUsd).toBeCloseTo(0.75, 6);
        expect(after.updatedAt > film.updatedAt).toBe(true);

        const renamed = await store.benchmarks.update(film.id, { title: 'A better title' });
        expect(renamed.title).toBe('A better title');
        expect(renamed.stages.forensics.status).toBe('completed');
        await store.benchmarks.delete(film.id);
        await expect(store.benchmarks.mutate(film.id, (current) => current)).rejects.toThrow(/not found/i);
      } finally {
        await kase.close(store);
      }
    });
  });
}

/**
 * The library is the platform's. A connection scoped to a customer's
 * workspace sees none of it and cannot add to it, whatever the query says.
 */
describe.skipIf(!postgresAvailable)('the benchmark library under row-level security (PgStore)', () => {
  it('is invisible and closed to every workspace', async () => {
    const [pg] = storeCases().filter((c) => c.name === 'PgStore');
    const store = (await pg!.open()) as PgStore;
    try {
      const film = await store.benchmarks.create(benchmark());
      const org = await store.organizations.create({
        id: newId('org'),
        name: 'Tenant',
        slug: uniqueSlug('tenant'),
        planId: 'free',
        stripeCustomerId: null,
        creditBalance: 0,
        maxProjectCostUsd: 120,
        isSuspended: false,
        createdAt: new Date().toISOString(),
      });
      const seen = await store.asTenant(org.id, (c) => c.query('SELECT id FROM benchmarks'));
      expect(seen.rows).toEqual([]);
      await expect(
        store.asTenant(org.id, (c) =>
          c.query(`INSERT INTO benchmarks (id, sha256, title, data) VALUES ($1, $2, 'planted', '{}')`, [newId('bmk'), 'b'.repeat(64)]),
        ),
      ).rejects.toThrow(/row-level security/i);
      const unscoped = await store.raw(async (c) => {
        await c.query("SELECT set_config('app.platform_access', 'off', true)");
        return c.query('SELECT id FROM benchmarks');
      });
      expect(unscoped.rows).toEqual([]);
      await store.benchmarks.delete(film.id);
    } finally {
      await store.close();
    }
  });
});
