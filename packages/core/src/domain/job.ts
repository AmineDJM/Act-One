import { z } from 'zod';

/** Pipeline job states, mirroring the customer-visible stages. */
export const JobState = z.enum([
  'queued',
  'researching',
  'concepting',
  'storyboarding',
  'awaiting_approval',
  'capturing_product',
  'generating_assets',
  'rendering_motion',
  'rendering_3d',
  'compositing',
  'sound',
  'qa',
  'writing_copy',
  'completed',
  'failed',
  'canceled',
]);
export type JobState = z.infer<typeof JobState>;

export const JobKind = z.enum([
  'research_product',
  'extract_brand',
  'generate_concepts',
  'render_animatic',
  'build_storyboard',
  'capture_product_moments',
  'generate_scene_assets',
  'render_film',
  'render_variant',
  'repair_scene',
  'generate_campaign',
  'generate_copy',
]);
export type JobKind = z.infer<typeof JobKind>;

export const Job = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable().default(null),
  kind: JobKind,
  state: JobState.default('queued'),
  payload: z.record(z.string(), z.unknown()).default({}),
  progress: z.number().min(0).max(1).default(0),
  /** Human-readable, shown in the UI progress panel. */
  statusMessage: z.string().max(240).default(''),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),
  lastError: z.string().nullable().default(null),
  runAfter: z.string(),
  lockedBy: z.string().nullable().default(null),
  lockedAt: z.string().nullable().default(null),
  priority: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof Job>;

export const TERMINAL_JOB_STATES: readonly JobState[] = ['completed', 'failed', 'canceled'];

export function jobIsTerminal(state: JobState): boolean {
  return TERMINAL_JOB_STATES.includes(state);
}

/**
 * Work the customer is not waiting on.
 *
 * Most jobs move the project along, and while one is running there is nothing
 * for the customer to do but watch. A side errand is different: it produces
 * something extra beside the project without changing where the project is, so
 * it must not take over the page. Previewing the timing of a storyboard should
 * not put "Working on it" over the whole project and take away the button that
 * renders the film — previewing and then rendering is the point of previewing.
 */
export const SIDE_ERRAND_JOBS: readonly JobKind[] = ['render_animatic', 'generate_copy'];

export function jobAdvancesProject(kind: JobKind): boolean {
  return !SIDE_ERRAND_JOBS.includes(kind);
}

/** Exponential backoff with jitter, capped. Keeps a bad provider from hammering us. */
export function retryDelayMs(attempt: number, baseMs = 2000, capMs = 5 * 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * 0.25 * Math.random();
  return Math.round(exponential - exponential * 0.125 + jitter);
}
