import { creditsToUsd } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { label: '24 hours', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

/**
 * Cost ledger.
 *
 * Estimated versus actual is shown side by side on purpose: a growing gap
 * between the two means our pre-render quotes are lying to customers, which
 * surfaces here long before it surfaces as a refund request.
 */
export default async function CostsPage() {
  const store = getStore();

  const windows = await Promise.all(
    WINDOWS.map(async (window) => {
      const since = new Date(Date.now() - window.days * 86_400_000).toISOString();
      const summary = await store.costs.platformSummary(since);
      const revenue = creditsToUsd(summary.totalCreditsCharged);
      return {
        ...window,
        summary,
        revenue,
        margin: revenue - summary.totalCostUsd,
        marginPct: revenue > 0 ? ((revenue - summary.totalCostUsd) / revenue) * 100 : 0,
      };
    }),
  );

  const thirtyDays = windows[windows.length - 1]!;

  return (
    <>
      <header className={styles.head}>
        <h1>Costs & margin</h1>
        <p className="lede">
          What vendors charged us against what we charged customers. Credits are the only thing a
          customer ever sees; this is the reconciliation behind them.
        </p>
      </header>

      <div className={styles.metrics}>
        {windows.map((window) => (
          <div key={window.label} className={styles.metric}>
            <span className={styles.metricLabel}>{window.label}</span>
            <span className={styles.metricValue}>${window.summary.totalCostUsd.toFixed(2)}</span>
            <span className={styles.metricNote}>
              {window.revenue > 0
                ? `${window.marginPct.toFixed(0)}% margin on $${window.revenue.toFixed(2)}`
                : 'No credit revenue'}
            </span>
          </div>
        ))}
      </div>

      <section>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-4)' }}>
          By operation — last 30 days
        </h2>
        {thirtyDays.summary.byOperation.length === 0 ? (
          <div className={styles.empty}>
            No spend recorded yet. Every paid provider call writes a ledger entry automatically, so
            this fills in as soon as the first project runs.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Operation</th>
                <th className={styles.num}>Calls</th>
                <th className={styles.num}>Total</th>
                <th className={styles.num}>Average</th>
              </tr>
            </thead>
            <tbody>
              {thirtyDays.summary.byOperation.map((row) => (
                <tr key={row.operation}>
                  <td className="mono">{row.operation}</td>
                  <td className={styles.num}>{row.calls.toLocaleString('en-US')}</td>
                  <td className={styles.num}>${row.costUsd.toFixed(4)}</td>
                  <td className={styles.num}>
                    ${row.calls > 0 ? (row.costUsd / row.calls).toFixed(4) : '0.0000'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
