import { describe, it, expect } from 'vitest';
import { buildRunView, stepsAround, type Job } from '../index.ts';

/**
 * The run view: one wait, in steps, that never runs backwards.
 */
const T0 = Date.parse('2026-09-18T10:00:00Z');
const MIN = 60_000;

function job(over: Partial<Job> & { kind: Job['kind'] }): Job {
  const at = new Date(T0).toISOString();
  return {
    id: `job_${over.kind}_${over.createdAt ?? at}`,
    organizationId: 'org_1',
    projectId: 'prj_1',
    state: 'queued',
    payload: {},
    progress: 0,
    statusMessage: '',
    attempts: 1,
    maxAttempts: 3,
    lastError: null, lastErrorCode: null,
    runAfter: at,
    lockedBy: null,
    lockedAt: null,
    startedAt: null,
    priority: 0,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('a run', () => {
  const research = job({
    kind: 'research_product',
    state: 'completed',
    progress: 1,
    createdAt: iso(T0),
    startedAt: iso(T0 + 5_000),
    updatedAt: iso(T0 + 3 * MIN),
  });
  const concepts = job({
    kind: 'generate_concepts',
    state: 'concepting',
    progress: 0.4,
    statusMessage: 'Developing three directions',
    createdAt: iso(T0 + 3 * MIN),
    startedAt: iso(T0 + 3 * MIN + 2_000),
    updatedAt: iso(T0 + 4 * MIN),
  });

  it('shows the concepts as the second step of the read that just finished', () => {
    const view = buildRunView({
      jobs: [concepts, research],
      active: concepts,
      now: T0 + 4 * MIN,
      typicalMs: {},
    });
    expect(view?.steps.map((step) => [step.key, step.state])).toEqual([
      ['research', 'done'],
      ['concepts', 'current'],
    ]);
    expect(view?.steps[0]?.elapsedMs).toBe(3 * MIN - 5_000);
    expect(view?.startedAt).toBe(iso(T0 + 5_000));
    expect(view?.message).toBe('Developing three directions');
    // Equal weights without history: the finished half, plus 40% of the rest.
    expect(view?.overall).toBeCloseTo(0.5 + 0.5 * 0.4);
    expect(view?.remainingMs).toBeNull();
  });

  it('keeps one identity from the first step to the last, so the bar never resets', () => {
    const running = {
      ...research,
      state: 'researching' as const,
      progress: 0.3,
      updatedAt: iso(T0 + MIN),
    };
    const first = buildRunView({ jobs: [running], active: running, now: T0 + MIN, typicalMs: {} });
    const second = buildRunView({
      jobs: [concepts, research],
      active: concepts,
      now: T0 + 4 * MIN,
      typicalMs: {},
    });
    expect(first?.id).toBe(second?.id);
    expect(first?.steps.map((step) => step.state)).toEqual(['current', 'upcoming']);
    expect(second!.overall).toBeGreaterThan(first!.overall);
  });

  it('weights the bar and forecasts the rest from what steps usually take here', () => {
    const view = buildRunView({
      jobs: [concepts, research],
      active: concepts,
      now: T0 + 4 * MIN,
      typicalMs: { research: 3 * MIN, concepts: 2 * MIN },
    });
    // Three of five minutes done, plus 40% of the two-minute step.
    expect(view?.overall).toBeCloseTo((3 * MIN + 0.4 * 2 * MIN) / (5 * MIN));
    // Two minutes usually, of which 58 seconds have already passed.
    expect(view?.remainingMs).toBe(2 * MIN - (MIN - 2_000));
    expect(view?.steps[1]?.typicalMs).toBe(2 * MIN);
  });

  it('says when it is waiting for a worker rather than pretending to work', () => {
    const queued = { ...concepts, state: 'queued' as const, progress: 0, startedAt: null };
    const view = buildRunView({
      jobs: [queued, research],
      active: queued,
      now: T0 + 4 * MIN,
      typicalMs: {},
    });
    expect(view?.waiting).toBe(true);
    expect(view?.message).toMatch(/worker/);
    expect(view?.overall).toBeCloseTo(0.5);
  });

  it("does not stitch a read from another day onto today's concepts", () => {
    const old = {
      ...research,
      createdAt: iso(T0 - 26 * 60 * MIN),
      startedAt: iso(T0 - 26 * 60 * MIN),
      updatedAt: iso(T0 - 25 * 60 * MIN),
    };
    const view = buildRunView({
      jobs: [concepts, old],
      active: concepts,
      now: T0 + 4 * MIN,
      typicalMs: {},
    });
    expect(view?.steps.map((step) => step.key)).toEqual(['concepts']);
  });

  it('is one step for a render, and two for a render that follows a repair', () => {
    const render = job({
      kind: 'render_film',
      state: 'rendering_motion',
      progress: 0.5,
      createdAt: iso(T0),
      startedAt: iso(T0),
    });
    expect(
      buildRunView({ jobs: [render], active: render, now: T0 + MIN, typicalMs: {} })?.steps.map(
        (s) => s.key,
      ),
    ).toEqual(['render']);

    const repair = job({
      kind: 'repair_scene',
      state: 'completed',
      progress: 1,
      createdAt: iso(T0 - 2 * MIN),
      startedAt: iso(T0 - 2 * MIN),
      updatedAt: iso(T0 - 10_000),
    });
    const after = buildRunView({
      jobs: [render, repair],
      active: render,
      now: T0 + MIN,
      typicalMs: {},
    });
    expect(after?.steps.map((s) => [s.key, s.state])).toEqual([
      ['revision', 'done'],
      ['render', 'current'],
    ]);
    expect(stepsAround('render_film')).toEqual(expect.arrayContaining(['revision', 'render']));
  });

  it('is nothing for work the customer is not waiting on', () => {
    const copy = job({ kind: 'generate_copy', state: 'writing_copy' });
    expect(buildRunView({ jobs: [copy], active: copy, now: T0, typicalMs: {} })).toBeNull();
  });
});
