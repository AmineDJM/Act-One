import { creditsToUsd, planById } from '@act-one/core';
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
            const plan = planById(plans, row.organization.planId);
            const margin = row.revenue - row.spend;
            const status = row.organization.isSuspended
              ? 'suspended'
              : (row.subscription?.status ?? 'free');

            return (
              <li key={row.organization.id} className={styles.customerRow}>
                <div className={styles.customerIdentity}>
                  <strong>{row.organization.name}</strong>
                  <span className="mono">{row.organization.slug}</span>
                </div>

                <span
                  className={`badge ${
                    row.organization.isSuspended
                      ? 'badge--bad'
                      : row.subscription?.status === 'past_due'
                        ? 'badge--warn'
                        : row.subscription
                          ? 'badge--ok'
                          : ''
                  }`}
                >
                  {status}
                </span>

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
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
