'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { AudioEdition } from '@act-one/core';
import { produceAudioAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

/**
 * The audio version: the film's argument, read as one piece.
 *
 * A deliverable of its own — for the podcast feed, the LinkedIn audio post,
 * the newsletter — made from the storyboard the customer approved and read
 * by their brand voice. It never touches the film.
 */
export function AudioEditionPanel({
  projectId,
  edition,
  progress,
  may,
  planName,
  canProduce,
  hasStoryboard,
}: {
  projectId: string;
  edition: AudioEdition | null;
  /** The worker's progress on the edition being read, 0..1; null when none is. */
  progress: number | null;
  may: boolean;
  planName: string;
  canProduce: boolean;
  hasStoryboard: boolean;
}) {
  const [state, produce, pending] = useActionState<FormState, FormData>(produceAudioAction, { error: null });
  const working = edition?.status === 'queued' || edition?.status === 'running';

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Audio version</h3>
        {edition?.status === 'completed' ? (
          <span className="badge badge--ok">{Math.round(edition.durationSeconds)}s</span>
        ) : working ? (
          <span className="badge">Reading…</span>
        ) : null}
      </div>

      {!may ? (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          The film, read aloud as one piece for feeds and posts, comes with the plans above {planName}.{' '}
          <Link href="/app/billing">See plans</Link>.
        </p>
      ) : null}

      {edition?.status === 'completed' && edition.assetId ? (
        <>
          <audio controls preload="metadata" src={`/api/assets/${edition.assetId}`} style={{ width: '100%' }} />
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <a className="btn" href={`/api/assets/${edition.assetId}?download`} download>
              Download the audio
            </a>
            <span className="hint">
              {edition.title || 'Audio version'} · {Math.round(edition.durationSeconds)}s
              {edition.integratedLufs !== null ? ` · mastered to ${edition.integratedLufs.toFixed(0)} LUFS` : ''}
            </span>
          </div>
          {edition.script.length > 0 ? (
            <details>
              <summary className="hint" style={{ cursor: 'pointer' }}>
                The script, as read
              </summary>
              <div className="stack" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: '0.9rem' }}>
                {edition.script.map((paragraph, index) => (
                  <p key={index} className="secondary">
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          {edition.findings.length > 0 ? (
            <ul className={styles.claims}>
              {edition.findings.slice(0, 4).map((finding, index) => (
                <li key={index}>
                  <span className="badge badge--warn">{finding.severity}</span>
                  {finding.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {working ? (
        <div className={styles.progress} aria-live="polite">
          <div className={styles.progressBar} style={{ width: `${Math.round((progress ?? 0.05) * 100)}%` }} />
        </div>
      ) : null}

      {edition?.status === 'failed' ? (
        <p className="error" style={{ fontSize: '0.9rem' }}>
          {edition.error ?? 'The audio version could not be produced.'}
        </p>
      ) : null}

      {may && canProduce && !working ? (
        <form action={produce} className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input type="hidden" name="projectId" value={projectId} />
          <button className={edition?.status === 'completed' ? 'btn btn--secondary' : 'btn'} type="submit" disabled={pending || !hasStoryboard}>
            {pending ? 'Starting…' : edition?.status === 'completed' ? 'Read it again' : 'Read it aloud'}
          </button>
          {!hasStoryboard ? <span className="hint">Once the storyboard exists.</span> : null}
          {state.error ? <span className="error">{state.error}</span> : null}
          {state.message ? <span className="hint">{state.message}</span> : null}
        </form>
      ) : null}
    </section>
  );
}
