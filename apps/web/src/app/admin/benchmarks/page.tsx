import { corpusConfidence, corpusHealth } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { BenchmarkLibrary } from './BenchmarkLibrary.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The reference corpus, for staff.
 *
 * The films Act One is measured against, what analysis each one yielded, and —
 * the part that matters — which of them actually contribute anything. A library
 * that reports "15 films" while four of them failed analysis is lying to the
 * person deciding whether to trust a retrieval.
 */
export default async function BenchmarksPage() {
  const films = await getStore().benchmarkFilms.list();
  const health = corpusHealth(films);

  return (
    <>
      <header className={styles.head}>
        <h1>Benchmark library</h1>
        <p className="lede">
          The reference films Act One is measured against. Each one is stored whole, measured by
          instrument, and watched by a model; both readings are kept apart, because one can say
          what happened at 12.4 seconds and the other can say why it worked, and neither can do
          the other&rsquo;s job.
        </p>
        <p className="lede">
          There is no target size. These are exemplars, not a sample: the corpus is never averaged
          into a style, and a film is only ever retrieved as its own answer to its own problem.
          What grows with the corpus is confidence and diversity, not conformity.
        </p>
      </header>

      <BenchmarkLibrary films={films} health={health} confidence={corpusConfidence(health)} />
    </>
  );
}
