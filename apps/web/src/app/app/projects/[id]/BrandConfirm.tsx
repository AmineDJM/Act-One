'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { fontFor, pendingBrandSignals, type BrandSystem } from '@act-one/core';
import { Status } from '@/components/ui/Prompt.tsx';
import { confirmBrandAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

/**
 * The project's brand, on the project page.
 *
 * A card, not a settings panel: the state of the DNA, the one ambiguity
 * worth a click here — which colour is *the* brand colour — and the way to
 * the Brand page where every component is read, edited and confirmed.
 */
export function BrandConfirm({ projectId, brand }: { projectId: string; brand: BrandSystem }) {
  const [state, confirm, pending] = useActionState<FormState, FormData>(confirmBrandAction, { error: null });
  const signals = pendingBrandSignals(brand).length;
  const candidates = brand.primaryCandidates.length > 0 ? brand.primaryCandidates : [brand.primaryColor];
  const here = `/app/identity?project=${encodeURIComponent(projectId)}`;

  return (
    <form action={confirm} className={`${styles.panel} ${styles.brandCard}`}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="brandId" value={brand.id} />

      <div className={styles.panelHead}>
        <h3>Brand DNA</h3>
        <Status tone={signals > 0 ? 'attention' : brand.confirmedByUser ? 'ready' : 'active'}>
          {signals > 0 ? 'NEEDS REVIEW' : brand.confirmedByUser ? 'CONFIRMED' : 'MEASURED'}
        </Status>
      </div>

      <div className={styles.brandCardRow}>
        <span className={styles.swatches}>
          {candidates.map((color, index) => (
            <label key={color} title={color} style={{ cursor: candidates.length > 1 ? 'pointer' : 'default' }}>
              <input
                type="radio"
                name="primaryColor"
                value={color}
                defaultChecked={color === brand.primaryColor || (index === 0 && !brand.primaryColor)}
                className="sr-only"
              />
              <span
                className={styles.swatch}
                style={{ background: color, outline: color === brand.primaryColor ? '2px solid var(--accent)' : undefined, outlineOffset: 2 }}
                aria-label={`Use ${color} as the brand colour`}
              />
            </label>
          ))}
        </span>
        <span>
          {fontFor(brand, 'display').family} · {brand.cornerRadiusPx}px {brand.cornerStyle} · {brand.visualStyle} · {brand.motionStyle}
        </span>
      </div>
      {candidates.length > 1 && !brand.confirmedByUser ? (
        <p className="hint">Your site uses more than one colour prominently. Pick the one that is actually the brand.</p>
      ) : null}
      <p className="secondary" style={{ fontSize: '0.86rem' }}>
        Measured from {brand.sources.length} source{brand.sources.length === 1 ? '' : 's'}
        {brand.parentBrandId ? ', started from a brand you confirmed before' : ''}
        {brand.communication.tagline ? ` · “${brand.communication.tagline}”` : ''}.
      </p>

      <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        {!brand.confirmedByUser ? (
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Looks good'}
          </button>
        ) : null}
        <span className={styles.brandCardLinks}>
          {signals > 0 ? (
            <Link href={here} data-tone="attention">
              Review {signals} signal{signals === 1 ? '' : 's'} →
            </Link>
          ) : null}
          <Link href={here}>{brand.confirmedByUser ? 'Every component →' : 'Read every component →'}</Link>
        </span>
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
  );
}
