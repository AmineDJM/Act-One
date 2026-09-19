import { describe, it, expect } from 'vitest';
import { QaIssue, QaReport, newId, type GenerationCost, type RepairRecord } from '@act-one/core';
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
} from '../summary.ts';

/**
 * The arithmetic behind the quality console.
 *
 * Two ways to get this wrong that nobody notices by looking at the page. A
 * pass rate that counts attempts instead of films says a film which needed two
 * repairs was three films. And a breakdown that counts findings with no
 * provider under an empty label invents a category, which is worse than
 * leaving them out because it looks like data.
 */
function issue(over: Partial<QaIssue> = {}): QaIssue {
  return QaIssue.parse({
    id: newId('evt'),
    check: 'safe_area',
    severity: 'hard_fail',
    sceneId: 'scn_1',
    message: 'A caption sits below the caption bar.',
    ...over,
  });
}

function report(over: Partial<QaReport> = {}): QaReport & { organizationId: string } {
  return {
    ...QaReport.parse({
      id: newId('ast'),
      renderId: 'rnd_1',
      projectId: 'prj_1',
      passed: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }),
    organizationId: 'org_1',
  };
}

function repair(over: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: newId('evt'), issueId: 'evt_1', check: 'safe_area', sceneId: 'scn_1',
    action: 'reposition_captions', attempt: 0, outcome: 'fixed', level: 0,
    providerCostUsd: 0, computeMs: 0, estimatedComputeCostUsd: 0, wallClockMs: 0, note: '',
    ...over,
  };
}

describe('a production is a render, not a report', () => {
  it('folds every pass of one render into one production', () => {
    const productions = groupByRender([
      report({ attempt: 0, passed: false, createdAt: '2026-01-01T10:00:00.000Z', issues: [issue()] }),
      report({ attempt: 1, passed: false, createdAt: '2026-01-01T10:02:00.000Z', issues: [issue()] }),
      report({ attempt: 2, passed: true, state: 'ready', createdAt: '2026-01-01T10:05:00.000Z', issues: [] }),
    ]);

    // Three reports, one film. Counting reports would make the pass rate a
    // measure of how many repairs were needed rather than of quality.
    expect(productions).toHaveLength(1);
    expect(productions[0]).toMatchObject({ passed: true, attempts: 2, finalState: 'ready' });
    expect(productions[0]!.msToFirstPass).toBe(5 * 60_000);
    expect(productions[0]!.msToFinal).toBe(5 * 60_000);
  });

  it('keeps two renders apart', () => {
    const productions = groupByRender([
      report({ renderId: 'rnd_1' }),
      report({ renderId: 'rnd_2' }),
    ]);
    expect(productions).toHaveLength(2);
  });

  it('reports what held the last pass, and what it all cost', () => {
    const [production] = groupByRender([
      report({ attempt: 0, createdAt: '2026-01-01T10:00:00.000Z', extraCostUsd: 0, repairs: [repair()] }),
      report({
        attempt: 1,
        createdAt: '2026-01-01T10:03:00.000Z',
        state: 'needs_attention',
        issues: [issue({ check: 'image_artifact' }), issue({ severity: 'warning', check: 'contrast' })],
        repairs: [repair({ outcome: 'unchanged' })],
        extraCostUsd: 0.42,
      }),
    ]);

    expect(production).toMatchObject({ passed: false, finalState: 'needs_attention', repairs: 2 });
    expect(production!.costUsd).toBeCloseTo(0.42);
    // Only what blocks: the warning is on the record and is not what held it.
    expect(production!.blocking).toEqual(['image_artifact']);
  });
});

