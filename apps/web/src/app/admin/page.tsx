import Link from 'next/link';
import { creditsToUsd } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { PROVIDER_SLOTS, listProviderState } from '@/server/platform.ts';
import { BreakdownBars, Sparkline } from '@/components/Chart.tsx';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

/**
 * Operator overview.
 *
 * Ordered by what would ruin the business first. Margin, then whether the
 * platform is healthy, then volume — not signup counts, which look good on a
 * screenshot and tell an operator nothing they can act on.
 */
export default async function AdminOverview() {
  const store = getStore();
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
  const since = from.toISOString();

  const [organizations, users, jobStates, summary, series, providers, activeRenders, levels, topEvents] =
    await Promise.all([
      store.organizations.count(),
      store.users.count(),
      store.jobs.countByState(),
      store.costs.platformSummary(since),
      store.costs.dailySeries(since),
      listProviderState(),
      store.renders.listActive(20),
      store.log.levelCounts(since),
      store.log.topEvents(since, 5),
    ]);

  const revenue = creditsToUsd(summary.totalCreditsCharged);
  const margin = revenue - summary.totalCostUsd;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const failures = summary.byProvider.reduce((sum, p) => sum + p.failures, 0);
  const calls = summary.byProvider.reduce((sum, p) => sum + p.calls, 0);
  /*
   * Required and optional counted apart.
   *
   * This used to announce "5 integrations not configured", which makes a
   * platform one key away from working look broken — and contradicted the
   * integrations page, which correctly said one required integration was
   * missing. Only OpenAI is genuinely required; without the rest, research
   * falls back to a direct fetch, generative shots are skipped, and billing is
   * off. Those are configuration states, not failures.
   */
  const requiredSlots = new Set<string>(
    PROVIDER_SLOTS.filter((slot) => slot.required).map((slot) => slot.id),
  );
  const unconfigured = providers.filter((p) => !p.configured);
  const missingRequired = unconfigured.filter((p) => requiredSlots.has(p.id));
  const missingOptional = unconfigured.filter((p) => !requiredSlots.has(p.id));

  const usd = (value: number) => `$${value.toFixed(2)}`;
  const plain = (value: number) => value.toLocaleString('en-US');

  return (
    <>
      <header className={styles.head}>
        <h1>Overview</h1>
        <p className="lede">The last {WINDOW_DAYS} days.</p>
      </header>

      {missingRequired.length > 0 ? (
        <div className={styles.notice} data-tone="danger">
          <strong>
            {missingRequired.length === 1
              ? `${missingRequired[0]!.id} is not configured`
              : `${missingRequired.length} required integrations are not configured`}
          </strong>{' '}
          — nothing can be made until it is.{' '}
          <Link href="/admin/providers" style={{ color: 'var(--accent-text)' }}>
            Configure it →
          </Link>
        </div>
      ) : null}

      {missingOptional.length > 0 ? (
        <div className={styles.notice}>
          <strong>
            {missingOptional.length} optional integration{missingOptional.length === 1 ? '' : 's'}{' '}
            unset
          </strong>{' '}
          ({missingOptional.map((p) => p.id).join(', ')}) — the platform runs without{' '}
          {missingOptional.length === 1 ? 'it' : 'them'}, with those features off.{' '}
          <Link href="/admin/providers" style={{ color: 'var(--accent-text)' }}>
            Review →
          </Link>
        </div>
      ) : null}

      {levels.error > 0 ? (
        <div className={styles.notice} data-tone="danger">
          <strong>
            {plain(levels.error)} error{levels.error === 1 ? '' : 's'} logged
          </strong>{' '}
          in this window.{' '}
          <Link href="/admin/logs?level=error&window=30d" style={{ color: 'var(--accent-text)' }}>
            Read them →
          </Link>
        </div>
      ) : null}

      {/* Margin first: if this is negative, nothing else on the page matters. */}
      <div className={styles.metrics}>
        <Metric label="Gross margin" value={`${marginPct.toFixed(0)}%`} note={usd(margin)} />
        <Metric label="Credit revenue" value={usd(revenue)} note="What we charged customers" />
        <Metric label="Provider spend" value={usd(summary.totalCostUsd)} note="What vendors charged us" />
        <Metric
          label="Provider failures"
          value={calls > 0 ? `${((failures / calls) * 100).toFixed(1)}%` : '—'}
          note={`${plain(failures)} of ${plain(calls)} calls`}
        />
        <Metric label="Renders in flight" value={plain(activeRenders.length)} />
        <Metric
          label="Jobs queued"
          value={plain(jobStates['queued'] ?? 0)}
          note={`${plain(jobStates['failed'] ?? 0)} failed`}
        />
        <Metric label="Organisations" value={plain(organizations)} />
        <Metric label="Users" value={plain(users)} />
      </div>

      <div className={styles.chartPair}>
        <Sparkline
          label="Provider spend"
          data={series.map((row) => ({ day: row.day, value: row.costUsd }))}
          from={from}
          to={to}
          format={usd}
        />
        <Sparkline
          label="Credit revenue"
          data={series.map((row) => ({ day: row.day, value: creditsToUsd(row.creditsCharged) }))}
          from={from}
          to={to}
          format={usd}
          tone="positive"
        />
      </div>

      {failures > 0 ? (
        <div className={styles.chartPair}>
          <Sparkline
            label="Provider calls"
            data={series.map((row) => ({ day: row.day, value: row.calls }))}
            from={from}
            to={to}
            format={plain}
          />
          <Sparkline
            label="Provider failures"
            data={series.map((row) => ({ day: row.day, value: row.failures }))}
            from={from}
            to={to}
            format={plain}
            tone="danger"
          />
        </div>
      ) : null}

      <section className={styles.section}>
        <h2>Where the money goes</h2>
        {summary.byProvider.length === 0 ? (
          <p className={styles.empty}>No provider spend recorded yet.</p>
        ) : (
          <BreakdownBars
            rows={summary.byProvider.map((row) => ({
              label: row.provider,
              value: row.costUsd,
              ...(row.failures > 0
                ? { note: `${plain(row.failures)} of ${plain(row.calls)} calls failed` }
                : {}),
            }))}
            format={(value) => `$${value.toFixed(4)}`}
          />
        )}
      </section>

      <section className={styles.section}>
        <h2>What runs most</h2>
        {summary.byOperation.length === 0 ? (
          <p className={styles.empty}>Nothing yet.</p>
        ) : (
          <BreakdownBars
            rows={summary.byOperation.map((row) => ({
              label: row.operation,
              value: row.costUsd,
              note: `${plain(row.calls)} call${row.calls === 1 ? '' : 's'}`,
            }))}
            format={(value) => `$${value.toFixed(4)}`}
          />
        )}
      </section>

      {topEvents.length > 0 ? (
        <section className={styles.section}>
          <h2>What the platform has been doing</h2>
          <div className={styles.chipRow}>
            {topEvents.map((row) => (
              <Link
                key={row.event}
                href={`/admin/logs?q=${encodeURIComponent(row.event)}&window=30d`}
                className={styles.chip}
                data-level={row.level}
              >
                <code>{row.event}</code>
                <span>{plain(row.count)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
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
