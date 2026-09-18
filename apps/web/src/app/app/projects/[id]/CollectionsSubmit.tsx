'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory } from '@act-one/core';
import { Status } from '@/components/ui/Prompt.tsx';
import type { FormState } from '../../actions.ts';
import { submitForSelectionAction, withdrawFromSelectionAction } from './collections-actions.ts';
import styles from '../../app.module.css';

export type SubmissionCard = {
  status: 'pending' | 'published' | 'rejected' | 'unpublished' | 'withdrawn' | null;
  label: string | null;
  next: 'submit' | 'wait' | 'withdraw' | 'resubmit';
  eligible: boolean;
  reason: string | null;
  publicPath: string | null;
  canSubmit: boolean;
  consentStatement: string;
};

/**
 * Submitting the film for Act One Collections.
 *
 * A finished film may be put forward for the public gallery. The consent is
 * spelled out in full and ticked by the person, never pre-ticked; the
 * outcome is a person's decision, and the film can be withdrawn at any time,
 * which takes it off the site at once.
 */
export function CollectionsSubmit({ projectId, card }: { projectId: string; card: SubmissionCard }) {
  const [state, submit, submitting] = useActionState<FormState, FormData>(submitForSelectionAction, { error: null });
  const [withdrawState, withdraw, withdrawing] = useActionState<FormState, FormData>(withdrawFromSelectionAction, { error: null });
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const tone = card.status === 'published' ? 'ready' : card.status === 'pending' ? 'active' : 'quiet';
  const statusWord = card.label ?? (card.eligible ? 'NOT SUBMITTED' : 'MASTER FIRST');

  return (
    <section className={styles.panel} data-testid="collections">
      <div className={styles.panelHead}>
        <h3>Collections</h3>
        <Status tone={tone} live={card.status === 'pending'}>
          {statusWord.toUpperCase()}
        </Status>
      </div>

      {card.status === 'published' ? (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          Selected for Act One Collections.{' '}
          {card.publicPath ? (
            <Link href={card.publicPath} target="_blank" rel="noreferrer">
              See the public page →
            </Link>
          ) : null}
        </p>
      ) : card.status === 'pending' ? (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          Under consideration. A person looks at every submission; nothing is shown until they select it.
        </p>
      ) : (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          {card.status === 'rejected'
            ? 'Not selected this time. You can submit a new master.'
            : card.status === 'withdrawn'
              ? 'Withdrawn. You can submit it again whenever you like.'
              : card.status === 'unpublished'
                ? 'No longer shown. You can submit it again.'
                : 'Put this film forward for the public gallery of launch films made here. A person selects; nothing is shown automatically.'}
        </p>
      )}

      {!card.eligible && card.next !== 'withdraw' && card.next !== 'wait' ? (
        <p className="hint">{card.reason}</p>
      ) : null}

      {card.canSubmit && card.eligible && (card.next === 'submit' || card.next === 'resubmit') ? (
        !open ? (
          <div>
            <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
              Submit for selection
            </button>
          </div>
        ) : (
          <form action={submit} className={styles.submitForm}>
            <input type="hidden" name="projectId" value={projectId} />
            <div className={styles.submitGrid}>
              <label className="field">
                <span>Category</span>
                <select name="category" className="input" defaultValue="other">
                  {CollectionCategory.options.map((option) => (
                    <option key={option} value={option}>
                      {COLLECTION_CATEGORY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Launch date (optional)</span>
                <input name="launchDate" type="date" className="input" />
              </label>
            </div>
            <label className="field">
              <span>Tagline (optional)</span>
              <input name="tagline" className="input" maxLength={200} placeholder="One line under the film" />
            </label>
            <label className="field">
              <span>The concept, in your words (optional)</span>
              <textarea name="concept" className="input" rows={3} maxLength={600} />
            </label>
            <label className={styles.consent}>
              <input type="checkbox" name="consent" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
              <span>{card.consentStatement}</span>
            </label>
            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn" type="submit" disabled={!agreed || submitting}>
                {submitting ? 'Submitting…' : 'Submit for selection'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Not now
              </button>
              {state.message ? (
                <span className="secondary" style={{ fontSize: '0.86rem' }} role="status">
                  {state.message}
                </span>
              ) : null}
              {state.error ? (
                <span style={{ color: 'var(--danger)', fontSize: '0.86rem' }} role="alert">
                  {state.error}
                </span>
              ) : null}
            </div>
          </form>
        )
      ) : null}

      {card.canSubmit && (card.next === 'withdraw' || card.next === 'wait') ? (
        <form action={withdraw} className="row" style={{ gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="projectId" value={projectId} />
          <button className="btn btn--ghost" type="submit" disabled={withdrawing}>
            {withdrawing ? 'Withdrawing…' : card.status === 'published' ? 'Withdraw from Collections' : 'Withdraw the submission'}
          </button>
          {withdrawState.message ? (
            <span className="secondary" style={{ fontSize: '0.86rem' }} role="status">
              {withdrawState.message}
            </span>
          ) : null}
          {withdrawState.error ? (
            <span style={{ color: 'var(--danger)', fontSize: '0.86rem' }} role="alert">
              {withdrawState.error}
            </span>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
