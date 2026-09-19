import Link from 'next/link';
import { SEVERITY_ORDER, categoryOf, type QaCheck, type QaSeverity } from '@act-one/core';
import {
  REGENERATING,
  archetypesByScene,
  average,
  durationBand,
  failing,
  groupByRender,
  providersByScene,
  repairSuccessByCheck,
  tallyIssues,
  tallyLabels,
  type Tally,
} from './summary.ts';
import { getStore } from '@/server/store.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Quality operations.
 *
 * Every render is judged — frames inspected, text measured, the clock read,
 * the voice listened back to, a director asked whether the thing is any good —
 * and for a long time every one of those judgements was written down and never
 * read again. Which left the quality bar as the one thing in this product with
 * no measurement behind it, while the whole brief turns on a single question:
 * could this be mistaken for work from a top motion design studio.
 *
 * The purpose of this page is not to debug one film. It is to find the defects
 * the platform produces *systematically* — one caption past the safe area is a
 * bug in a film, forty is a bug in the captioner — and to say whether the
 * repair loop is fixing them or only spending money trying.
 */
export default async function QualityPage() {
  const store = getStore();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [reports, organizations, costs] = await Promise.all([
    store.qaReports.list(600),
    store.organizations.list(500),
    store.costs.listSince(since, 'media.'),
  ]);
  const names = new Map(organizations.map((organization) => [organization.id, organization.name]));

  /*
   * A production is a render, not a report.
   *
   * There is one report per attempt, so counting reports would call a film
   * that needed two repairs three films and make the pass rate meaningless.
   */
  const productions = groupByRender(reports);
  const analysed = productions.length;
  const passed = productions.filter((run) => run.passed).length;
  const needsAttention = productions.filter((run) => run.finalState === 'needs_attention').length;
  const softFails = productions.filter((run) => run.worst === 'soft_fail').length;
  const hardFails = productions.filter(
    (run) => run.worst === 'hard_fail' || run.worst === 'critical_fail',
  ).length;

  const issues = reports.flatMap((report) => report.issues);
  const repairs = reports.flatMap((report) => report.repairs);
  const fixed = repairs.filter((repair) => repair.outcome === 'fixed').length;
  const regenerations = repairs.filter((repair) => REGENERATING.has(repair.action)).length;
  const repairCost = reports.reduce((sum, report) => sum + report.extraCostUsd, 0);
  const repairLatency = reports.reduce((sum, report) => sum + report.extraLatencyMs, 0);

  const firstPass = average(productions.filter((run) => run.passed).map((run) => run.msToFirstPass));
  const finalPass = average(productions.map((run) => run.msToFinal));
  const attempts = average(productions.map((run) => run.attempts));

  /*
   * Which shot a defect was in, and who made that shot.
   *
   * The finding knows its scene; the cost ledger knows which provider and
   * model were paid for that scene. Joining them is the only way to answer
   * "which model keeps giving us malformed hands" — the question that changes
   * a default rather than a film.
   */
  const providerByScene = providersByScene(costs);
  const archetypeByScene = archetypesByScene(reports);

  const failures = issues.filter((issue) => SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.soft_fail);
  const byCheck = tallyIssues(failures, (issue) => issue.check);
  const byCategory = tallyIssues(failures, (issue) => categoryOf(issue.check));
  const byProvider = tallyIssues(failures, (issue) =>
    issue.sceneId ? (providerByScene.get(issue.sceneId) ?? '') : '',
  );
  const byArchetype = tallyIssues(failures, (issue) =>
    issue.sceneId ? (archetypeByScene.get(issue.sceneId) ?? '') : '',
  );
  const byCut = tallyLabels(reports.flatMap((report) => failing(report).map(() => report.cut)));
  const byFormat = tallyLabels(reports.flatMap((report) => failing(report).map(() => report.format)));
  const byDuration = tallyLabels(
    reports.flatMap((report) => failing(report).map(() => durationBand(report.durationSeconds))),
  );

  // How well the loop does against each defect, which is the number that says
  // whether a check is worth having.
  const repairByCheck = repairSuccessByCheck(repairs);

  const verdicts = reports
    .flatMap((report) =>
      report.issues.filter((issue) => issue.check === 'direction').map((issue) => ({ report, issue })),
    )
    .slice(0, 10);

  return (
    <>
      <header className={styles.head}>
        <h1>Quality</h1>
        <p className="lede">
          Every film this platform has made, as the platform judged it. The point is not one film:
          one caption past the safe area is a bug in a film, forty is a bug in the captioner.
        </p>
      </header>

      <div className={styles.metrics}>
        <Metric label="Productions analysed" value={plain(analysed)} note={`${plain(reports.length)} passes`} />
        <Metric label="Shipped" value={rate(passed, analysed)} note={`${plain(passed)} of ${plain(analysed)}`} />
        <Metric
          label="Held for a person"
          value={rate(needsAttention, analysed)}
          note={needsAttention > 0 ? `${plain(needsAttention)} needing attention` : 'None'}
        />
        <Metric
          label="Repairs that worked"
          value={rate(fixed, repairs.length)}
          note={repairs.length > 0 ? `${plain(fixed)} of ${plain(repairs.length)} attempts` : 'Nothing repaired yet'}
        />
        <Metric label="Soft fails" value={rate(softFails, analysed)} note="Repaired, then shipped" />
        <Metric label="Hard fails" value={rate(hardFails, analysed)} note="Would not ship unrepaired" />
        <Metric
          label="Repair passes per film"
          value={attempts === null ? '—' : attempts.toFixed(1)}
          note="Beyond the first render"
        />
        <Metric
          label="Regenerated"
          value={rate(regenerations, repairs.length)}
          note="Rather than repaired deterministically"
        />
        <Metric
          label="To a first pass"
          value={firstPass === null ? '—' : duration(firstPass)}
          note="First render to a clean verdict"
        />
        <Metric
          label="To the final verdict"
          value={finalPass === null ? '—' : duration(finalPass)}
          note="However many passes it took"
        />
        <Metric
          label="Repair spend"
          value={`$${repairCost.toFixed(2)}`}
          note="On top of the films themselves"
        />
        <Metric
          label="Repair wait"
          value={repairLatency > 0 ? duration(repairLatency) : '—'}
          note="Customer time the loop has cost"
        />
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>What fails most</h2>
          <Link href="/admin/standards" className={styles.sectionLink}>
            The standards behind them →
          </Link>
        </div>
        {byCheck.length === 0 ? (
          <p className={styles.empty}>
            Nothing has failed yet. Every render writes a report here — what was checked, what was
            found, what the loop tried, and whether it worked.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Family</th>
                <th>Worst seen</th>
                <th className={styles.num}>Times</th>
                <th className={styles.num}>Auto-repaired</th>
                <th>Most recent wording</th>
              </tr>
            </thead>
            <tbody>
              {byCheck.slice(0, 20).map(([check, entry]) => {
                const repaired = repairByCheck.get(check);
                return (
                  <tr key={check}>
                    <td className="mono">{words(check)}</td>
                    <td className="secondary">{categoryOf(check as QaCheck)}</td>
                    <td>
                      <span className={styles.pill} data-tone={toneFor(entry.worst)}>
                        {words(entry.worst)}
                      </span>
                    </td>
                    <td className={styles.num}>{plain(entry.total)}</td>
                    <td className={styles.num}>{repaired ? rate(repaired.fixed, repaired.attempted) : '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{truncate(entry.example, 78)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className={styles.panels}>
        <Breakdown title="By family" rows={byCategory} />
        <Breakdown title="By cut" rows={byCut} />
        <Breakdown title="By kind of film" rows={byFormat} />
        <Breakdown title="By length" rows={byDuration} />
        <Breakdown
          title="By provider and model"
          rows={byProvider}
          empty="No generated shots failed in this window."
        />
        <Breakdown title="By kind of shot" rows={byArchetype} />
      </div>

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
          <h2>Recent productions</h2>
        </div>
        {productions.length === 0 ? (
          <p className={styles.empty}>No films have been judged yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Workspace</th>
                <th>Verdict</th>
                <th className={styles.num}>Passes</th>
                <th className={styles.num}>Repairs</th>
                <th className={styles.num}>Cost</th>
                <th>What held it</th>
              </tr>
            </thead>
            <tbody>
              {productions.slice(0, 40).map((run) => (
                <tr key={run.renderId}>
                  <td>{day(run.startedAt)}</td>
                  <td>{names.get(run.organizationId) ?? run.organizationId}</td>
                  <td>
                    <span className={styles.pill} data-tone={run.passed ? 'ok' : 'danger'}>
                      {run.passed ? 'shipped' : words(run.finalState)}
                    </span>
                  </td>
                  <td className={styles.num}>{plain(run.attempts + 1)}</td>
                  <td className={styles.num}>{plain(run.repairs)}</td>
                  <td className={styles.num}>{run.costUsd > 0 ? `$${run.costUsd.toFixed(2)}` : '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {run.blocking.length === 0 ? '—' : truncate(run.blocking.map(words).join(', '), 60)}
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

/** One row per kind of film, provider, archetype — whatever was counted. */
function Breakdown({
  title,
  rows,
  empty = 'Nothing yet.',
}: {
  title: string;
  rows: [string, Tally][];
  empty?: string;
}) {
  const total = rows.reduce((sum, [, entry]) => sum + entry.total, 0);
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>{title}</h3>
        <span className="mono secondary">{plain(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {empty}
        </p>
      ) : (
        <ul className={styles.plainList}>
          {rows.slice(0, 8).map(([label, entry]) => (
            <li key={label}>
              <strong>{words(label)}</strong> — {plain(entry.total)} ({rate(entry.total, total)})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function rate(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/* Never the accent: a failure in the colour the product uses for good news
   reads as a pass, which is the opposite of what it is. */
function toneFor(severity: QaSeverity): string {
  if (severity === 'hard_fail' || severity === 'critical_fail') return 'danger';
  if (severity === 'soft_fail') return 'warn';
  return 'muted';
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

function words(value: string): string {
  return value.replace(/_/g, ' ');
}

function plain(value: number): string {
  return value.toLocaleString('en-US');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
