'use client';

import { useActionState, useState } from 'react';
import { ReferralQualification, type ReferralProgram, type ReferralTier } from '@act-one/core';
import { saveReferralProgramAction, type ReferralActionState } from './actions.ts';
import styles from '../admin.module.css';

/**
 * The programme's rules, in one form.
 *
 * Every number the customer's page quotes is set here, including the ceiling
 * that keeps a referral programme from becoming a credit printer.
 */
export function ProgramForm({ program }: { program: ReferralProgram }) {
  const [state, save, saving] = useActionState<ReferralActionState, FormData>(saveReferralProgramAction, { error: null });
  const [tiers, setTiers] = useState<ReferralTier[]>(program.tiers);

  return (
    <form action={save} className={styles.section}>
      <h2>The rules</h2>
      <label className={styles.checkRow}>
        <input type="checkbox" name="enabled" defaultChecked={program.enabled} />
        <span>Run the referral programme. While this is off, links still work as invitations but nothing is counted or paid.</span>
      </label>

      <div className={styles.formGrid}>
        <label className="field">
          <span>Pay when the invited account</span>
          <select name="qualifyOn" className="input" defaultValue={program.qualifyOn}>
            {ReferralQualification.options.map((option) => (
              <option key={option} value={option}>
                {option === 'paid' ? 'starts paying' : 'produces its first film'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Credits to the inviter</span>
          <input name="inviterCredits" type="number" min={0} max={100000} defaultValue={program.inviterCredits} className="input" />
        </label>
        <label className="field">
          <span>Credits to the invited</span>
          <input name="invitedCredits" type="number" min={0} max={100000} defaultValue={program.invitedCredits} className="input" />
        </label>
        <label className="field">
          <span>Bonus when they first pay</span>
          <input name="paidBonusCredits" type="number" min={0} max={100000} defaultValue={program.paidBonusCredits} className="input" />
        </label>
        <label className="field">
          <span>Most rewarded per person (empty for no limit)</span>
          <input name="maxRewardedPerInviter" type="number" min={1} max={10000} defaultValue={program.maxRewardedPerInviter ?? ''} className="input" />
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend>Tiers</legend>
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          A one-off bonus the first time somebody reaches this many rewarded referrals.
        </p>
        {tiers.map((tier, index) => (
          <div key={index} className={styles.formGrid}>
            <label className="field">
              <span>At</span>
              <input name="tierAt" type="number" min={1} max={1000} defaultValue={tier.at} className="input" />
            </label>
            <label className="field">
              <span>Bonus credits</span>
              <input name="tierBonus" type="number" min={0} max={100000} defaultValue={tier.bonusCredits} className="input" />
            </label>
            <label className="field">
              <span>Label (optional)</span>
              <input name="tierLabel" defaultValue={tier.label} maxLength={80} className="input" />
            </label>
          </div>
        ))}
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn--ghost" onClick={() => setTiers((current) => [...current, { at: (current.at(-1)?.at ?? 0) + 5, bonusCredits: 500, label: '' }])}>
            Add a tier
          </button>
          {tiers.length > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setTiers((current) => current.slice(0, -1))}>
              Remove the last
            </button>
          ) : null}
        </div>
      </fieldset>

      <label className="field">
        <span>Headline on the customer&apos;s page</span>
        <input name="headline" className="input" defaultValue={program.headline} maxLength={120} />
      </label>
      <label className="field">
        <span>Terms, in one sentence</span>
        <input name="terms" className="input" defaultValue={program.terms} maxLength={600} />
      </label>

      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
      </div>
    </form>
  );
}
