import type { Job, JobKind } from './job.ts';

/**
 * A run: the chain of jobs a customer is waiting on, as one piece of work.
 *
 * Reading a product enqueues the concepts as it finishes, so the customer
 * watched a bar fill to the end and snap back to nothing, with no idea that
 * the second bar was the second half of the same wait. A run names the steps
 * up front, shows which are done, and measures the whole against how long
 * the same steps usually take on this platform — the median of recent runs,
 * or nothing at all when there is no history, never a number made up.
 */
export type RunStepKey =
  'research' | 'concepts' | 'storyboard' | 'revision' | 'render' | 'campaign';

export const RUN_STEPS: Record<RunStepKey, { label: string; kinds: readonly JobKind[] }> = {
  research: {
    label: 'Reading your product',
    kinds: ['research_product', 'extract_brand', 'capture_product_moments'],
  },
  concepts: { label: 'Writing three directions', kinds: ['generate_concepts'] },
  storyboard: { label: 'Building the storyboard', kinds: ['build_storyboard'] },
  revision: { label: 'Working out the change', kinds: ['repair_scene'] },
  render: { label: 'Making the film', kinds: ['render_film', 'render_variant'] },
  campaign: { label: 'Cutting it for every channel', kinds: ['generate_campaign'] },
};

/** The chains, in the order their steps run. A step may belong to several. */
const RUNS: readonly (readonly RunStepKey[])[] = [
  ['research', 'concepts'],
  ['storyboard'],
  ['revision', 'render'],
  ['render'],
  ['campaign'],
];

/** How far apart two jobs may be and still be one run. */
const RUN_WINDOW_MS = 2 * 60 * 60_000;

export type RunStep = {
  key: RunStepKey;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  /** Done: how long it took. Current: how long so far. */
  elapsedMs: number | null;
  /** What this step usually takes here; null with no history. */
  typicalMs: number | null;
  /** Current only. */
  fraction: number | null;
};

export type RunView = {
  /** Stable for the life of the run, across its jobs. */
  id: string;
  steps: RunStep[];
  startedAt: string;
  /** When this view was computed; the client counts on from here. */
  asOf: string;
  /** 0..1 over the whole run, weighted by typical durations where known. */
  overall: number;
  elapsedMs: number;
  /** Null when any remaining step has no history to estimate from. */
  remainingMs: number | null;
  /** The worker's own words for what it is doing now. */
  message: string;
  /** Queued and not yet claimed: the wait is for a worker, not for work. */
  waiting: boolean;
};

export function stepFor(kind: JobKind): RunStepKey | null {
  for (const [key, step] of Object.entries(RUN_STEPS) as [
    RunStepKey,
    { kinds: readonly JobKind[] },
  ][]) {
    if (step.kinds.includes(kind)) return key;
  }
  return null;
}

/** Every step that could share a run with this kind: what to fetch history for. */
export function stepsAround(kind: JobKind): RunStepKey[] {
  const current = stepFor(kind);
  if (!current) return [];
  const keys = new Set<RunStepKey>();
  for (const run of RUNS) if (run.includes(current)) for (const key of run) keys.add(key);
  return [...keys];
}

export function buildRunView(params: {
  jobs: readonly Job[];
  active: Job;
  now: number;
  typicalMs: Partial<Record<RunStepKey, number | null>>;
}): RunView | null {
  const { jobs, active, now } = params;
  const current = stepFor(active.kind);
  if (!current) return null;
  const activeStart = Date.parse(active.startedAt ?? active.createdAt);

  // The longest chain whose earlier steps really happened just before this
  // job. A render straight from a storyboard is one step; the same render
  // after a repair is the second step of two.
  let chosen: { steps: readonly RunStepKey[]; done: Map<RunStepKey, Job> } | null = null;
  for (const run of RUNS) {
    const at = run.indexOf(current);
    if (at < 0) continue;
    const done = new Map<RunStepKey, Job>();
    let viable = true;
    for (const key of run.slice(0, at)) {
      const job = jobs.find(
        (candidate) =>
          candidate.id !== active.id &&
          candidate.state === 'completed' &&
          RUN_STEPS[key].kinds.includes(candidate.kind) &&
          Date.parse(candidate.updatedAt) <= activeStart + 60_000 &&
          Date.parse(candidate.updatedAt) >= activeStart - RUN_WINDOW_MS,
      );
      if (!job) {
        viable = false;
        break;
      }
      done.set(key, job);
    }
    if (viable && (!chosen || done.size > chosen.done.size)) chosen = { steps: run, done };
  }
  const steps = chosen?.steps ?? [current];
  const done = chosen?.done ?? new Map<RunStepKey, Job>();
  const at = steps.indexOf(current);

  const typical = (key: RunStepKey): number | null => {
    const value = params.typicalMs[key];
    return typeof value === 'number' && value > 0 ? value : null;
  };
  const waiting = active.state === 'queued';
  const fraction = waiting ? 0 : Math.max(0, Math.min(1, active.progress));

  const firstDone = steps.map((key) => done.get(key)).find(Boolean);
  const startedAtMs = firstDone
    ? Date.parse(firstDone.startedAt ?? firstDone.createdAt)
    : Date.parse(active.startedAt ?? active.createdAt);
  const startedAt = new Date(Math.min(startedAtMs, now)).toISOString();

  const view: RunStep[] = steps.map((key, index) => {
    const label = RUN_STEPS[key].label;
    if (index < at) {
      const job = done.get(key)!;
      return {
        key,
        label,
        state: 'done',
        elapsedMs: Math.max(
          0,
          Date.parse(job.updatedAt) - Date.parse(job.startedAt ?? job.createdAt),
        ),
        typicalMs: typical(key),
        fraction: null,
      };
    }
    if (index === at) {
      return {
        key,
        label,
        state: 'current',
        elapsedMs: waiting ? null : Math.max(0, now - activeStart),
        typicalMs: typical(key),
        fraction,
      };
    }
    return {
      key,
      label,
      state: 'upcoming',
      elapsedMs: null,
      typicalMs: typical(key),
      fraction: null,
    };
  });

  // Weighted by what each step usually takes, so a two-minute step does not
  // own half the bar next to a ten-minute one; equal weights when any step
  // has no history, which at least keeps the bar honest about its ignorance.
  const everyTypical = steps.every((key) => typical(key) !== null);
  const weight = (key: RunStepKey) => (everyTypical ? typical(key)! : 1);
  const total = steps.reduce((sum, key) => sum + weight(key), 0);
  const completed = steps.slice(0, at).reduce((sum, key) => sum + weight(key), 0);
  const overall = total > 0 ? (completed + weight(current) * fraction) / total : 0;

  const remaining = steps.slice(at).map((key) => typical(key));
  const remainingMs = remaining.every((value): value is number => value !== null)
    ? remaining.reduce((sum, value, index) => {
        if (index > 0) return sum + value;
        // The current step: what it usually takes, less what it has already had.
        const elapsedInStep = waiting ? 0 : now - activeStart;
        return sum + Math.max(0, value - elapsedInStep);
      }, 0)
    : null;

  return {
    id: `${steps.join('>')}@${startedAt}`,
    steps: view,
    startedAt,
    asOf: new Date(now).toISOString(),
    overall: Math.max(0, Math.min(1, overall)),
    elapsedMs: Math.max(0, now - startedAtMs),
    remainingMs,
    message: waiting ? 'Waiting for a free worker.' : active.statusMessage,
    waiting,
  };
}
