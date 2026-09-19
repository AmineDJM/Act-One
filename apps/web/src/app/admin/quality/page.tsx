import Link from 'next/link';
import { qaVerdict, type QaIssue, type QaReport, type QaSeverity } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * What the product thinks of its own films.
 *
 * Every render is judged — frames inspected, text measured, loudness read,
 * the voice listened back to, and a director asked whether the thing is any
 * good — and every one of those judgements was written to the database and
 * never read again by anybody. The repair planner consumed the report inside
 * the render loop and that was the end of it.
 *
 * Which made the quality bar the one thing in this product with no
 * measurement behind it. The whole brief turns on a question — could this be
 * mistaken for work from a top motion design studio — and the answer was
 * being computed film by film and thrown away.
 *
 * The useful view is not one report. It is which checks fail across every
 * film: one caption that ran past the safe area is a bug in a film, and
 * forty of them is a bug in the captioner.
 */
export default async function QualityPage() {
  const store = getStore();
  const [reports, organizations] = await Promise.all([
    store.qaReports.list(400),
    store.organizations.list(500),
  ]);
  const names = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const judged = reports.length;
  const passed = reports.filter((report) => report.passed).length;
  const issues = reports.flatMap((report) => report.issues);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');

  /*
   * Ranked by how often a check fires, not by severity.
   *
   * A minor that fires on every film costs more than a blocker that fired
   * once, because the blocker stopped the film and the minor shipped.
   */
  const byCheck = new Map<string, { total: number; worst: QaSeverity; example: string }>();
  for (const issue of issues) {
    const entry = byCheck.get(issue.check) ?? { total: 0, worst: 'note' as QaSeverity, example: '' };
    entry.total += 1;
    if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[entry.worst]) entry.worst = issue.severity;
    if (!entry.example) entry.example = issue.message;
    byCheck.set(issue.check, entry);
  }
  const ranked = [...byCheck.entries()].sort((left, right) => right[1].total - left[1].total);

  // The one judgement here with no arithmetic behind it: the director's.
  const verdicts = reports
    .flatMap((report) =>
      report.issues
        .filter((issue) => issue.check === 'direction')
        .map((issue) => ({ report, issue })),
    )
    .slice(0, 12);

  return (
    <>
      <header className={styles.head}>
        <h1>Quality</h1>
        <p className="lede">
          Every film this platform has made, as the platform judged it. The ranking below is the
          useful part: one caption past the safe area is a bug in a film, forty is a bug in the
          captioner.
        </p>
      </header>

      <div className={styles.metrics}>
        <Metric label="Films judged" value={plain(judged)} note="Every render, every attempt" />
        <Metric
          label="Shipped on the first cut"
          value={judged > 0 ? `${Math.round((passed / judged) * 100)}%` : '—'}
          note={`${plain(passed)} of ${plain(judged)} passed`}
        />
        <Metric
          label="Blockers"
          value={plain(blockers.length)}
          note={blockers.length > 0 ? 'Films stopped before they shipped' : 'Nothing was stopped'}
        />
        <Metric
          label="Notes per film"
          value={judged > 0 ? (issues.length / judged).toFixed(1) : '—'}
          note={`${plain(issues.length)} in total`}
        />
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>What fails most</h2>
          <Link href="/admin/standards" className={styles.sectionLink}>
            The standards behind them →
          </Link>
        </div>
        {ranked.length === 0 ? (
          <p className={styles.empty}>
            Nothing has been judged yet. Every render writes a report here — what was checked, what
            was found, and what the director made of it.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Worst seen</th>
                <th className={styles.num}>Times</th>
                <th>Most recent wording</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 20).map(([check, entry]) => (
                <tr key={check}>
                  <td className="mono">{check.replace(/_/g, ' ')}</td>
                  <td>
                    <span className={styles.pill} data-tone={toneFor(entry.worst)}>
                      {entry.worst}
                    </span>
                  </td>
                  <td className={styles.num}>{plain(entry.total)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{truncate(entry.example, 90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {verdicts.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>What the director said</h2>
          </div>
          <p className="hint" style={{ marginBottom: 'var(--space-3)' }}>
            The one judgement on this page with no arithmetic behind it — somebody watching the
            finished film and saying whether it is any good.
          </p>
          <ul className={styles.plainList}>
            {verdicts.map(({ report, issue }) => (
              <li key={issue.id}>
                <strong>{names.get(report.organizationId) ?? 'A workspace'}</strong>{' '}
                <span className="mono">{report.passed ? 'shipped' : 'held'}</span> — {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Recent verdicts</h2>
        </div>
        {reports.length === 0 ? (
          <p className={styles.empty}>No films have been judged yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Workspace</th>
                <th>Verdict</th>
                <th className={styles.num}>Notes</th>
                <th>What held it</th>
              </tr>
            </thead>
            <tbody>
              {reports.slice(0, 40).map((report) => {
                const { blockers: stoppers } = qaVerdict(report.issues);
                return (
                  <tr key={report.id}>
                    <td>{when(report.createdAt)}</td>
                    <td>{names.get(report.organizationId) ?? report.organizationId}</td>
                    <td>
                      <span className={styles.pill} data-tone={report.passed ? 'ok' : 'danger'}>
                        {report.passed ? 'shipped' : 'held'}
                      </span>
                    </td>
                    <td className={styles.num}>{plain(report.issues.length)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {stoppers.length === 0
                        ? '—'
                        : truncate(stoppers.map((issue) => issue.check.replace(/_/g, ' ')).join(', '), 70)}
                    </td>
                  </tr>
                );
              })}
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
      <strong className={styles.metricValue}>{value}</strong>
      {note ? <span className={styles.metricNote}>{note}</span> : null}
    </div>
  );
}

const SEVERITY_ORDER: Record<QaSeverity, number> = { note: 0, minor: 1, major: 2, blocker: 3 };

/* Never the accent: a "major" in the colour the product uses for good news
   reads as a pass, which is the opposite of what it is. */
function toneFor(severity: QaIssue['severity']): string {
  if (severity === 'blocker') return 'danger';
  if (severity === 'major') return 'warn';
  return 'muted';
}

function plain(value: number): string {
  return value.toLocaleString('en-US');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function when(iso: QaReport['createdAt']): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
