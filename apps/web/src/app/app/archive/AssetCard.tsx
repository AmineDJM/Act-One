'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LIBRARY_CATEGORY_LABELS, LibraryCategory } from '@act-one/core';
import type { LibraryCard } from '@/server/library.ts';
import { deleteAssetAction, renameAssetAction, setAssetCategoryAction, setAssetFlagAction, setAssetProjectsAction } from './actions.ts';
import styles from '../app.module.css';

/**
 * One picture.
 *
 * The card says five things — the picture, its name, what it is, which
 * projects use it, where it came from — and every one of them can be
 * changed in place. The tools sit quietly until the card is pointed at.
 */
export function AssetCard({ card, projects }: { card: LibraryCard; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(card.projects.map((project) => project.id)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const version = useRef<HTMLInputElement>(null);

  const run = (work: () => Promise<{ error: string | null }>) =>
    start(async () => {
      const result = await work();
      setError(result.error);
      if (!result.error) router.refresh();
    });

  const rename = (name: string) => {
    setEditing(false);
    if (name.trim() && name.trim() !== card.name) run(() => renameAssetAction({ id: card.id, name }));
  };

  const newVersion = async (file: File) => {
    const body = new FormData();
    body.set('file', file, file.name);
    body.set('parent', card.id);
    const response = await fetch('/api/library/upload', { method: 'POST', body });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setError(response.ok ? null : (payload.error ?? 'The upload was refused.'));
    if (response.ok) router.refresh();
  };

  return (
    <article className={styles.asset} data-pending={pending || undefined} data-approved={card.approved || undefined}>
      <a href={card.url} target="_blank" rel="noreferrer" className={styles.assetThumb} data-vector={card.contentType.includes('svg') || undefined}>
        <img src={card.thumbUrl} alt={card.name} loading="lazy" decoding="async" />
      </a>

      <div className={styles.assetBody}>
        <div className={styles.assetTop}>
          {editing ? (
            <input
              className={`input ${styles.assetNameInput}`}
              defaultValue={card.name}
              autoFocus
              maxLength={200}
              aria-label="Name"
              onBlur={(event) => rename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') rename((event.target as HTMLInputElement).value);
                if (event.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button type="button" className={styles.assetName} onClick={() => setEditing(true)} title="Rename">
              {card.name}
            </button>
          )}
          <span className={styles.assetFlags}>
            <button
              type="button"
              className={styles.assetFlag}
              data-on={card.favorite || undefined}
              aria-pressed={card.favorite}
              title={card.favorite ? 'Favourite' : 'Mark as favourite'}
              onClick={() => run(() => setAssetFlagAction({ id: card.id, flag: 'favorite', value: !card.favorite }))}
            >
              ★
            </button>
            <button
              type="button"
              className={styles.assetFlag}
              data-on={card.approved || undefined}
              data-kind="approved"
              aria-pressed={card.approved}
              title={card.approved ? 'Approved: preferred in films' : 'Approve for films'}
              onClick={() => run(() => setAssetFlagAction({ id: card.id, flag: 'approved', value: !card.approved }))}
            >
              ✓
            </button>
          </span>
        </div>

        <div className={styles.assetMeta}>
          <select
            className={styles.assetSelect}
            value={card.category}
            aria-label="Category"
            title={card.categorySource === 'inferred' ? 'Inferred; change it if we got it wrong' : card.categorySource === 'user' ? 'Set by you' : 'Not yet sorted'}
            onChange={(event) => run(() => setAssetCategoryAction({ id: card.id, category: event.target.value }))}
          >
            {LibraryCategory.options.map((value) => (
              <option key={value} value={value}>
                {LIBRARY_CATEGORY_LABELS[value].toUpperCase()}
              </option>
            ))}
          </select>
          <span aria-hidden="true">·</span>
          <button type="button" className={styles.assetProjects} onClick={() => setChooser((open) => !open)} title="Which productions use it">
            {card.projects.length === 0 ? 'EVERY PRODUCTION' : card.projects.map((project) => project.name).join(', ')}
          </button>
          <span aria-hidden="true">·</span>
          {/* Where it came from. A picture with no provenance is a picture
              nobody can vouch for, and this archive keeps things for years. */}
          {card.sourceUrl ? (
            <a className={styles.assetSource} href={card.sourceUrl} target="_blank" rel="noreferrer" title={card.sourceUrl}>
              {card.sourceLabel.toUpperCase()} · {hostOf(card.sourceUrl)}
            </a>
          ) : (
            <span className={styles.assetSource}>{card.sourceLabel.toUpperCase()}</span>
          )}
          {card.parentAssetId ? <span className={styles.assetVersion}>VERSION</span> : null}
        </div>

        {card.description ? <p className={styles.assetDesc}>{card.description}</p> : null}
      </div>

      <div className={styles.assetTools}>
        <span className={styles.assetDims}>
          {card.width && card.height ? `${card.width}×${card.height}` : card.contentType.replace('image/', '').toUpperCase()}
        </span>
        <input
          ref={version}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void newVersion(file);
            event.target.value = '';
          }}
        />
        <button type="button" className={styles.assetTool} onClick={() => version.current?.click()}>
          New version
        </button>
        {confirmDelete ? (
          <>
            <button type="button" className={styles.assetTool} data-danger onClick={() => run(() => deleteAssetAction({ id: card.id }))}>
              Remove for good
            </button>
            <button type="button" className={styles.assetTool} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className={styles.assetTool} onClick={() => setConfirmDelete(true)}>
            Remove
          </button>
        )}
      </div>

      {chooser ? (
        <div className={styles.chooser} role="group" aria-label="Use in">
          <label className={styles.chip} data-on={chosen.size === 0 || undefined}>
            <input type="radio" className="sr-only" name={`scope-${card.id}`} checked={chosen.size === 0} onChange={() => setChosen(new Set())} />
            All productions
          </label>
          {projects.map((project) => (
            <label key={project.id} className={styles.chip} data-on={chosen.has(project.id) || undefined}>
              <input
                type="checkbox"
                className="sr-only"
                checked={chosen.has(project.id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(project.id);
                  else next.delete(project.id);
                  setChosen(next);
                }}
              />
              {project.name}
            </label>
          ))}
          <button
            type="button"
            className="btn btn--secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setChooser(false);
              run(() => setAssetProjectsAction({ ids: [card.id], projectIds: [...chosen] }));
            }}
          >
            Done
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** The host of a source address, for a card that has no room for the rest. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}
