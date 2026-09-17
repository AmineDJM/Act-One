import Link from 'next/link';
import { creditsToUsd } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { listProviderState } from '@/server/platform.ts';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Operator overview.
 *
 * Deliberately the numbers that decide whether this business works — margin,
 * cost per film, failure rate — rather than vanity counts. If gross margin is
 * negative, nothing else on this page matters.
 */
export default async function AdminOverview() {
  const store = getStore();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [organizations, users, jobStates, summary, providers, activeRenders] = await Promise.all([
    store.organizations.count(),
    store.users.count(),
    store.jobs.countByState(),
    store.costs.platformSummary(since),
    listProviderState(),
    store.renders.listActive(20),
  ]);

  const revenue = creditsToUsd(summary.totalCreditsCharged);
  const margin = revenue - summary.totalCostUsd;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const failures = summary.byProvider.reduce((sum, p) => sum + p.failures, 0);
  const calls = summary.byProvider.reduce((sum, p) => sum + p.calls, 0);
  const unconfigured = providers.filter((p) => !p.configured);

  return (
    <>
      <header className={styles.head}>
        <h1>Overview</h1>
        <p className="lede">Last 30 days.</p>
      </header>

      {unconfigured.length > 0 ? (
        <div className={styles.notice}>
          <strong>{unconfigured.length} integration{unconfigured.length === 1 ? '' : 's'} not configured</strong>{' '}
          ({unconfigured.map((p) => p.id).join(', ')}).{' '}
          <Link href="/admin/providers" style={{ color: 'var(--accent-text)' }}>
            Configure them →
          </Link>
        </div>
      ) : null}

      <div className={styles.metrics}>
        <Metric label="Organisations" value={organizations.toLocaleString('en-US')} />
        <Metric label="Users" value={users.toLocaleString('en-US')} />
        <Metric
          label="Provider spend"
          value={`$${summary.totalCostUsd.toFixed(2)}`}
          note="What vendors charged us"
        />
        <Metric
          label="Credit revenue"
          value={`$${revenue.toFixed(2)}`}
          note="What we charged customers"
        />
        <Metric
          label="Gross margin"
          value={`${marginPct.toFixed(0)}%`}
          note={`$${margin.toFixed(2)}`}
        />
        <Metric
          label="Provider failures"
          value={calls > 0 ? `${((failures / calls) * 100).toFixed(1)}%` : '—'}
          note={`${failures} of ${calls} calls`}
        />
        <Metric label="Renders in flight" value={String(activeRenders.length)} />
        <Metric
          label="Jobs queued"
          value={String(jobStates['queued'] ?? 0)}
          note={`${jobStates['failed'] ?? 0} failed`}
        />
      </div>

      <section style={{ marginBottom: 'var(--space-7)' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-4)' }}>Spend by provider</h2>
        {summary.byProvider.length === 0 ? (
          <div className={styles.empty}>No provider spend recorded yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th className={styles.num}>Calls</th>
                <th className={styles.num}>Failures</th>
                <th className={styles.num}>Cost</th>
                <th className={styles.num}>Share</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProvider.map((row) => (
                <tr key={row.provider}>
                  <td>{row.provider}</td>
                  <td className={styles.num}>{row.calls.toLocaleString('en-US')}</td>
                  <td className={styles.num}>{row.failures}</td>
                  <td className={styles.num}>${row.costUsd.toFixed(4)}</td>
                  <td className={styles.num}>
                    {summary.totalCostUsd > 0
                      ? `${((row.costUsd / summary.totalCostUsd) * 100).toFixed(0)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-4)' }}>Spend by operation</h2>
        {summary.byOperation.length === 0 ? (
          <div className={styles.empty}>Nothing yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Operation</th>
                <th className={styles.num}>Calls</th>
                <th className={styles.num}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.byOperation.map((row) => (
                <tr key={row.operation}>
                  <td className="mono">{row.operation}</td>
                  <td className={styles.num}>{row.calls.toLocaleString('en-US')}</td>
                  <td className={styles.num}>${row.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
      {note ? <span className={styles.metricNote}>{note}</span> : null}
    </div>
  );
}
