'use client';

import { useActionState } from 'react';
import type { BrandSystem } from '@act-one/core';
import { confirmBrandAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

/**
 * "We found your brand. Looks good / Edit."
 *
 * Deliberately not a settings panel. Almost everything here was measured from
 * the customer's own site and will be right; the one thing that is genuinely
 * ambiguous is which colour is *the* brand colour, because some brands really
 * do have two. So that is the one thing we ask about, as one click.
 */
export function BrandConfirm({ projectId, brand }: { projectId: string; brand: BrandSystem }) {
  const [state, confirm, pending] = useActionState<FormState, FormData>(confirmBrandAction, {
    error: null,
  });

  const candidates = brand.primaryCandidates.length > 0 ? brand.primaryCandidates : [brand.primaryColor];

  return (
    <form action={confirm} className={styles.panel}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="brandId" value={brand.id} />

      <div className={styles.panelHead}>
        <h3>We found your brand</h3>
        {brand.confirmedByUser ? <span className="badge badge--ok">Confirmed</span> : null}
      </div>

      <div className={styles.swatches}>
        {candidates.map((color, index) => (
          <label key={color} title={color} style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="primaryColor"
              value={color}
              defaultChecked={color === brand.primaryColor || (index === 0 && !brand.primaryColor)}
              className="sr-only"
            />
            <span
              className={styles.swatch}
              style={{
                background: color,
                outline: color === brand.primaryColor ? '2px solid var(--accent)' : undefined,
                outlineOffset: 2,
              }}
              aria-label={`Use ${color} as the brand colour`}
            />
          </label>
        ))}
      </div>
      {candidates.length > 1 ? (
        <p className="hint">
          Your site uses more than one colour prominently. Pick the one that is actually the brand.
        </p>
      ) : null}

      <dl className={styles.kv}>
        <div className={styles.kvRow}>
          <dt>Type</dt>
          <dd>
            {brand.typography.find((font) => font.role === 'display')?.family ?? 'System'}
            {brand.typography.some((font) => font.source === 'substituted') ? ' (matched)' : ''}
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Corner radius</dt>
          <dd>
            {brand.cornerRadiusPx}px · {brand.cornerStyle}
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Visual language</dt>
          <dd>
            {brand.visualStyle} · {brand.layoutDensity}
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Motion</dt>
          <dd>{brand.motionStyle}</dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Gradients / glow</dt>
          <dd>
            {brand.allowsGradient ? 'yes' : 'no'} / {brand.allowsGlow ? 'yes' : 'no'}
          </dd>
        </div>
      </dl>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Saving…' : brand.confirmedByUser ? 'Update' : 'Looks good'}
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
  );
}
