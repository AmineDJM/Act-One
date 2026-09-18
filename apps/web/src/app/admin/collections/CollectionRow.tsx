'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COLLECTION_CATEGORY_LABELS, COLLECTION_STATUS_LABELS, CollectionCategory, type CollectionEntry } from '@act-one/core';
import { decideEntryAction, editEntryAction, flagEntryAction, type CollectionActionState } from './actions.ts';
import styles from '../admin.module.css';

export type PictureChoice = { id: string; kind: string; name: string; width: number | null; height: number | null };

/**
 * One entry, with every editorial decision on it.
 *
 * The decision buttons act at once; the words, the pictures and the order
 * are a form, saved together. Pictures are shown from the authenticated
 * asset route: staff are signed in, and nothing here is public until the
 * entry is.
 */
export function CollectionRow({ entry, organizationName, submitterEmail, pictures }: { entry: CollectionEntry; organizationName: string; submitterEmail: string | null; pictures: PictureChoice[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, save, saving] = useActionState<CollectionActionState, FormData>(editEntryAction, { error: null });
  const [open, setOpen] = useState(false);
  /*
   * The flags answer the click, not the round trip.
   *
   * Bound straight to the entry, a tick reverted the moment React re-rendered
   * and only came back when the refresh landed — the operator saw their own
   * click undone. The local value leads; a refused change is put back.
   */
  const [flags, setFlags] = useState({ featured: entry.featured, launchOfTheWeek: entry.launchOfTheWeek, original: entry.original });

  const decide = (decision: 'publish' | 'reject' | 'unpublish') =>
    start(async () => {
      const result = await decideEntryAction({ id: entry.id, decision });
      setError(result.error);
      if (!result.error) router.refresh();
    });
  const flag = (name: 'featured' | 'launchOfTheWeek' | 'original', value: boolean) => {
    setFlags((current) => ({ ...current, [name]: value }));
    start(async () => {
      const result = await flagEntryAction({ id: entry.id, flag: name, value });
      setError(result.error);
      if (result.error) setFlags((current) => ({ ...current, [name]: !value }));
      else router.refresh();
    });
  };

  // Pictures come through the staff route: an entry is usually another company's.
  const picture = (id: string, thumb = false) => `/api/admin/assets/${entry.organizationId}/${id}${thumb ? '?thumb' : ''}`;
  const badge = entry.status === 'published' ? 'badge--ok' : entry.status === 'rejected' || entry.status === 'withdrawn' ? 'badge--bad' : entry.status === 'pending' ? 'badge--warn' : '';
  const when = (value: string | null) => (value ? value.slice(0, 16).replace('T', ' ') : '—');

  return (
    <li className={styles.customerRow} data-pending={pending || saving || undefined}>
      <div className={styles.entryHead}>
        <a className={styles.entryPoster} href={entry.posterAssetId ? picture(entry.posterAssetId) : undefined} target="_blank" rel="noreferrer" data-empty={!entry.posterAssetId || undefined}>
          {entry.posterAssetId ? <img src={picture(entry.posterAssetId)} alt="" loading="lazy" /> : <span className="mono muted">no frame</span>}
        </a>
        <div className={styles.customerIdentity}>
          <strong>
            {entry.company} · {entry.title}
          </strong>
          <span className="mono">
            /collections/{entry.slug} · {COLLECTION_CATEGORY_LABELS[entry.category]} · {Math.round(entry.durationSeconds)}s
          </span>
          <span className="mono muted" style={{ fontSize: '0.74rem' }}>
            {organizationName} · project {entry.projectId} · render {entry.renderId}
          </span>
        </div>
        <span className={`badge ${badge}`}>{COLLECTION_STATUS_LABELS[entry.status]}</span>
      </div>

      <div style={{ gridColumn: '1 / -1', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
        <div className={styles.consentLine}>
          <strong>{entry.consent.byStaff ? 'Consent attested by staff' : 'Consent given by the customer'}</strong>
          {' · '}
          {entry.consent.byStaff ? entry.consent.grantedByUserId : (submitterEmail ?? entry.consent.grantedByUserId)} · {when(entry.consent.grantedAt)}
          <blockquote className={styles.consentQuote}>{entry.consent.statement}</blockquote>
        </div>
        <div className="mono muted" style={{ fontSize: '0.72rem', marginTop: 'var(--space-2)' }}>
          submitted {when(entry.submittedAt)}
          {entry.decidedAt ? ` · decided ${when(entry.decidedAt)} by ${entry.decidedByUserId ?? '—'}` : ''}
          {entry.publishedAt ? ` · published ${when(entry.publishedAt)}` : ''}
          {' · '}position {entry.position}
        </div>
      </div>

      <div className={styles.customerControls} style={{ gridColumn: '1 / -1' }}>
        {entry.status === 'pending' || entry.status === 'rejected' || entry.status === 'unpublished' ? (
          <button type="button" className="btn" disabled={pending} onClick={() => decide('publish')}>
            Publish
          </button>
        ) : null}
        {entry.status === 'pending' ? (
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => decide('reject')}>
            Decline
          </button>
        ) : null}
        {entry.status === 'published' ? (
          <>
            <a className="btn btn--secondary" href={`/collections/${entry.slug}`} target="_blank" rel="noreferrer">
              Public page
            </a>
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => decide('unpublish')}>
              Unpublish
            </button>
          </>
        ) : null}
        {entry.status === 'withdrawn' ? <span className="muted" style={{ fontSize: '0.84rem' }}>Withdrawn by the customer. Only they can submit it again.</span> : null}

        <label className={styles.flag}>
          <input type="checkbox" checked={flags.featured} disabled={pending} onChange={(event) => flag('featured', event.target.checked)} />
          Featured
        </label>
        <label className={styles.flag}>
          <input type="checkbox" checked={flags.launchOfTheWeek} disabled={pending} onChange={(event) => flag('launchOfTheWeek', event.target.checked)} />
          Launch of the week
        </label>
        <label className={styles.flag}>
          <input type="checkbox" checked={flags.original} disabled={pending} onChange={(event) => flag('original', event.target.checked)} />
          Act One Original
        </label>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Close' : 'Edit'}
        </button>
        {error ? <span className="error">{error}</span> : null}
      </div>

      {open ? (
        <form action={save} className={styles.entryForm} style={{ gridColumn: '1 / -1' }}>
          <input type="hidden" name="id" value={entry.id} />
          <div className={styles.formGrid}>
            <label className="field">
              <span>Company</span>
              <input name="company" className="input" defaultValue={entry.company} maxLength={120} required />
            </label>
            <label className="field">
              <span>Title</span>
              <input name="title" className="input" defaultValue={entry.title} maxLength={140} required />
            </label>
            <label className="field">
              <span>Address (slug)</span>
              <input name="slug" className="input mono" defaultValue={entry.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required />
            </label>
            <label className="field">
              <span>Product URL</span>
              <input name="productUrl" className="input" defaultValue={entry.productUrl} type="url" required />
            </label>
            <label className="field">
              <span>Category</span>
              <select name="category" className="input" defaultValue={entry.category}>
                {CollectionCategory.options.map((option) => (
                  <option key={option} value={option}>
                    {COLLECTION_CATEGORY_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Launch date</span>
              <input name="launchDate" className="input" type="date" defaultValue={entry.launchDate ?? ''} />
            </label>
            <label className="field">
              <span>Position (lower first)</span>
              <input name="position" className="input" type="number" defaultValue={entry.position} />
            </label>
          </div>
          <label className="field">
            <span>Tagline</span>
            <input name="tagline" className="input" defaultValue={entry.tagline} maxLength={200} />
          </label>
          <label className="field">
            <span>Concept</span>
            <textarea name="concept" className="input" rows={3} defaultValue={entry.concept} maxLength={600} />
          </label>
          <div className={styles.formGrid}>
            <label className="field">
              <span>SEO title (empty for the default)</span>
              <input name="seoTitle" className="input" defaultValue={entry.seoTitle} maxLength={120} />
            </label>
            <label className="field">
              <span>SEO description (empty for the tagline)</span>
              <input name="seoDescription" className="input" defaultValue={entry.seoDescription} maxLength={240} />
            </label>
          </div>
          <label className="field">
            <span>Editorial note (internal)</span>
            <input name="editorialNote" className="input" defaultValue={entry.editorialNote} maxLength={1000} />
          </label>

          <fieldset className={styles.fieldset}>
            <legend>Poster frame and stills</legend>
            {pictures.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.84rem' }}>This project has no frames yet.</p>
            ) : (
              <div className={styles.pictureGrid}>
                <label className={styles.pictureChoice}>
                  <input type="radio" name="posterAssetId" value="" defaultChecked={!entry.posterAssetId} />
                  <span className={styles.pictureNone}>No poster</span>
                </label>
                {pictures.map((choice) => (
                  <div key={choice.id} className={styles.picture}>
                    <img src={picture(choice.id, true)} alt="" loading="lazy" />
                    <div className={styles.pictureMeta}>
                      <span className="mono muted" title={choice.name}>
                        {choice.kind.replace(/_/g, ' ')}
                        {choice.width && choice.height ? ` · ${choice.width}×${choice.height}` : ''}
                      </span>
                      <label>
                        <input type="radio" name="posterAssetId" value={choice.id} defaultChecked={entry.posterAssetId === choice.id} /> poster
                      </label>
                      <label>
                        <input type="checkbox" name="stillAssetIds" value={choice.id} defaultChecked={entry.stillAssetIds.includes(choice.id)} /> still
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
          </div>
        </form>
      ) : null}
    </li>
  );
}
