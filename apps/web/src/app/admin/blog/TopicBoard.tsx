'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dropTopicAction, suggestTopicsAction } from './actions.ts';
import styles from '../admin.module.css';

type Topic = { id: string; title: string; intent: string; rationale: string; score: number; keywords: string[] };

/**
 * What is worth writing next.
 *
 * The opportunities the editor found, scored, with the reason. Dropping one
 * is as important as writing one: a topic list nobody prunes becomes a
 * content farm's backlog.
 */
export function TopicBoard({ topics }: { topics: Topic[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (work: () => Promise<{ error: string | null; message?: string }>) =>
    start(async () => {
      const result = await work();
      setMessage(result.error ?? result.message ?? null);
      if (!result.error) router.refresh();
    });

  return (
    <section className={styles.section}>
      <h2>Worth writing</h2>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="button" className="btn btn--secondary" disabled={pending} onClick={() => run(() => suggestTopicsAction())}>
          {pending ? 'Thinking…' : 'Find topics'}
        </button>
        <span className="muted" style={{ fontSize: '0.84rem' }}>
          Reads what has been published and proposes five. One model call.
        </span>
        {message ? <span className="hint">{message}</span> : null}
      </div>

      {topics.length === 0 ? (
        <p className={styles.empty}>No topics waiting.</p>
      ) : (
        <ul className={styles.customerList}>
          {topics.map((topic) => (
            <li key={topic.id} className={styles.customerRow}>
              <div className={styles.customerIdentity}>
                <strong>{topic.title}</strong>
                <span className="mono muted">{topic.keywords.join(' · ') || 'no keywords'}</span>
              </div>
              <span className="badge">{topic.score}</span>
              <div style={{ gridColumn: '1 / -1', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                {topic.intent ? <div>{topic.intent}</div> : null}
                {topic.rationale ? <div className="muted">{topic.rationale}</div> : null}
              </div>
              <div className={styles.customerControls} style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => run(() => dropTopicAction({ id: topic.id }))}>
                  Not this one
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
