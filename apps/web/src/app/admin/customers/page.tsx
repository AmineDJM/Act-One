import { creditsToUsd, planById } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { getPlatformConfig } from '@/server/platform.ts';
import { CustomerControls } from './CustomerControls.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

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

  return (
    <>
      <header className={styles.head}>
        <h1>Customers</h1>
        <p className="lede">{organizations.length} organisations.</p>
      </header>

      {rows.length === 0 ? (
        <div className={styles.empty}>No organisations yet.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Plan</th>
              <th>Status</th>
              <th className={styles.num}>Projects</th>
              <th className={styles.num}>Seats</th>
              <th className={styles.num}>Credits</th>
              <th className={styles.num}>Our cost</th>
              <th className={styles.num}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const plan = planById(plans, row.organization.planId);
              const margin = row.revenue - row.spend;
              return (
                <tr key={row.organization.id}>
                  <td>
                    {row.organization.name}
                    <div className="muted mono" style={{ fontSize: '0.72rem' }}>
                      {row.organization.slug}
                    </div>
                  </td>
                  <td>{plan.name}</td>
                  <td>
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
                      {row.organization.isSuspended
                        ? 'suspended'
                        : (row.subscription?.status ?? 'free')}
                    </span>
                  </td>
                  <td className={styles.num}>{row.projects}</td>
                  <td className={styles.num}>{row.members}</td>
                  <td className={styles.num}>{row.organization.creditBalance.toLocaleString('en-US')}</td>
                  <td className={styles.num}>${row.spend.toFixed(2)}</td>
                  <td
                    className={styles.num}
                    style={{ color: margin < 0 ? 'var(--danger)' : undefined }}
                  >
                    ${margin.toFixed(2)}
                  </td>
                  <td>
                    <CustomerControls
                      organizationId={row.organization.id}
                      name={row.organization.name}
                      planId={row.organization.planId}
                      plans={plans.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
                      suspended={row.organization.isSuspended}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
