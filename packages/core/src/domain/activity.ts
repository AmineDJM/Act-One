import { z } from 'zod';
import type { Job, JobKind } from './job.ts';

/**
 * What the system is doing, in words a customer can read.
 *
 * A job event is one curated line of activity — a page read, a step begun
 * or finished, a scene rendered, a passage read — written by the worker as
 * it works and shown live on the project page. Never a log line: the log
 * is the console's, and it says everything; this says what matters.
 */
export const GenerationStepKey = z.enum([
  'research',
  'brand',
  'strategy',
  'concepts',
  'storyboard',
  'captures',
  'voice',
  'motion',
  'composition',
]);
export type GenerationStepKey = z.infer<typeof GenerationStepKey>;

export const JobEventKind = z.enum(['page', 'step', 'note', 'capture', 'shot', 'scene', 'passage']);
export type JobEventKind = z.infer<typeof JobEventKind>;

export const JobEventStatus = z.enum(['active', 'done', 'failed', 'skipped']);
export type JobEventStatus = z.infer<typeof JobEventStatus>;

export const JobEvent = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  jobId: z.string(),
  at: z.string(),
  /** The step of the generation this belongs to, when it belongs to one. */
  step: GenerationStepKey.nullable().default(null),
  kind: JobEventKind,
  /** "homepage", "/pricing", "extracting positioning", "scene 4 rendered". */
  label: z.string().max(200),
  detail: z.string().max(400).nullable().default(null),
  status: JobEventStatus.default('done'),
  /** For pages and scenes: their place in the sequence. */
  index: z.number().int().min(0).nullable().default(null),
});
export type JobEvent = z.infer<typeof JobEvent>;

/** What a stage writes: the line, and as much of the rest as it knows. */
export type JobEventInput = {
  kind: JobEventKind;
  label: string;
  step?: GenerationStepKey | null;
  detail?: string | null;
  status?: JobEventStatus;
  index?: number | null;
  at?: string;
};

/**
 * The generation, as the nine steps a customer sees.
 *
 * Each step is a job or a phase of one; the timeline is read from the
 * project's jobs and the activity they wrote, never invented. A step that
 * has not happened yet is WAITING, the one happening is BUILDING, and a
 * step that stopped says so.
 */
export const GENERATION_STEPS: readonly { key: GenerationStepKey; label: string; kinds: readonly JobKind[] }[] = [
  { key: 'research', label: 'Product discovery', kinds: ['research_product', 'extract_brand'] },
  { key: 'brand', label: 'Identity', kinds: ['research_product', 'extract_brand'] },
  { key: 'strategy', label: 'Creative direction', kinds: ['generate_concepts'] },
  { key: 'concepts', label: 'Three directions', kinds: ['generate_concepts'] },
  { key: 'storyboard', label: 'Storyboard', kinds: ['build_storyboard', 'repair_scene'] },
  { key: 'captures', label: 'Source material', kinds: ['capture_product_moments', 'generate_scene_assets', 'render_film'] },
  { key: 'voice', label: 'Voice', kinds: ['render_film'] },
  { key: 'motion', label: 'Motion', kinds: ['render_film'] },
  { key: 'composition', label: 'The master', kinds: ['render_film', 'render_variant'] },
];

export type GenerationStepStatus = 'complete' | 'building' | 'waiting' | 'failed' | 'skipped';

export type GenerationStep = {
  key: GenerationStepKey;
  index: number;
  label: string;
  status: GenerationStepStatus;
  /** Curated lines under the step: "12 pages visited", "8 useful product screens captured". */
  details: string[];
  /** The live lines of the step in progress, newest last. */
  activity: JobEvent[];
};

export type GenerationTimeline = {
  steps: GenerationStep[];
  /** The step in progress, or null when nothing is. */
  active: GenerationStepKey | null;
  /** Everything up to and including the film exists. */
  complete: boolean;
};

const ORDER = GENERATION_STEPS.map((step) => step.key);

function stepIndex(key: GenerationStepKey): number {
  return ORDER.indexOf(key);
}

/** The step a job kind lands on when it has written no step event of its own. */
function firstStepFor(kind: JobKind): GenerationStepKey | null {
  return GENERATION_STEPS.find((step) => step.kinds.includes(kind))?.key ?? null;
}

/**
 * Reads the timeline off the jobs and their events.
 *
 * Completed steps come from completed jobs (every step a kind covers) and
 * from step events marked done; the building step from the running job's
 * latest active step event, or the first step its kind covers; a failed
 * job fails the step it was on. Details are the counts the events carry
 * plus what the caller knows (pages read, differentiators found).
 */
