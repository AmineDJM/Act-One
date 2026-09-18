'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BrandSignal } from '@act-one/core';
import { reviewBrandSignalAction } from './dna-actions.ts';
import styles from '../app.module.css';

/**
 * "We found 2 new brand signals."
 *
 * Each one is what the brand says, what a later reading measured, and
 * where. A person accepts it into the brand or dismisses it; nothing is
 * applied on its own, and a dismissed reading is not proposed again.
 */
export function BrandSignals({ brandId, signals, canEdit }: { brandId: string; signals: BrandSignal[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (signalId: string, decision: 'accepted' | 'dismissed') =>
    start(async () => {
      const result = await reviewBrandSignalAction({ brandId, signalId, decision });
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <section className={styles.signals} aria-label="New brand signals" data-pending={pending || undefined}>
      <div className={styles.signalsHead}>
        <span className="prompt" data-tone="text">
          <span className="prompt__chevron" aria-hidden="true">&gt;</span> We found {signals.length} new brand signal{signals.length === 1 ? '' : 's'}
        </span>
        <span className="hint">Read from the site since the brand was set. Nothing changes until you say so.</span>
      </div>
      <ul className={styles.signalList}>
        {signals.map((signal) => (
          <li key={signal.id} className={styles.signalRow}>
            <span className={styles.signalLabel}>{signal.label}</span>
            <span className={styles.signalChange}>
              <Value value={signal.current} />
              <span aria-hidden="true">→</span>
              <Value value={signal.proposed} />
            </span>
            <span className={styles.signalReason}>
              {signal.reason}
              {signal.sourceUrl ? (
                <>
                  {' '}
                  <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
                    {hostOf(signal.sourceUrl)}
                  </a>
                </>
              ) : null}
            </span>
            {canEdit ? (
              <span className={styles.signalTools}>
                <button type="button" className="btn btn--secondary" onClick={() => decide(signal.id, 'accepted')} disabled={pending}>
                  Accept
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => decide(signal.id, 'dismissed')} disabled={pending}>
                  Dismiss
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="muted">none</span>;
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    return (
      <span className={styles.signalSwatch}>
        <span style={{ background: value }} aria-hidden="true" />
        {value}
      </span>
    );
  }
  return <span>{String(value).replace(/_/g, ' ')}</span>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
