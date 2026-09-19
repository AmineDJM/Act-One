import {
  INTERNAL_PLAN,
  creditsToUsd,
  planById,
  withGrants,
  type Organization,
  type Subscription,
} from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { getPlatformConfig } from '@/server/platform.ts';
import { CustomerControls } from './CustomerControls.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Every workspace, with what it costs us next to what it pays.
 *
 * A row rather than a table cell, because each one carries live controls —
 * plan, credits, suspension — and an editor folded into a table cell stretches
 * its row and squashes every column beside it.
 */
export default async function CustomersPage() {
  const store = getStore();
  const [organizations, { plans }] = await Promise.all([
    store.organizations.list(100),
    getPlatformConfig(),
  ]);

  const rows = await Promise.all(
    organizations.map(async (organization) => {
      const [projects, members, spend, subscription] = await Promise.all([
        store.projects.list(organization.id, { includeArchived: true }),
        store.memberships.countForOrganization(organization.id),
        store.costs.totalForOrganization(organization.id),
        store.subscriptions.getForOrganization(organization.id),
      ]);
      const revenue = projects.reduce((sum, project) => sum + creditsToUsd(project.creditsSpent), 0);
      return { organization, projects: projects.length, members, spend, revenue, subscription };
    }),
  );

  const planOptions = plans.map((plan) => ({ id: plan.id, name: plan.name }));

  return (
    <>
      <header className={styles.head}>
        <h1>Customers</h1>
        <p className="lede">
          {organizations.length} workspace{organizations.length === 1 ? '' : 's'}. Margin is what
          they spent in credits against what their work cost us.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>No workspaces yet.</p>
      ) : (
        <ul className={styles.customerList}>
          {rows.map((row) => {
            /*
             * What the workspace is actually on, grants and all — which is
             * what the operator is looking at when they open the drawer. The
             * plan alone would say "Free" for a workspace running on lifted
             * limits, and the grant control beside it would show numbers that
             * contradict it.
             */
            const plan = row.organization.isInternal
              ? INTERNAL_PLAN
              : withGrants(planById(plans, row.organization.planId), row.organization);
            const margin = row.revenue - row.spend;
            const status = statusOf(row.organization, row.subscription);

            return (
              <li key={row.organization.id} className={styles.customerRow}>
                <div className={styles.customerIdentity}>
                  <strong>{row.organization.name}</strong>
                  <span className="mono">{row.organization.slug}</span>
                </div>

                <span className={`badge ${BADGE_TONE[status]}`}>{status}</span>

                <dl className={styles.customerFigures}>
                  <div>
                    <dt>Plan</dt>
                    <dd>{plan.name}</dd>
                  </div>
                  <div>
                    <dt>Projects</dt>
                    <dd>{row.projects.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt>Seats</dt>
                    <dd>{row.members.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt>Credits</dt>
                    <dd>{row.organization.creditBalance.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt>Our cost</dt>
                    <dd>${row.spend.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Margin</dt>
                    <dd style={margin < 0 ? { color: 'var(--danger)' } : undefined}>
                      ${margin.toFixed(2)}
                    </dd>
                  </div>
                </dl>

                <CustomerControls
                  organizationId={row.organization.id}
                  name={row.organization.name}
                  planId={row.organization.planId}
                  plans={planOptions}
                  suspended={row.organization.isSuspended}
                  internal={row.organization.isInternal}
                  limitOverrides={row.organization.limitOverrides}
                  planLimits={plan.limits}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * How a workspace stands with us, in one word.
 *
 * Internal comes first, because it answers a different question: an operator
 * scanning this list wants to know which rows are customers, and one of ours
 * showing "free" among the real free accounts is how an internal workspace
 * gets counted in a churn number or suspended by mistake.
 *
 * "Unbilled" is a paid plan with nothing billing it — an operator put them
 * there by hand, or a Stripe subscription never arrived. One is a decision and
 * the other is revenue not being collected, and "free" beside a Studio plan
 * says neither.
 */
type CustomerStatus = 'ours' | 'suspended' | 'free' | 'unbilled' | Subscription['status'];

function statusOf(organization: Organization, subscription: Subscription | null): CustomerStatus {
  if (organization.isInternal) return 'ours';
  if (organization.isSuspended) return 'suspended';
  if (subscription) return subscription.status;
  return organization.planId === 'free' ? 'free' : 'unbilled';
}

const BADGE_TONE: Record<CustomerStatus, string> = {
  ours: 'badge--ok',
  suspended: 'badge--bad',
  active: 'badge--ok',
  trialing: 'badge--ok',
  past_due: 'badge--warn',
  unbilled: 'badge--warn',
  canceled: '',
  incomplete: 'badge--warn',
  none: '',
  free: '',
};
