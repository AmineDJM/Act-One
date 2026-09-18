'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { InviteCode } from '@act-one/core';
import { createInvitesAction, revokeInviteAction, type ProductActionState } from '../product/actions.ts';
import styles from '../admin.module.css';

type Row = InviteCode & { link: string; refusal: string | null; by: string | null; owner: string | null };

export function InviteTools({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ProductActionState, FormData>(createInvitesAction, { error: null });
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // The link is on the page; a person can select it.
    }
  };

  return (
    <>
      <form action={action} className={styles.section}>
        <h2>Make invitations</h2>
        <div className={styles.formGrid}>
          <label className="field">
            <span>How many</span>
            <input name="count" type="number" min={1} max={100} defaultValue={1} className="input" />
          </label>
          <label className="field">
            <span>Uses each (empty for unlimited)</span>
            <input name="maxUses" type="number" min={0} defaultValue={1} className="input" />
          </label>
          <label className="field">
            <span>Expires in days (empty for never)</span>
            <input name="expiresInDays" type="number" min={1} defaultValue={30} className="input" />
          </label>
          <label className="field">
            <span>Note (who it is for)</span>
            <input name="note" className="input" maxLength={200} placeholder="Product Hunt makers, September" />
          </label>
        </div>
        <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Making…' : 'Make'}
          </button>
          {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
        </div>
        {state.links && state.links.length > 0 ? (
          <ul className={styles.linkList}>
            {state.links.map((link) => (
              <li key={link}>
                <code>{link}</code>
                <button type="button" className="btn btn--ghost" onClick={() => copy(link)}>
                  {copied === link ? 'Copied' : 'Copy'}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      <section className={styles.section}>
        <h2>All codes</h2>
        {rows.length === 0 ? (
          <p className={styles.empty}>No invitations yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Kind</th>
                  <th>Note</th>
                  <th className={styles.num}>Uses</th>
                  <th>Expires</th>
                  <th>State</th>
                  <th>By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.code}</td>
                    <td className="mono">{row.kind}{row.owner ? ` · ${row.owner}` : ''}</td>
                    <td>{row.note || <span className="muted">—</span>}</td>
                    <td className={styles.num}>
                      {row.uses}/{row.maxUses ?? '∞'}
                    </td>
                    <td className="mono">{row.expiresAt ? row.expiresAt.slice(0, 10) : 'never'}</td>
                    <td>
                      <span className={`badge ${row.refusal ? 'badge--bad' : 'badge--ok'}`}>{row.refusal ? (row.revokedAt ? 'withdrawn' : row.expiresAt && Date.parse(row.expiresAt) <= Date.now() ? 'expired' : 'used up') : 'open'}</span>
                    </td>
                    <td className="mono">{row.by ?? '—'}</td>
                    <td>
                      <span className="row" style={{ gap: 'var(--space-2)' }}>
                        <button type="button" className="btn btn--ghost" onClick={() => copy(row.link)}>
                          {copied === row.link ? 'Copied' : 'Copy link'}
                        </button>
                        {!row.revokedAt ? (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            disabled={busy}
                            onClick={() =>
                              start(async () => {
                                await revokeInviteAction({ id: row.id });
                                router.refresh();
                              })
                            }
                          >
                            Withdraw
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
