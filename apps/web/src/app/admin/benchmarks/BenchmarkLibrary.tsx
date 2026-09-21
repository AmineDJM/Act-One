'use client';

import { useActionState } from 'react';
import type { BenchmarkFilm, CorpusHealth } from '@act-one/core';
import { deleteBenchmark, reanalyseBenchmark, setBenchmarkEnabled, uploadBenchmark } from './actions.ts';
import styles from '../admin.module.css';

/**
 * What each status means to the operator reading the row.
 *
 * 'partial' and 'failed' are spelled out rather than colour-coded, because the
 * whole reason they exist is that a reference contributing nothing used to be
 * indistinguishable from one that simply never matched a query.
 */
const STATUS_NOTE: Record<string, string> = {
  pending: 'Uploaded. Nothing has been run yet.',
  analysing: 'Being measured and watched now.',
  analysed: 'Both readings present. Fully available to retrieval.',
  partial: 'Usable, but one half is missing or described nothing. Retry may fix it.',
  failed: 'Analysis failed. This film contributes nothing.',
  disabled: 'Kept, analysed, and deliberately out of retrieval.',
};

function Health({ health, confidence }: { health: CorpusHealth; confidence: string }) {
  return (
    <>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Usable</span>
          <span className={styles.metricValue}>{health.usable}</span>
          <span className={styles.metricNote}>of {health.total} uploaded</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Fully analysed</span>
          <span className={styles.metricValue}>{health.analysed}</span>
          <span className={styles.metricNote}>{health.partial} partial</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Moments retrievable</span>
          <span className={styles.metricValue}>{health.mechanisms}</span>
          <span className={styles.metricNote}>described, and timed</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Not contributing</span>
          <span className={styles.metricValue}>{health.failed + health.disabled + health.pending}</span>
          <span className={styles.metricNote}>
            {health.failed} failed · {health.disabled} disabled · {health.pending} waiting
          </span>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 'var(--space-3)' }}>{confidence}</p>
    </>
  );
}

export function BenchmarkLibrary({
  films, health, confidence,
}: { films: BenchmarkFilm[]; health: CorpusHealth; confidence: string }) {
  const [uploaded, upload, uploading] = useActionState(uploadBenchmark, null);
  const [acted, act, acting] = useActionState(reanalyseBenchmark, null);
  const [toggled, toggle] = useActionState(setBenchmarkEnabled, null);
  const [removed, remove] = useActionState(deleteBenchmark, null);
  const problem = [uploaded, acted, toggled, removed].find((r) => r && !r.ok);

  return (
    <>
      <Health health={health} confidence={confidence} />

      {problem ? <p className={styles.notice} role="alert">{problem.message}</p> : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>Add a reference</h2></div>
        <form action={upload} className={styles.formGrid}>
          <label>
            Title
            <input name="title" required placeholder="What this film is, in the words you would use about it" />
          </label>
          <label>
            Film
            <input type="file" name="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" required />
          </label>
          <button className="btn" type="submit" disabled={uploading}>
            {uploading ? 'Analysing…' : 'Upload and analyse'}
          </button>
        </form>
        <p className="muted">
          The original is kept forever and never replaced by its analysis: every reading here is
          re-derivable, and a corpus that cannot be re-analysed is one frozen at the capability of
          the day it was uploaded.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>Corpus</h2></div>
        {films.length === 0 ? (
          <p className={styles.empty}>No reference films yet. Retrieval has nothing to draw on.</p>
        ) : (
          <div className={styles.list}>
            {films.map((film) => (
              <article key={film.id} className={styles.listItem}>
                <div className={styles.entryHead}>
                  <strong>{film.title}</strong>
                  <span className={styles.pill}>{film.status}</span>
                </div>
                <p className="muted">
                  {STATUS_NOTE[film.status]}
                  {film.mechanismCount > 0 ? ` ${film.mechanismCount} described moments.` : ''}
                  {film.durationSeconds > 0 ? ` ${film.durationSeconds.toFixed(0)}s.` : ''}
                  {film.byteSize > 0 ? ` ${(film.byteSize / 1e6).toFixed(0)} MB.` : ''}
                </p>
                {film.note ? <p className={styles.logDetail}>{film.note}</p> : null}
                <div className={styles.providerActions}>
                  <form action={act}>
                    <input type="hidden" name="id" value={film.id} />
                    <button className="btn btn--secondary" type="submit" disabled={acting}>
                      Re-analyse
                    </button>
                  </form>
                  <form action={toggle}>
                    <input type="hidden" name="id" value={film.id} />
                    <input type="hidden" name="enable" value={film.status === 'disabled' ? '1' : '0'} />
                    <button className="btn btn--secondary" type="submit">
                      {film.status === 'disabled' ? 'Return to corpus' : 'Disable'}
                    </button>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="id" value={film.id} />
                    <button className="btn btn--secondary" type="submit">Delete</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
