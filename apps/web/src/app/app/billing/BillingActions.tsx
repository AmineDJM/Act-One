'use client';

import { useActionState } from 'react';
import type { Plan } from '@act-one/core';
import { startCheckoutAction, openPortalAction, buyCreditsAction, type FormState } from './actions.ts';
import styles from '../app.module.css';

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

      <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {plans.map((plan) => (
          <form action={checkout} key={plan.id}>
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="interval" value="month" />
            <button
              className={plan.id === currentPlanId ? 'btn btn--secondary' : 'btn'}
              type="submit"
              disabled={checkingOut || plan.id === currentPlanId}
            >
              {plan.id === currentPlanId
                ? `Current: ${plan.name}`
                : `${plan.name} — €${(plan.monthlyPriceCents / 100).toLocaleString('en-US')}/mo`}
            </button>
          </form>
        ))}
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
