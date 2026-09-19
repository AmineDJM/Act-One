import {
  SEVERITY_ORDER,
  blocksRelease,
  type GenerationCost,
  type QaIssue,
  type QaReport,
  type QaSeverity,
  type RepairRecord,
} from '@act-one/core';

/**
 * The arithmetic behind the Quality console.
 *
 * Its own module rather than living inside the page, for the same reason the
 * grantable limits do: a page cannot be tested, and this is the part worth
 * testing — a pass rate that counts attempts instead of films, or a provider
 * column that invents a category for findings that have no provider, is wrong
 * in a way nobody notices by looking at it.
 */
export type Tally = { total: number; worst: QaSeverity; example: string };

/** One production, assembled from the reports of its passes. */
export type Production = {
  renderId: string;
  organizationId: string;
  startedAt: string;
  attempts: number;
  passed: boolean;
  finalState: QaReport['state'];
  worst: QaSeverity | null;
  blocking: string[];
  repairs: number;
  costUsd: number;
  msToFirstPass: number;
  msToFinal: number;
};

export function groupByRender(reports: readonly (QaReport & { organizationId: string })[]): Production[] {
  const byRender = new Map<string, (QaReport & { organizationId: string })[]>();
  for (const report of reports) {
    const list = byRender.get(report.renderId) ?? [];
    list.push(report);
    byRender.set(report.renderId, list);
  }

  return [...byRender.values()]
    .map((passes) => {
      const ordered = [...passes].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      const clean = ordered.find((report) => report.passed);
      const started = Date.parse(first.createdAt);
      const blocking = last.issues.filter((issue) => blocksRelease(issue.severity));

      return {
        renderId: first.renderId,
        organizationId: first.organizationId,
        startedAt: first.createdAt,
        attempts: last.attempt,
        passed: Boolean(clean),
        finalState: last.state,
        worst: worstOf(last.issues),
        blocking: [...new Set(blocking.map((issue) => issue.check as string))],
        repairs: ordered.reduce((sum, report) => sum + report.repairs.length, 0),
        costUsd: ordered.reduce((sum, report) => sum + report.extraCostUsd, 0),
        msToFirstPass: clean ? Math.max(0, Date.parse(clean.createdAt) - started) : 0,
        msToFinal: Math.max(0, Date.parse(last.createdAt) - started),
      };
    })
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function failing(report: QaReport): QaIssue[] {
  return report.issues.filter((issue) => SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.soft_fail);
}

export function worstOf(issues: readonly QaIssue[]): QaSeverity | null {
  return issues.reduce<QaSeverity | null>(
    (highest, issue) =>
      highest === null || SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[highest] ? issue.severity : highest,
    null,
  );
}

/** Counts findings under a label, keeping the worst severity and an example. */
export function tallyIssues(issues: readonly QaIssue[], key: (issue: QaIssue) => string): [string, Tally][] {
  const counts = new Map<string, Tally>();
  for (const issue of issues) {
    const label = key(issue);
    // An empty label means the dimension does not apply to this finding — a
    // caption has no provider — and counting it would invent a category.
    if (!label) continue;
    const entry = counts.get(label) ?? { total: 0, worst: 'info' as QaSeverity, example: '' };
    entry.total += 1;
    if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[entry.worst]) entry.worst = issue.severity;
    if (!entry.example) entry.example = issue.message;
    counts.set(label, entry);
  }
  return [...counts.entries()].sort((left, right) => right[1].total - left[1].total);
}

export function tallyLabels(labels: readonly string[]): [string, Tally][] {
  const counts = new Map<string, Tally>();
  for (const label of labels) {
    if (!label) continue;
    const entry = counts.get(label) ?? { total: 0, worst: 'info' as QaSeverity, example: '' };
    entry.total += 1;
    counts.set(label, entry);
  }
  return [...counts.entries()].sort((left, right) => right[1].total - left[1].total);
}

/** Which provider and model was paid for each shot, from the cost ledger. */
export function providersByScene(costs: readonly GenerationCost[]): Map<string, string> {
  const byScene = new Map<string, string>();
  for (const cost of costs) {
    if (cost.sceneId && !byScene.has(cost.sceneId)) {
      byScene.set(cost.sceneId, cost.model ? `${cost.provider} · ${cost.model}` : cost.provider);
    }
  }
  return byScene;
}

/** Which kind of shot each scene was, from the reports themselves. */
export function archetypesByScene(reports: readonly QaReport[]): Map<string, string> {
  const byScene = new Map<string, string>();
  for (const report of reports) {
    for (const shot of report.shots) byScene.set(shot.sceneId, shot.archetype);
  }
  return byScene;
}

/** How often each repair worked, which says whether a check is worth having. */
export function repairSuccessByCheck(
  repairs: readonly RepairRecord[],
): Map<string, { attempted: number; fixed: number }> {
  const byCheck = new Map<string, { attempted: number; fixed: number }>();
  for (const repair of repairs) {
    const entry = byCheck.get(repair.check) ?? { attempted: 0, fixed: 0 };
    entry.attempted += 1;
    if (repair.outcome === 'fixed') entry.fixed += 1;
    byCheck.set(repair.check, entry);
  }
  return byCheck;
}

const DURATION_BANDS: [number, string][] = [
  [15, 'under 15s'],
  [30, '15–30s'],
  [60, '30–60s'],
  [90, '60–90s'],
  [Number.POSITIVE_INFINITY, 'over 90s'],
];

/** Which band a film's length falls in, for the breakdown by duration. */
export function durationBand(seconds: number): string {
  return DURATION_BANDS.find(([ceiling]) => seconds <= ceiling)?.[1] ?? 'unknown';
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Repairs that pay a provider again rather than editing what we already have. */
export const REGENERATING: ReadonlySet<RepairRecord['action']> = new Set<RepairRecord['action']>([
  'regenerate_shot',
  'regenerate_voice',
  'recapture_product',
  'alternate_provider',
  'alternate_archetype',
  'swap_asset',
]);
