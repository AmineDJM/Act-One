import Link from 'next/link';
import { LogLevel, LogSource, type LogQuery } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { LogRow } from './LogRow.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { key: '1h', label: 'Last hour', ms: 3_600_000 },
  { key: '24h', label: '24 hours', ms: 86_400_000 },
  { key: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 days', ms: 30 * 86_400_000 },
] as const;

/**
 * The operational log.
 *
 * Every customer-facing failure says "Something went wrong on our side.",
 * because internal failure text leaks implementation detail. That answer is
 * only defensible if somebody can find out what actually went wrong, and this
 * is where they look — not a worker's stdout on a machine that has since been
 * recycled.
 *
 * Filters live in the URL rather than in component state so an operator can
 * send a colleague the exact view they are looking at.
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');

  const windowKey = (WINDOWS.find((w) => w.key === read('window')) ?? WINDOWS[1]).key;
  const window = WINDOWS.find((w) => w.key === windowKey)!;
  const since = new Date(Date.now() - window.ms).toISOString();

  const level = LogLevel.safeParse(read('level'));
  const source = LogSource.safeParse(read('source'));
  const search = read('q').trim();

  const query: LogQuery = {
    since,
    limit: 300,
    ...(level.success ? { level: level.data } : {}),
    ...(source.success ? { source: source.data } : {}),
    ...(search ? { search } : {}),
    ...(read('project') ? { projectId: read('project') } : {}),
    ...(read('org') ? { organizationId: read('org') } : {}),
  };

  const store = getStore();
  const [events, counts, top] = await Promise.all([
    store.log.list(query),
    store.log.levelCounts(since),
    store.log.topEvents(since, 6),
  ]);

  /** Keeps every other filter when one changes. */
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && v) next.set(k, v);
    }
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    return qs ? `/admin/logs?${qs}` : '/admin/logs';
  };

  return (
    <>
      <header className={styles.head}>
        <h1>Logs</h1>
        <p className="lede">
          What the platform did, and why anything failed. Customers are told only that something
          went wrong — this is the rest of that sentence.
        </p>
      </header>

      <div className={styles.metrics}>
        {(['error', 'warn', 'info', 'debug'] as const).map((key) => (
          <Link
            key={key}
            href={withParam('level', level.success && level.data === key ? '' : key)}
            className={styles.metric}
            data-active={level.success && level.data === key ? 'true' : undefined}
            data-level={key}
          >
            <span className={styles.metricLabel}>{key}</span>
            <strong className={styles.metricValue}>{counts[key].toLocaleString()}</strong>
            <span className={styles.metricNote}>{window.label.toLowerCase()}</span>
          </Link>
        ))}
      </div>

      <form className={styles.filterBar} action="/admin/logs" method="get">
        <input type="hidden" name="window" value={windowKey} />
        {level.success ? <input type="hidden" name="level" value={level.data} /> : null}
        <input
          className="input"
          name="q"
          defaultValue={search}
          placeholder="Search message or event name"
          aria-label="Search logs"
        />
        <select className="input" name="source" defaultValue={source.success ? source.data : ''} aria-label="Source">
          <option value="">Every source</option>
          {LogSource.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button className="btn btn--secondary" type="submit">
          Filter
        </button>
        {search || source.success || level.success ? (
          <Link className="btn btn--ghost" href={`/admin/logs?window=${windowKey}`}>
            Clear
          </Link>
        ) : null}
      </form>

      <div className={styles.windowTabs} role="group" aria-label="Time window">
        {WINDOWS.map((option) => (
          <Link
            key={option.key}
            href={withParam('window', option.key)}
            data-active={option.key === windowKey ? 'true' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {top.length > 0 ? (
        <section className={styles.section}>
          <h2>Happening most</h2>
          <div className={styles.chipRow}>
            {top.map((row) => (
              <Link key={row.event} href={withParam('q', row.event)} className={styles.chip} data-level={row.level}>
                <code>{row.event}</code>
                <span>{row.count.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2>
          {events.length >= 300 ? 'Latest 300' : `${events.length.toLocaleString()} event${events.length === 1 ? '' : 's'}`}
        </h2>
        {events.length === 0 ? (
          <p className={styles.empty}>
            Nothing logged in this window. That is the good outcome.
          </p>
        ) : (
          <ol className={styles.logList}>
            {events.map((event) => (
              <LogRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
