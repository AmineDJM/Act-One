'use client';

import { useActionState } from 'react';
import { PRODUCT_PHASE_LABELS, type ProductConfig, type ProductPhase, type TrademarkStatus } from '@act-one/core';
import { saveProductAction, type ProductActionState } from './actions.ts';
import styles from '../admin.module.css';

const PHASE_NOTES: Record<ProductPhase, string> = {
  private_beta: 'By invitation. A code opens the door; people may request one. The public button says “Request access”.',
  public_beta: 'Anyone may create an account, and the site says it is a beta. The public button says “Join the beta”.',
  production: 'The commercial flow: sign up, pay, produce. The public button says “Start free”.',
};

const TRADEMARK_NOTES: Record<TrademarkStatus, string> = {
  none: 'The name alone.',
  pending: 'Act One™ — commercially claimed, not registered.',
  registered: 'Act One® — only once the registration is real and authorised for use.',
};

export function ProductForm({ config, phases, trademarks }: { config: ProductConfig; phases: readonly ProductPhase[]; trademarks: readonly TrademarkStatus[] }) {
  const [state, action, pending] = useActionState<ProductActionState, FormData>(saveProductAction, { error: null });
  return (
    <form action={action} className={styles.section} style={{ gap: 'var(--space-5)' }}>
      <fieldset className={styles.fieldset}>
        <legend>Phase</legend>
        {phases.map((phase) => (
          <label key={phase} className={styles.radioRow}>
            <input type="radio" name="phase" value={phase} defaultChecked={config.phase === phase} />
            <span>
              <strong>{PRODUCT_PHASE_LABELS[phase]}</strong>
              <span className="muted">{PHASE_NOTES[phase]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Invitations</legend>
        <label className={styles.checkRow}>
          <input type="checkbox" name="codesEnabled" defaultChecked={config.invites.codesEnabled} /> Invitation codes open the door in a private beta
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" name="applicationsEnabled" defaultChecked={config.invites.applicationsEnabled} /> People may request access
        </label>
        <label className="field">
          <span>What the request form asks</span>
          <input name="applicationPrompt" className="input" defaultValue={config.invites.applicationPrompt} maxLength={300} />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>The mark</legend>
        {trademarks.map((status) => (
          <label key={status} className={styles.radioRow}>
            <input type="radio" name="trademarkStatus" value={status} defaultChecked={config.trademarkStatus === status} />
            <span>
              <strong>{status}</strong>
              <span className="muted">{TRADEMARK_NOTES[status]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Landing page</legend>
        <div className={styles.formGrid}>
          <label className="field">
            <span>Eyebrow</span>
            <input name="eyebrow" className="input" defaultValue={config.landing.eyebrow} maxLength={80} />
          </label>
          <label className="field">
            <span>Headline</span>
            <input name="headline" className="input" defaultValue={config.landing.headline} maxLength={120} />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>Under the headline (empty for the page’s own paragraph)</span>
            <textarea name="subheadline" className="input" rows={2} defaultValue={config.landing.subheadline} maxLength={400} />
          </label>
          <label className="field">
            <span>Call to action</span>
            <input name="ctaLabel" className="input" defaultValue={config.landing.ctaLabel} maxLength={60} />
          </label>
          <label className="field">
            <span>Line while by invitation</span>
            <input name="exclusivityLine" className="input" defaultValue={config.landing.exclusivityLine} maxLength={200} />
          </label>
          <label className="field">
            <span>Line while in public beta</span>
            <input name="betaLine" className="input" defaultValue={config.landing.betaLine} maxLength={200} />
          </label>
        </div>
      </fieldset>

      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.error ? (
          <span className="error" role="alert">
            {state.error}
          </span>
        ) : state.message ? (
          <span className="hint" role="status">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
