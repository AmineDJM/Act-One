import Link from 'next/link';
import { JobKind, JobState, jobIsTerminal, type Job } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { key: '24h', label: '24 hours', ms: 86_400_000 },
  { key: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { key: 'all', label: 'All', ms: 0 },
] as const;

/**
 * Every job the platform ran.
 *
 * The customer's project page says what is happening in nine human steps.
 * This is the other side of that: the queue as it is — kind, state, worker,
 * attempts, timings, the last error verbatim — for the people who hold the
 * keys. Nothing here is ever shown to a customer.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');
  const windowKey = (WINDOWS.find((w) => w.key === read('window')) ?? WINDOWS[0]).key;
  const window = WINDOWS.find((w) => w.key === windowKey)!;
  const state = JobState.safeParse(read('state'));
  const kind = JobKind.safeParse(read('kind'));

  const store = getStore();
  const [jobs, counts] = await Promise.all([
    store.jobs.listRecent({
      ...(window.ms > 0 ? { since: new Date(Date.now() - window.ms).toISOString() } : {}),
      ...(state.success ? { state: state.data } : {}),
      ...(kind.success ? { kind: kind.data } : {}),
      ...(read('project') ? { projectId: read('project') } : {}),
      ...(read('org') ? { organizationId: read('org') } : {}),
      limit: 200,
    }),
    store.jobs.countByState(),
  ]);

  const projectIds = [...new Set(jobs.map((job) => job.projectId).filter((id): id is string => id !== null))];
  const names = new Map<string, string>();
  await Promise.all(
    projectIds.map(async (id) => {
      const job = jobs.find((candidate) => candidate.projectId === id)!;
      const project = await store.projects.get(job.organizationId, id);
      if (project) names.set(id, project.name);
    }),
  );

  const href = (over: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ window: windowKey, state: read('state'), kind: read('kind'), project: read('project'), org: read('org'), ...over })) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/admin/jobs?${query}` : '/admin/jobs';
  };

  return (
    <>
      <header className={styles.head}>
        <h1>Jobs</h1>
        <p className="lede">
          The queue as it is. {Object.entries(counts).map(([name, count]) => `${count} ${name}`).join(' · ') || 'Nothing queued yet.'}
        </p>
      </header>

      <div className={styles.filterBar}>
        <nav className={styles.windowTabs} aria-label="Window">
          {WINDOWS.map((entry) => (
            <Link key={entry.key} href={href({ window: entry.key })} data-active={entry.key === windowKey ? 'true' : 'false'}>
              {entry.label}
            </Link>
          ))}
        </nav>
        <nav className={styles.windowTabs} aria-label="State">
          <Link href={href({ state: '' })} data-active={!state.success ? 'true' : 'false'}>
            Any state
          </Link>
          {JobState.options.map((option) => (
            <Link key={option} href={href({ state: option })} data-active={state.success && state.data === option ? 'true' : 'false'}>
              {option}
            </Link>
          ))}
        </nav>
        <form method="get" className="row" style={{ gap: 'var(--space-2)' }}>
          <input type="hidden" name="window" value={windowKey} />
          {state.success ? <input type="hidden" name="state" value={state.data} /> : null}
          <select name="kind" className="input" defaultValue={kind.success ? kind.data : ''} aria-label="Kind">
            <option value="">Any kind</option>
            {JobKind.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn--secondary">
            Filter
          </button>
        </form>
      </div>

      {jobs.length === 0 ? (
        <p className={styles.empty}>No jobs match.</p>
      ) : (
        <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Job</th>
              <th>Kind</th>
              <th>State</th>
              <th>Project</th>
              <th className={styles.num}>Attempts</th>
              <th>Started</th>
              <th className={styles.num}>Took</th>
              <th>Worker</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link href={`/admin/jobs/${job.id}`} className="mono">
                    {job.id.slice(-10)}
                  </Link>
                </td>
                <td className="mono">{job.kind}</td>
                <td>
                  <span className={`badge ${badgeFor(job.state)}`}>{job.state}</span>
                </td>
                <td>
                  {job.projectId ? (
                    <Link href={`/app/projects/${job.projectId}`}>{names.get(job.projectId) ?? job.projectId.slice(-8)}</Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className={styles.num}>
                  {job.attempts}/{job.maxAttempts}
                </td>
                <td className="mono">{job.startedAt ? new Date(job.startedAt).toLocaleString('en-GB', { hour12: false }) : '—'}</td>
                <td className={styles.num}>{took(job)}</td>
                <td className="mono">{job.lockedBy ?? '—'}</td>
                <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.lastError ?? ''}>
                  {job.lastError ? job.lastError.slice(0, 120) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}

export function badgeFor(state: Job['state']): string {
  return state === 'completed' ? 'badge--ok' : state === 'failed' || state === 'canceled' ? 'badge--bad' : state === 'queued' ? '' : 'badge--warn';
}

export function took(job: Pick<Job, 'startedAt' | 'updatedAt' | 'state'>): string {
  if (!job.startedAt) return '—';
  const end = !jobIsTerminal(job.state) && job.state !== 'queued' ? Date.now() : Date.parse(job.updatedAt);
  const ms = Math.max(0, end - Date.parse(job.startedAt));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}
