'use client';

import { useActionState } from 'react';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory } from '@act-one/core';
import { publishManuallyAction, type CollectionActionState } from './actions.ts';
import styles from '../admin.module.css';

export type Candidate = { value: string; label: string; state: string | null };

/**
 * Publishing a film without a submission.
 *
 * The other door into Collections. It needs a finished film and the
 * customer's written consent, held elsewhere and attested here in the
 * operator's own words; the attestation is stored with the entry as the
 * basis for public display.
 */
export function PublishFilm({ candidates }: { candidates: Candidate[] }) {
  const [state, action, pending] = useActionState<CollectionActionState, FormData>(publishManuallyAction, { error: null });
  return (
    <form action={action} className={styles.section}>
      <h2>Publish a film yourself</h2>
      <p className="muted" style={{ fontSize: '0.88rem', maxWidth: '64ch' }}>
        For a film the customer agreed to show in writing, or one commissioned by Act One. The film goes
        live at once, under the consent you attest to here.
      </p>
      <div className={styles.formGrid}>
        <label className="field">
          <span>Finished project</span>
          <select name="project" className="input" defaultValue="" required>
            <option value="" disabled>
              Pick a film-ready project
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.value} value={candidate.value}>
                {candidate.label}
                {candidate.state ? ` — ${candidate.state}` : ''}
              </option>
            ))}
          </select>
        </label>
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
      </div>
      <label className="field">
        <span>Consent held (stored with the entry)</span>
        <input name="consentStatement" className="input" maxLength={600} placeholder="Written consent from Jane Doe, CEO, by email on 12 May 2026." required />
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" name="attest" />
        <span>I hold the customer's written consent to public display and it covers this film, its stills and the product name.</span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" name="original" />
        <span>Act One Original: commissioned or made editorially by Act One.</span>
      </label>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Publishing…' : 'Publish'}
        </button>
        {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
      </div>
    </form>
  );
}
