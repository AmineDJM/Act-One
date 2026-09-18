'use client';

import { useActionState, useState } from 'react';
import { Entitlement, type Plan } from '@act-one/core';
import { savePlanAction, type ActionResult } from '../actions.ts';
import styles from '../admin.module.css';

/**
 * Plan editor.
 *
 * Prices and entitlements are data, so changing what a tier unlocks is a form
 * submission rather than a deploy. Feature code only ever asks "does this
 * organisation have this entitlement", never "is this the pro plan", which is
 * what makes editing safe.
 */
export function PlanEditor({ plan }: { plan: Plan }) {
  const [result, save, saving] = useActionState<ActionResult | null, FormData>(savePlanAction, null);
  const [open, setOpen] = useState(false);

  return (
    <form action={save} className={styles.plan}>
      <input type="hidden" name="planId" value={plan.id} />

      <div className={styles.planHead}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`${plan.id}-name`}>Plan</label>
          <input id={`${plan.id}-name`} name="name" className="input" defaultValue={plan.name} />
        </div>
        <span className={styles.planPrice}>
          €{(plan.monthlyPriceCents / 100).toLocaleString('en-US')}
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${plan.id}-desc`}>Description</label>
        <input id={`${plan.id}-desc`} name="description" className="input" defaultValue={plan.description} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="field">
          <label htmlFor={`${plan.id}-monthly`}>Monthly (€)</label>
          <input
            id={`${plan.id}-monthly`}
            name="monthlyPrice"
            className="input"
            type="number"
            min="0"
            step="1"
            defaultValue={plan.monthlyPriceCents / 100}
          />
        </div>
        <div className="field">
          <label htmlFor={`${plan.id}-yearly`}>Yearly (€)</label>
          <input
            id={`${plan.id}-yearly`}
            name="yearlyPrice"
            className="input"
            type="number"
            min="0"
            step="1"
            defaultValue={plan.yearlyPriceCents / 100}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Edit'} limits & entitlements
      </button>

      {open ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <LimitField planId={plan.id} name="projectsPerMonth" label="Projects / month" value={plan.limits.projectsPerMonth} />
            <LimitField planId={plan.id} name="rendersPerProject" label="Renders / project" value={plan.limits.rendersPerProject} />
            <LimitField planId={plan.id} name="revisionsPerProject" label="Revisions / project" value={plan.limits.revisionsPerProject} />
            <LimitField planId={plan.id} name="maxMasterDurationSeconds" label="Max runtime (s)" value={plan.limits.maxMasterDurationSeconds} />
            <LimitField planId={plan.id} name="maxSeats" label="Seats" value={plan.limits.maxSeats} />
            <LimitField planId={plan.id} name="maxBrands" label="Brands" value={plan.limits.maxBrands} />
            <LimitField planId={plan.id} name="monthlyCredits" label="Credits / month" value={plan.limits.monthlyCredits} />
            <LimitField
              planId={plan.id}
              name="maxGenerativeSecondsPerFilm"
              label="Generated seconds"
              value={plan.limits.maxGenerativeSecondsPerFilm}
            />
          </div>
          <p className="hint">−1 means unlimited.</p>

          <div className={styles.entitlements}>
            {Entitlement.options.map((entitlement) => {
              const enabled = plan.entitlements.includes(entitlement);
              return (
                <label key={entitlement} className={styles.entitlement} data-on={enabled}>
                  <input
                    type="checkbox"
                    name="entitlements"
                    value={entitlement}
                    defaultChecked={enabled}
                    style={{ marginRight: 4 }}
                  />
                  {entitlement}
                </label>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="field">
              <label htmlFor={`${plan.id}-spm`}>Stripe monthly price id</label>
              <input
                id={`${plan.id}-spm`}
                name="stripeMonthlyPriceId"
                className="input"
                placeholder="price_… (optional)"
                defaultValue={plan.stripeMonthlyPriceId ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor={`${plan.id}-spy`}>Stripe yearly price id</label>
              <input
                id={`${plan.id}-spy`}
                name="stripeYearlyPriceId"
                className="input"
                placeholder="price_… (optional)"
                defaultValue={plan.stripeYearlyPriceId ?? ''}
              />
            </div>
          </div>
          <p className="hint">
            Leave blank and Checkout prices the plan inline from the amounts above.
          </p>
        </>
      ) : null}

      <label className="row" style={{ gap: 'var(--space-3)' }}>
        <input type="checkbox" name="isPublic" defaultChecked={plan.isPublic} />
        <span className="secondary" style={{ fontSize: '0.88rem' }}>
          Show on the pricing page
        </span>
      </label>

      <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'auto' }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {result ? (
          <span className={styles.verdict} data-ok={result.ok} role="status">
            {result.ok ? '✓ ' : '✕ '}
            {result.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function LimitField({
  planId,
  name,
  label,
  value,
}: {
  planId: string;
  name: string;
  label: string;
  value: number;
}) {
  return (
    <div className="field">
      <label htmlFor={`${planId}-${name}`}>{label}</label>
      <input id={`${planId}-${name}`} name={name} className="input" type="number" defaultValue={value} />
    </div>
  );
}
