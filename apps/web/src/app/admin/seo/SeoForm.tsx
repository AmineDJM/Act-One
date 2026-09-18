'use client';

import { useActionState } from 'react';
import type { SeoConfig } from '@act-one/core';
import { saveSeoAction, type SeoActionState } from './actions.ts';
import styles from '../admin.module.css';

/**
 * The few search decisions that are a person's to make.
 *
 * Deliberately short. Canonicals, structured data and the sitemap are not
 * settings — getting them wrong is a bug, not a preference — so they are not
 * here. What is here is the sentence the landing page shows in results,
 * whether this deployment may be found at all, and the two tokens a search
 * console hands you to prove the site is yours.
 */
export function SeoForm({ seo, fallback }: { seo: SeoConfig; fallback: string }) {
  const [state, save, saving] = useActionState<SeoActionState, FormData>(saveSeoAction, { error: null });

  return (
    <form action={save} className={styles.section}>
      <h2>Settings</h2>
      <label className="field">
        <span>The landing page&apos;s description in search results</span>
        <textarea
          name="description"
          className="input"
          rows={3}
          maxLength={240}
          defaultValue={seo.description}
          placeholder={fallback}
        />
        <span className="hint">Around 155 characters is what search shows. Leave it empty for the written one.</span>
      </label>

      <label className={styles.checkRow}>
        <input type="checkbox" name="discourageIndexing" defaultChecked={seo.discourageIndexing} />
        <span>
          <strong>Keep the whole site out of search.</strong> For the window between the domain going live and the site
          being ready to be found. A deployment that is not on its real address is already excluded.
        </span>
      </label>

      <div className={styles.formGrid}>
        <label className="field">
          <span>Google Search Console token</span>
          <input name="googleVerification" className="input mono" defaultValue={seo.googleVerification} maxLength={200} placeholder="google-site-verification content" />
        </label>
        <label className="field">
          <span>Bing Webmaster Tools token</span>
          <input name="bingVerification" className="input mono" defaultValue={seo.bingVerification} maxLength={200} placeholder="msvalidate.01 content" />
        </label>
      </div>
      <p className="hint">
        Only the value inside the tag, not the whole tag. Both are written into the landing page, which is where both
        consoles look.
      </p>

      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
      </div>
    </form>
  );
}