describe('the breakdowns', () => {
  it('counts a check, keeps the worst severity it reached and an example', () => {
    const rows = tallyIssues(
      [
        issue({ check: 'safe_area', severity: 'soft_fail' }),
        issue({ check: 'safe_area', severity: 'hard_fail', message: 'The worst one.' }),
        issue({ check: 'contrast', severity: 'soft_fail' }),
      ],
      (found) => found.check,
    );

    expect(rows[0]![0]).toBe('safe_area');
    expect(rows[0]![1]).toMatchObject({ total: 2, worst: 'hard_fail' });
    // The first one seen, so the example is not silently the least useful.
    expect(rows[0]![1].example).toMatch(/caption bar/);
  });

  it('leaves out the findings a dimension does not apply to', () => {
    const providers = providersByScene([cost('scn_1', 'higgsfield', 'turbo')]);
    const rows = tallyIssues(
      [
        issue({ sceneId: 'scn_1' }),
        // A caption has no provider. Counting it under an empty label would
        // invent a category, which looks like data and is not.
        issue({ sceneId: null, check: 'caption_onset' }),
      ],
      (found) => (found.sceneId ? (providers.get(found.sceneId) ?? '') : ''),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('higgsfield · turbo');
  });

  it('reads the provider from the cost ledger and the archetype from the report', () => {
    expect(providersByScene([cost('scn_1', 'openai', null)]).get('scn_1')).toBe('openai');
    const archetypes = archetypesByScene([
      report({ shots: [{ sceneId: 'scn_1', archetype: 'generated_broll' }] }),
    ]);
    expect(archetypes.get('scn_1')).toBe('generated_broll');
  });

  it('sorts by how often something fails, not by how bad it is', () => {
    const rows = tallyLabels(['short', 'short', 'short', 'feature']);
    // A minor that fires on every film costs more than a blocker that fired
    // once, because the blocker stopped the film and the minor shipped.
    expect(rows.map(([label]) => label)).toEqual(['short', 'feature']);
  });

  it('bands a film by its length', () => {
    expect(durationBand(12)).toBe('under 15s');
    expect(durationBand(30)).toBe('15–30s');
    expect(durationBand(61)).toBe('60–90s');
    expect(durationBand(240)).toBe('over 90s');
  });

  it('counts only what a soft fail or worse', () => {
    const counted = failing(
      report({
        issues: [
          issue({ severity: 'info', check: 'direction' }),
          issue({ severity: 'warning', check: 'contrast' }),
          issue({ severity: 'soft_fail', check: 'caption_onset' }),
          issue({ severity: 'hard_fail', check: 'safe_area' }),
        ],
      }),
    );
    expect(counted.map((found) => found.check)).toEqual(['caption_onset', 'safe_area']);
  });
});

describe('whether the loop is working', () => {
  it('counts how often each repair actually fixed its defect', () => {
    const rates = repairSuccessByCheck([
      repair({ check: 'safe_area', outcome: 'fixed' }),
      repair({ check: 'safe_area', outcome: 'unchanged' }),
      repair({ check: 'image_artifact', outcome: 'fixed' }),
    ]);
    expect(rates.get('safe_area')).toEqual({ attempted: 2, fixed: 1 });
    expect(rates.get('image_artifact')).toEqual({ attempted: 1, fixed: 1 });
  });

  it('knows which repairs pay a provider again', () => {
    expect(REGENERATING.has('regenerate_shot')).toBe(true);
    expect(REGENERATING.has('alternate_provider')).toBe(true);
    // A deterministic edit costs nothing but the render.
    expect(REGENERATING.has('reposition_captions')).toBe(false);
    expect(REGENERATING.has('trim_hold')).toBe(false);
  });

  it('has nothing to average when nothing has run', () => {
    expect(average([])).toBeNull();
    expect(average([1, 2, 3])).toBe(2);
  });
});

function cost(sceneId: string, provider: string, model: string | null): GenerationCost {
  return {
    id: newId('cst'), organizationId: 'org_1', projectId: 'prj_1', sceneId, renderId: 'rnd_1',
    provider, model, operation: 'media.image', estimatedCostUsd: 0.1, actualCostUsd: 0.1,
    creditsCharged: 5, quantity: 1, unit: 'call', succeeded: true, isRetry: false, metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
