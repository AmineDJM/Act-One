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

  /*
   * What of this is a price, and what is the ledger's own guess.
   *
   * A model missing from the price table is billed at the dearest rate on
   * record — the safe direction — and used to enter the ledger looking exactly
   * like a measured cost. Totals built on it read as fact. The guessed portion
   * is separated here rather than folded in, because a number somebody acts on
   * has to say how much of itself it invented.
   */
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = await store.costs.listSince(since);
  const guessed = recent.filter((cost) => cost.costBasis === 'unknown_price');
  const guessedUsd = guessed.reduce((sum, cost) => sum + cost.actualCostUsd, 0);
  const unpriced = [...new Set(guessed.map((cost) => `${cost.provider}/${cost.model ?? 'unnamed'}`))].sort();

  return (
    <>
      <header className={styles.head}>
        <h1>Costs & margin</h1>
        <p className="lede">
          What vendors charged us against what we charged customers. Credits are the only thing a
          customer ever sees; this is the reconciliation behind them.
        </p>
      </header>

      {unpriced.length > 0 ? (
        <section className={styles.panel} style={{ marginBottom: 'var(--space-5)' }}>
          <div className={styles.panelHead}>
            <h3>UNKNOWN_PRICE</h3>
            <span className="badge badge--warn">${guessedUsd.toFixed(2)} of the last 30 days</span>
          </div>
          <p className="muted">
            {guessed.length} call{guessed.length === 1 ? '' : 's'} on{' '}
            {unpriced.length} model{unpriced.length === 1 ? '' : 's'} with no rate on record. They
            were charged at the dearest rate we know, which is a guess in the safe direction and
            still a guess — every total on this page includes it. Set the real rates in{' '}
            <a href="/admin/providers">Integrations</a> and this disappears.
          </p>
          <ul className={styles.list}>
            {unpriced.map((model) => (
              <li key={model} className="mono">
                {model}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
