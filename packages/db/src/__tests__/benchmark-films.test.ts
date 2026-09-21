import { describe, expect, it } from 'vitest';
import { BenchmarkFilm, corpusHealth, corpusConfidence } from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';

const film = (id: string, patch: Partial<BenchmarkFilm> = {}) => BenchmarkFilm.parse({
  id, title: id, storageKey: `benchmarks/${id}.mp4`,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  ...patch,
});

describe('the benchmark corpus', () => {
  it('refuses the same file twice, because re-analysing it teaches nothing', async () => {
    const store = new MemoryStore();
    await store.benchmarkFilms.create(film('bmf_1'));
    await expect(store.benchmarkFilms.create(film('bmf_2', { storageKey: 'benchmarks/bmf_1.mp4' })))
      .rejects.toThrow(/already in the corpus/);
  });

  /*
   * The corpus must never quietly offer a failed or disabled film as taste
   * calibration. `list` shows everything because the console's job is honesty;
   * `usable` is the narrower set retrieval draws on, and the split is the
   * whole point.
   */
  it('keeps failed and disabled films out of retrieval while still listing them', async () => {
    const store = new MemoryStore();
    await store.benchmarkFilms.create(film('bmf_ok', { status: 'analysed', mechanismCount: 20 }));
    await store.benchmarkFilms.create(film('bmf_thin', { status: 'partial', mechanismCount: 3 }));
    await store.benchmarkFilms.create(film('bmf_bad', { status: 'failed' }));
    await store.benchmarkFilms.create(film('bmf_off', { status: 'disabled', mechanismCount: 40 }));

    expect(await store.benchmarkFilms.list()).toHaveLength(4);
    expect((await store.benchmarkFilms.usable()).map((f) => f.id).sort()).toEqual(['bmf_ok', 'bmf_thin']);
  });

  it('reports usable separately from total, so the corpus cannot overstate itself', async () => {
    const health = corpusHealth([
      film('a', { status: 'analysed', mechanismCount: 20 }),
      film('b', { status: 'partial', mechanismCount: 0 }),
      film('c', { status: 'failed' }),
      film('d', { status: 'disabled', mechanismCount: 9 }),
    ]);
    expect(health.total).toBe(4);
    expect(health.usable).toBe(2);
    // The disabled film's 9 moments are not on offer.
    expect(health.mechanisms).toBe(20);
  });

  /*
   * The corpus works at any size and says how much its answers are worth. This
   * is the guard against the one failure that would make more references make
   * films WORSE: treating a handful of exemplars as a sample to generalise.
   */
  it('states less confidence with a small corpus, and never promises a style', async () => {
    const three = corpusConfidence(corpusHealth([film('a', { status: 'analysed' }), film('b', { status: 'analysed' }), film('c', { status: 'analysed' })]));
    expect(three).toMatch(/coincidence|ONE film/);

    const many = corpusConfidence(corpusHealth(
      Array.from({ length: 20 }, (_, i) => film(`f${i}`, { status: 'analysed' })),
    ));
    expect(many).toContain('never be averaged');

    expect(corpusConfidence(corpusHealth([]))).toContain('unsupported');
  });
});
