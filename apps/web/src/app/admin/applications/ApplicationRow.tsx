'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BETA_APPLICATION_LABELS, type BetaApplication } from '@act-one/core';
import { decideApplicationAction } from '../product/actions.ts';
import styles from '../admin.module.css';

export function ApplicationRow({ application, link, code, redeemed }: { application: BetaApplication; link: string | null; code: string | null; redeemed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const decide = (decision: 'approved' | 'rejected') =>
    start(async () => {
      const result = await decideApplicationAction({ id: application.id, decision });
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <li className={styles.customerRow} data-pending={pending || undefined}>
      <div className={styles.customerIdentity}>
        <strong>{application.name || application.email}</strong>
        <span className="mono">{application.email}{application.company ? ` · ${application.company}` : ''}</span>
        {application.website ? (
          <a href={application.website} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: '0.78rem' }}>
            {application.website}
          </a>
        ) : null}
      </div>
      <span className={`badge ${application.status === 'approved' ? 'badge--ok' : application.status === 'rejected' ? 'badge--bad' : 'badge--warn'}`}>
        {BETA_APPLICATION_LABELS[application.status]}
      </span>
      <div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        {application.message || <span className="muted">No message.</span>}
        <div className="mono muted" style={{ fontSize: '0.72rem', marginTop: 'var(--space-2)' }}>
          asked {application.createdAt.slice(0, 16).replace('T', ' ')}
          {application.decidedAt ? ` · decided ${application.decidedAt.slice(0, 16).replace('T', ' ')}` : ''}
        </div>
      </div>
      <div className={styles.customerControls} style={{ gridColumn: '1 / -1' }}>
        {application.status === 'pending' ? (
          <>
            <button type="button" className="btn" disabled={pending} onClick={() => decide('approved')}>
              Invite
            </button>
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => decide('rejected')}>
              Decline
            </button>
          </>
        ) : link ? (
          <>
            <code className="mono" style={{ fontSize: '0.78rem' }}>{code}</code>
            <span className="muted" style={{ fontSize: '0.8rem' }}>{redeemed ? 'used' : 'not yet used'}</span>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // The link is right here.
                }
              }}
            >
              {copied ? 'Copied' : 'Copy invitation link'}
            </button>
          </>
        ) : null}
        {error ? <span className="error">{error}</span> : null}
      </div>
    </li>
  );
}
