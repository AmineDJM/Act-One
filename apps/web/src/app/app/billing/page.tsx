import type { Metadata } from 'next';
import { creditsToUsd, effectivePlan } from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { getPlatformConfig } from '@/server/platform.ts';
import { BillingActions } from './BillingActions.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Billing · Act One' };

export default async function BillingPage() {
  const session = await requireSessionForPage('/app/billing');
  const store = getStore();

  const [organization, subscription, payments, { plans }] = await Promise.all([
    store.organizations.get(session.organizationId),
    store.subscriptions.getForOrganization(session.organizationId),
    store.payments.listForOrganization(session.organizationId, 24),
    getPlatformConfig(),
  ]);
  if (!organization) return null;

  /*
   * The plan actually in force, not the one the row remembers.
   *
   * This page used to read the plan id straight off the subscription, which
   * showed Pro to a workspace whose card had failed — the entitlement layer
   * had already dropped them to free, so the page was telling them they had
   * something the product was refusing them. `effectivePlan` is the same
   * answer the rest of the app uses, lifted limits and all.
   */
  const plan = effectivePlan({
    plans,
    organization,
    subscription: subscription ? { planId: subscription.planId, status: subscription.status } : null,
  });
  const spend = await store.costs.totalForOrganization(session.organizationId);

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Billing</h1>
          <p className="secondary" style={{ marginTop: 'var(--space-2)' }}>
            You are on {plan.name}.
          </p>
        </div>
        {subscription ? (
          <span className={`badge ${subscription.status === 'active' ? 'badge--ok' : 'badge--warn'}`}>
            {subscription.status}
          </span>
        ) : (
          // A paid plan with no subscription behind it is not "free": it is a
          // workspace somebody put on a plan by hand, and saying free beside
          // €4,490/mo reads as a bug.
          <span className="badge">{plan.monthlyPriceCents === 0 ? 'free' : 'not billed'}</span>
        )}
      </div>

      <div className={styles.panels}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Plan</h3>
            <span className="mono secondary">
              {plan.monthlyPriceCents === 0
                ? 'Free'
                : `€${(plan.monthlyPriceCents / 100).toLocaleString('en-US')}/mo`}
            </span>
          </div>
          <dl className={styles.kv}>
            <div className={styles.kvRow}>
              <dt>Productions</dt>
              <dd>
                {plan.limits.projectsPerMonth < 0 ? 'Unlimited' : `${plan.limits.projectsPerMonth}/month`}
              </dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Films per production</dt>
              <dd>{plan.limits.rendersPerProject < 0 ? 'Unlimited' : plan.limits.rendersPerProject}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Revisions per production</dt>
              <dd>
                {plan.entitlements.includes('revisions.unlimited') || plan.limits.revisionsPerProject < 0
                  ? 'Unlimited'
                  : plan.limits.revisionsPerProject}
              </dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Max runtime</dt>
              <dd>{plan.limits.maxMasterDurationSeconds}s</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Seats</dt>
              <dd>{plan.limits.maxSeats < 0 ? 'Unlimited' : plan.limits.maxSeats}</dd>
            </div>
            {subscription?.currentPeriodEnd ? (
              <div className={styles.kvRow}>
                <dt>{subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</dt>
                <dd>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Production credits</h3>
            <span className="mono secondary">
              {organization.creditBalance.toLocaleString('en-US')}
            </span>
          </div>
          <p className="secondary" style={{ fontSize: '0.9rem' }}>
            Production credits cover the expensive work: cinematography, 3D, extra cuts and extra
            languages. Your plan includes{' '}
            {plan.limits.monthlyCredits.toLocaleString('en-US')} a month.
          </p>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Roughly €{creditsToUsd(organization.creditBalance).toFixed(2)} of production work
            remaining.
          </p>
        </section>
      </div>

      {payments.length > 0 ? (
        <section className={styles.panel} style={{ marginTop: 'var(--space-6)' }}>
          <div className={styles.panelHead}>
            <h3>Receipts</h3>
            <span className="mono secondary">{payments.length}</span>
          </div>
          <dl className={styles.kv}>
            {payments.map((payment) => (
              <div key={payment.id} className={styles.kvRow}>
                <dt>
                  {new Date(payment.createdAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  · {payment.description || payment.kind}
                </dt>
                <dd>
                  {payment.status === 'succeeded'
                    ? `€${(payment.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                    : payment.status}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div style={{ marginTop: 'var(--space-6)' }}>
        <BillingActions
          plans={plans.filter((candidate) => candidate.isPublic && candidate.monthlyPriceCents > 0)}
          currentPlanId={plan.id}
          hasBillingAccount={Boolean(organization.stripeCustomerId)}
        />
      </div>

      {session.user.isSuperAdmin ? (
        <p className="muted" style={{ marginTop: 'var(--space-6)', fontSize: '0.82rem' }}>
          Staff note: this workspace has consumed ${spend.toFixed(4)} of provider spend.
        </p>
      ) : null}
    </>
  );
}
