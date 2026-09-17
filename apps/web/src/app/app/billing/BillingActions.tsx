'use client';

import { useActionState } from 'react';
import type { Plan } from '@act-one/core';
import { startCheckoutAction, openPortalAction, buyCreditsAction, type FormState } from './actions.ts';
import styles from '../app.module.css';

/** Kept in step with the pricing page, which leads with the same plan. */
const FEATURED_PLAN_ID = 'launch';

export function BillingActions({
  plans,
  currentPlanId,
  hasBillingAccount,
}: {
  plans: Plan[];
  currentPlanId: string;
  hasBillingAccount: boolean;
}) {
  const [checkoutState, checkout, checkingOut] = useActionState<FormState, FormData>(
    startCheckoutAction,
    { error: null },
  );
  const [portalState, portal, opening] = useActionState<FormState, FormData>(openPortalAction, {
    error: null,
  });
  const [creditState, buy, buying] = useActionState<FormState, FormData>(buyCreditsAction, {
    error: null,
  });

  const error = checkoutState.error ?? portalState.error ?? creditState.error;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Change your plan</h3>
      </div>

      {/*
        * Cards rather than a row of buttons. Three identical primary buttons
        * make every plan shout equally, which leaves somebody who does not
        * already know what they want with nothing to go on — so each plan
        * states what it actually buys, and only the recommended one is primary.
        */}
      <div className={styles.planRow}>
        {plans.map((plan) => {
          const current = plan.id === currentPlanId;
          // The same plan the pricing page leads with, so the two surfaces
          // never recommend different things to the same person.
          const featured = plan.id === FEATURED_PLAN_ID;
          return (
            <form action={checkout} key={plan.id} className={styles.planOption} data-current={current}>
              <input type="hidden" name="planId" value={plan.id} />
              <input type="hidden" name="interval" value="month" />

              <div className={styles.planOptionHead}>
                <strong>{plan.name}</strong>
                {featured ? <span className="badge">Most launches</span> : null}
              </div>

              <p className={styles.planPrice}>
                €{(plan.monthlyPriceCents / 100).toLocaleString('en-US')}
                <span>/month</span>
              </p>

              <ul className={styles.planFacts}>
                <li>
                  {plan.limits.projectsPerMonth < 0 ? 'Unlimited' : plan.limits.projectsPerMonth} project
                  {plan.limits.projectsPerMonth === 1 ? '' : 's'} a month
                </li>
                <li>Up to {plan.limits.maxMasterDurationSeconds}s per film</li>
                <li>{plan.limits.monthlyCredits.toLocaleString('en-US')} credits included</li>
                <li>
                  {plan.limits.maxSeats < 0 ? 'Unlimited' : plan.limits.maxSeats} seat
                  {plan.limits.maxSeats === 1 ? '' : 's'}
                </li>
              </ul>

              <button
                className={!current && featured ? 'btn' : 'btn btn--secondary'}
                type="submit"
                disabled={checkingOut || current}
              >
                {current ? 'Your plan' : checkingOut ? 'Opening…' : `Choose ${plan.name}`}
              </button>
            </form>
          );
        })}
      </div>

      <hr className="divider" />

      <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <form action={buy}>
          <input type="hidden" name="credits" value="500" />
          <button className="btn btn--secondary" type="submit" disabled={buying}>
            {buying ? 'Opening…' : 'Add 500 credits'}
          </button>
        </form>
        {hasBillingAccount ? (
          <form action={portal}>
            <button className="btn btn--ghost" type="submit" disabled={opening}>
              {opening ? 'Opening…' : 'Invoices & payment method'}
            </button>
          </form>
        ) : null}
      </div>

      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
