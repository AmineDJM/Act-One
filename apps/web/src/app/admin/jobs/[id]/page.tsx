import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GENERATION_STEPS, jobIsTerminal, type GenerationCost, type JobEvent } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { LogRow } from '../../logs/LogRow.tsx';
import { badgeFor, took } from '../format.ts';
import styles from '../../admin.module.css';

export const dynamic = 'force-dynamic';

/*
 * What a customer would have read for this code, so an operator answering
 * "what did they see?" does not have to go and look.
 */
const NOTICE_FOR_OPERATOR: Record<string, string> = {
  provider_unavailable: 'Production paused',
  rate_limited: 'Production paused',
  timeout: 'Production paused',
  upstream_error: 'Production paused',
  unavailable: 'Production paused',
  entitlement_required: 'Payment requires attention',
  payment_required: 'Payment requires attention',
  insufficient_credits: 'Payment requires attention',
  plan_limit: 'Payment requires attention',
};

/**
 * One job, all the way down.
 *
 * What the customer saw as a step: its state and timings, every attempt,
 * the last error verbatim, the payload, the provider calls made while it
 * ran with their models, costs and browser session ids, the curated lines
 * it wrote for the customer, and the operational log entries that name it.
 * Nothing here reaches the product.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const job = await store.jobs.getAny(id);
  if (!job) notFound();

  const [organization, project, events, logs, costs] = await Promise.all([
    store.organizations.get(job.organizationId),
    job.projectId ? store.projects.get(job.organizationId, job.projectId) : null,
    store.jobEvents.listForJob(job.organizationId, job.id),
    store.log.list({ jobId: job.id, limit: 200 }),
    job.projectId ? store.costs.listForProject(job.organizationId, job.projectId) : [],
  ]);

  // Provider calls while this job ran: the ledger has no job id, and the
  // window is the honest join — a render's calls happen inside the render.
  const from = job.startedAt ? Date.parse(job.startedAt) - 1000 : null;
  const to = !jobIsTerminal(job.state) && job.state !== 'queued' ? Date.now() : Date.parse(job.updatedAt) + 1000;
  const calls = from === null ? [] : costs.filter((cost) => Date.parse(cost.createdAt) >= from && Date.parse(cost.createdAt) <= to).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sessions = [...new Set(calls.map((call) => (typeof call.metadata['sessionId'] === 'string' ? call.metadata['sessionId'] : null)).filter((value): value is string => value !== null))];
  const spend = calls.reduce((sum, call) => sum + call.actualCostUsd, 0);
  // A job may stand behind more than one of the customer's steps: a render
  // is captures, motion and the final composition at once.
  const steps = GENERATION_STEPS.filter((candidate) => (candidate.kinds as readonly string[]).includes(job.kind)).map((candidate) => candidate.label);

  return (
    <>
      <header className={styles.head}>
        <p className="mono muted" style={{ fontSize: '0.78rem' }}>
          <Link href="/admin/jobs">Jobs</Link> / {job.id}
        </p>
        <h1 style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono">{job.kind}</span>
          <span className={`badge ${badgeFor(job.state)}`}>{job.state}</span>
        </h1>
        <p className="lede">
          {steps.length > 0 ? `Shown to the customer as ${steps.map((label) => `“${label}”`).join(', ')}. ` : ''}
          {organization ? organization.name : job.organizationId}
          {project ? (
            <>
              {' · '}
              <Link href={`/app/projects/${project.id}`}>{project.name}</Link>
            </>
          ) : null}
        </p>
      </header>

      <div className={styles.metrics}>
        <Metric label="Attempts" value={`${job.attempts} / ${job.maxAttempts}`} note={job.lastError ? 'last failed' : 'no failures'} />
        <Metric label="Took" value={took(job)} note={job.startedAt ? `started ${new Date(job.startedAt).toLocaleString('en-GB', { hour12: false })}` : 'not started'} />
        <Metric label="Provider calls" value={String(calls.length)} note={calls.length > 0 ? `$${spend.toFixed(4)} · ${calls.filter((call) => !call.succeeded).length} failed` : 'none in the window'} />
        <Metric label="Worker" value={job.lockedBy ?? '—'} note={job.lockedAt ? `locked ${new Date(job.lockedAt).toLocaleTimeString('en-GB', { hour12: false })}` : 'unlocked'} />
      </div>

      {job.lastError ? (
        <section className={styles.section}>
          <h2>Last error</h2>
          {/* The category decides what the customer was told; the prose is for you. */}
          {job.lastErrorCode ? (
            <p className="mono muted" style={{ fontSize: '0.8rem' }}>
              {job.lastErrorCode} · the production page showed {NOTICE_FOR_OPERATOR[job.lastErrorCode] ?? 'Production interrupted'}
            </p>
          ) : null}
          <pre className={styles.raw}>{job.lastError}</pre>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2>Facts</h2>
        <dl className={styles.facts}>
          <Fact label="Job id" value={job.id} />
          <Fact label="Organisation" value={job.organizationId} />
          <Fact label="Project" value={job.projectId ?? '—'} />
          <Fact label="Priority" value={String(job.priority)} />
          <Fact label="Progress" value={`${Math.round(job.progress * 100)}% · ${job.statusMessage || '—'}`} />
          <Fact label="Run after" value={job.runAfter} />
          <Fact label="Created" value={job.createdAt} />
          <Fact label="Updated" value={job.updatedAt} />
          {sessions.length > 0 ? <Fact label="Browser sessions" value={sessions.join(', ')} /> : null}
        </dl>
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.86rem' }}>
            Payload
          </summary>
          <pre className={styles.raw}>{JSON.stringify(job.payload, null, 2)}</pre>
        </details>
      </section>

      <section className={styles.section}>
        <h2>Provider calls while it ran</h2>
        {calls.length === 0 ? (
          <p className="muted">None recorded in this window.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>At</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Operation</th>
                <th className={styles.num}>Cost</th>
                <th>Outcome</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td className="mono">{new Date(call.createdAt).toLocaleTimeString('en-GB', { hour12: false })}</td>
                  <td className="mono">{call.provider}</td>
                  <td className="mono">{call.model ?? '—'}</td>
                  <td className="mono">{call.operation}</td>
                  <td className={styles.num}>${call.actualCostUsd.toFixed(4)}</td>
                  <td>
                    <span className={`badge ${call.succeeded ? 'badge--ok' : 'badge--bad'}`}>{call.succeeded ? 'ok' : 'failed'}</span>
                    {call.isRetry ? <span className="muted"> retry</span> : null}
                  </td>
                  <td className="mono" style={{ fontSize: '0.74rem' }}>
                    {detailOf(call)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2>What the customer was shown</h2>
        {events.length === 0 ? (
          <p className="muted">This job wrote no activity.</p>
        ) : (
          <ol className={styles.eventList}>
            {events.map((event) => (
              <li key={event.id}>
                <span className="mono muted">{new Date(event.at).toLocaleTimeString('en-GB', { hour12: false })}</span>
                <span className="mono">{event.step}</span>
                <span className="mono muted">{event.kind}</span>
                <span>{event.label}</span>
                <span className="muted">{event.detail ?? ''}</span>
                <span className="mono muted">{statusGlyph(event)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.section}>
        <h2>Operational log</h2>
        {logs.length === 0 ? (
          <p className="muted">No log entries name this job.</p>
        ) : (
          <ul className={styles.logList}>
            {logs.map((entry) => (
              <LogRow key={entry.id} event={entry} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricNote}>{note}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

function detailOf(call: GenerationCost): string {
  const parts: string[] = [];
  for (const key of ['tier', 'sessionId', 'sceneId', 'voiceId', 'language', 'characters', 'durationSeconds'] as const) {
    const value = call.metadata[key];
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${String(value)}`);
  }
  if (call.quantity !== 1 || call.unit !== 'call') parts.push(`${call.quantity} ${call.unit}`);
  return parts.join(' · ');
}

function statusGlyph(event: JobEvent): string {
  return event.status === 'done' ? '✓' : event.status === 'failed' ? '✕' : event.status === 'skipped' ? '–' : '…';
}