export function timelineFor(params: {
  jobs: readonly Job[];
  events: readonly JobEvent[];
  /** Facts the caller can add per step, e.g. from the understanding. */
  details?: Partial<Record<GenerationStepKey, string[]>>;
  filmReady?: boolean;
}): GenerationTimeline {
  const { jobs, events } = params;
  const byStep = new Map<GenerationStepKey, GenerationStepStatus>();
  const mark = (key: GenerationStepKey | null, status: GenerationStepStatus) => {
    if (!key) return;
    const current = byStep.get(key);
    // Building and failed are louder than complete; complete is louder than waiting.
    const rank: Record<GenerationStepStatus, number> = { waiting: 0, skipped: 1, complete: 2, failed: 3, building: 4 };
    if (!current || rank[status] >= rank[current]) byStep.set(key, status);
  };

  const sortedJobs = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const job of sortedJobs) {
    const covered = GENERATION_STEPS.filter((step) => step.kinds.includes(job.kind)).map((step) => step.key);
    const own = events.filter((event) => event.jobId === job.id && event.step);
    if (job.state === 'completed') {
      for (const key of covered) mark(key, 'complete');
      for (const event of own) if (event.status === 'skipped') mark(event.step, 'skipped');
      continue;
    }
    if (job.state === 'failed') {
      const last = [...own].reverse().find((event) => event.kind === 'step');
      mark(last?.step ?? firstStepFor(job.kind), 'failed');
      for (const event of own) if (event.kind === 'step' && event.status === 'done') mark(event.step, 'complete');
      continue;
    }
    if (job.state === 'canceled') continue;
    // Queued or running.
    const doneSteps = own.filter((event) => event.kind === 'step' && event.status === 'done');
    for (const event of doneSteps) mark(event.step, 'complete');
    const active = [...own].reverse().find((event) => event.kind === 'step' && event.status === 'active');
    mark(active?.step ?? firstStepFor(job.kind), 'building');
  }

  // A step reached implies the ones before it happened, whether or not a job
  // wrote them down: a film exists, so the research did.
  const highest = Math.max(-1, ...[...byStep.entries()].filter(([, s]) => s !== 'waiting').map(([key]) => stepIndex(key)));
  for (const key of ORDER.slice(0, Math.max(0, highest))) {
    if (!byStep.has(key)) byStep.set(key, 'complete');
  }
  if (params.filmReady) for (const key of ORDER) if (byStep.get(key) !== 'failed' && byStep.get(key) !== 'building') byStep.set(key, 'complete');

  const active = [...byStep.entries()].find(([, status]) => status === 'building')?.[0] ?? null;
  const steps: GenerationStep[] = GENERATION_STEPS.map((step, index) => {
    const status = byStep.get(step.key) ?? 'waiting';
    const own = events.filter((event) => event.step === step.key);
    return {
      key: step.key,
      index,
      label: step.label,
      status,
      details: [...(params.details?.[step.key] ?? []), ...summarise(own)],
      activity: status === 'building' ? own.slice(-12) : [],
    };
  });
  return {
    steps,
    active,
    complete: steps.every((step) => step.status === 'complete' || step.status === 'skipped'),
  };
}

/** Counts of what the events say happened: pages, captures, shots, scenes, passages. */
function summarise(events: readonly JobEvent[]): string[] {
  const lines: string[] = [];
  const count = (kind: JobEventKind, singular: string, plural: string) => {
    const n = events.filter((event) => event.kind === kind && event.status === 'done').length;
    if (n > 0) lines.push(`${n} ${n === 1 ? singular : plural}`);
  };
  count('page', 'page visited', 'pages visited');
  count('capture', 'product screen captured', 'product screens captured');
  count('shot', 'shot generated', 'shots generated');
  count('scene', 'scene rendered', 'scenes rendered');
  count('passage', 'passage read', 'passages read');
  const notes = events.filter((event) => event.kind === 'note' && event.status !== 'active').map((event) => event.label);
  return [...lines, ...notes.slice(-3)];
}

export const GENERATION_STATUS_LABELS: Record<GenerationStepStatus, string> = {
  complete: 'COMPLETE',
  building: 'BUILDING',
  waiting: 'WAITING',
  failed: 'STOPPED',
  skipped: 'SKIPPED',
};

/**
 * A source the research read: one page, kept with what it gave us.
 *
 * The trail is the customer's to inspect after the film exists — what the
 * system actually used to understand the product — and ours to reproduce
 * from. Stored per project, with the screenshot as our own asset.
 */
export const ResearchPageType = z.enum([
  'home',
  'pricing',
  'product',
  'use_case',
  'customers',
  'docs',
  'changelog',
  'about',
  'blog',
  'launch_profile',
  'social',
  'other',
]);
export type ResearchPageType = z.infer<typeof ResearchPageType>;

export const ResearchSource = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  jobId: z.string().nullable().default(null),
  /** Its place in the order the pages were read. */
  position: z.number().int().min(0).default(0),
  url: z.string(),
  title: z.string().max(300).default(''),
  domain: z.string().max(200),
  pageType: ResearchPageType.default('other'),
  /** Why the agent went there, in a few words. */
  reason: z.string().max(300).default(''),
  visitedAt: z.string(),
  screenshotAssetId: z.string().nullable().default(null),
  /** The most relevant verbatim text on the page, short. */
  excerpt: z.string().max(800).default(''),
  /** What was learned from it: the claims that cite it, in the film's words. */
  findings: z.array(z.string().max(300)).default([]),
  evidenceCount: z.number().int().min(0).default(0),
  statusCode: z.number().int().default(200),
  /** A page that answered with an error, or nothing worth keeping. */
  useful: z.boolean().default(true),
});
export type ResearchSource = z.infer<typeof ResearchSource>;

export const RESEARCH_PAGE_LABELS: Record<ResearchPageType, string> = {
  home: 'Homepage',
  pricing: 'Pricing',
  product: 'Product',
  use_case: 'Use case',
  customers: 'Customers',
  docs: 'Docs',
  changelog: 'Changelog',
  about: 'About',
  blog: 'Blog',
  launch_profile: 'Launch profile',
  social: 'Social',
  other: 'Page',
};

/** What a page of each kind is read for: the line under its title when the page gave nothing more specific. */
export const RESEARCH_PAGE_PURPOSE: Record<ResearchPageType, string> = {
  home: 'Positioning / hero messaging',
  pricing: 'Plans / target customer',
  product: 'Major capabilities',
  use_case: 'Who it is for / how it is used',
  customers: 'Proof / who already uses it',
  docs: 'How it actually works',
  changelog: 'What shipped recently',
  about: 'The company / the founders',
  blog: 'Voice / what they care about',
  launch_profile: 'Launch positioning',
  social: 'Company positioning',
  other: 'Context',
};
