import {
  jobIsTerminal,
  retryDelayMs,
  toAppError,
  type Job,
  type JobKind,
  type JobState,
} from '@act-one/core';
import type { Store } from '@act-one/db';
import type { ProviderRegistry } from '@act-one/providers';
import type { SecretVault } from '@act-one/providers';
import type { StageContext } from './context.ts';
import { runResearch } from './stages/research.ts';
import { runConcepts } from './stages/concepts.ts';
import { runStoryboard } from './stages/storyboard.ts';
import { runRender } from './stages/render.ts';
import { runCampaign } from './stages/campaign.ts';
import { runCopy } from './stages/copy.ts';
import { runAnimatic } from './stages/animatic.ts';
import { runRevision } from './stages/revision.ts';
import { runSceneAssets } from './stages/assets.ts';

/**
 * The job runner.
 *
 * One place that knows how to turn a queued job into work, how to report
 * progress, and what to do when it fails. Stages themselves know nothing about
 * jobs, retries or the queue — which is what makes them testable by calling
 * them directly.
 */
export type RunnerDeps = {
  store: Store;
  /** Built per job so costs attribute to the right tenant and project. */
  buildRegistry: (scope: {
    organizationId: string;
    projectId?: string | null;
  }) => Promise<ProviderRegistry>;
  vault?: SecretVault;
  workerId: string;
};

export type JobOutcome =
  | { status: 'completed'; result: unknown }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'skipped'; reason: string };

/** States reported to the customer while a job of each kind is in flight. */
const RUNNING_STATE: Record<JobKind, JobState> = {
  research_product: 'researching',
  extract_brand: 'researching',
  generate_concepts: 'concepting',
  render_animatic: 'rendering_motion',
  build_storyboard: 'storyboarding',
  capture_product_moments: 'capturing_product',
  generate_scene_assets: 'generating_assets',
  render_film: 'rendering_motion',
  render_variant: 'rendering_motion',
  repair_scene: 'storyboarding',
  generate_campaign: 'rendering_motion',
  generate_copy: 'writing_copy',
};

export async function runJob(deps: RunnerDeps, job: Job, signal?: AbortSignal): Promise<JobOutcome> {
  const { store } = deps;

  if (!job.projectId) {
    await store.jobs.complete(job.id, 'failed', 'Job has no project.');
    return { status: 'skipped', reason: 'no project' };
  }

  const project = await store.projects.get(job.organizationId, job.projectId);
  if (!project) {
    // The project was deleted while the job sat in the queue. Not an error.
    await store.jobs.complete(job.id, 'canceled', 'Project no longer exists.');
    return { status: 'skipped', reason: 'project deleted' };
  }

  const registry = await deps.buildRegistry({
    organizationId: job.organizationId,
    projectId: job.projectId,
  });

  await store.jobs.update(job.id, { state: RUNNING_STATE[job.kind], progress: 0.01 });

  const context: StageContext = {
    store,
    registry,
    organizationId: job.organizationId,
    project,
    jobId: job.id,
    progress: async (fraction, message) => {
      await store.jobs.update(job.id, {
        progress: Math.max(0, Math.min(1, fraction)),
        statusMessage: message.slice(0, 240),
      });
    },
    ...(signal ? { signal } : {}),
  };

  try {
    const result = await dispatch(context, job, deps);
    await store.jobs.complete(job.id, 'completed', 'Done');
    return { status: 'completed', result };
  } catch (error) {
    const appError = toAppError(error);
    // Only transient failures are worth another attempt. A validation failure
    // or a policy refusal will fail identically forever and retrying it just
    // spends money and delays the customer's answer.
    const retryable = !['validation_failed', 'forbidden', 'unsafe_operation', 'not_found', 'conflict', 'entitlement_required'].includes(
      appError.code,
    );

    const attemptsLeft = job.attempts < job.maxAttempts;
    const retryAt =
      retryable && attemptsLeft
        ? new Date(Date.now() + retryDelayMs(job.attempts)).toISOString()
        : null;

    await store.jobs.fail(job.id, appError.message, retryAt);

    if (!retryAt) {
      // The customer needs to see that it stopped, not an eternal spinner.
      await store.projects.setStage(job.organizationId, project.id, 'failed');
    }

    return { status: 'failed', error: appError.message, retryable: Boolean(retryAt) };
  }
}

async function dispatch(context: StageContext, job: Job, deps: RunnerDeps): Promise<unknown> {
  const payload = job.payload as Record<string, unknown>;

  switch (job.kind) {
    case 'research_product':
    case 'extract_brand': {
      const research = await runResearch(context, deps.vault ? { vault: deps.vault } : {});
      // Concepts follow research automatically. The customer pasted a URL and
      // asked for creative work; making them press another button to get it
      // would be the product losing its nerve.
      await enqueueNext(context, 'generate_concepts', {}, 9);
      return research;
    }

    case 'generate_concepts':
      return runConcepts(context, {
        rejectedConceptIds: asStringArray(payload['rejectedConceptIds']),
      });

    case 'build_storyboard':
      return runStoryboard(context, {
        ...(typeof payload['conceptId'] === 'string' ? { conceptId: payload['conceptId'] } : {}),
      });

    case 'render_film':
      // No watermark flag in the payload: the plan decides, in the worker,
      // at the moment the film is made.
      return runRender(context, {
        storyboardId: String(payload['storyboardId'] ?? context.project.activeStoryboardId ?? ''),
      });

    case 'render_variant':
      return runRender(context, {
        storyboardId: String(payload['storyboardId'] ?? ''),
        aspect: (payload['aspect'] as '16:9') ?? '16:9',
        skipVisionQa: true,
      });

    case 'generate_campaign':
      return runCampaign(context, { renderId: String(payload['renderId'] ?? '') });

    case 'repair_scene':
      return runRevision(context, {
        storyboardId: String(payload['storyboardId'] ?? ''),
        instruction: String(payload['instruction'] ?? ''),
        authorUserId: String(payload['authorUserId'] ?? ''),
      });

    case 'capture_product_moments':
      // Recapture re-runs research with credentials, which refreshes the
      // moments and their assets in place.
      return runResearch(context, deps.vault ? { vault: deps.vault } : {});

    case 'generate_scene_assets':
      return runSceneAssets(context, {
        storyboardId: String(payload['storyboardId'] ?? context.project.activeStoryboardId ?? ''),
        ...(Array.isArray(payload['sceneIds'])
          ? { sceneIds: asStringArray(payload['sceneIds']) }
          : {}),
      });

    case 'generate_copy':
      return runCopy(context);

    case 'render_animatic':
      return runAnimatic(context, {
        ...(typeof payload['storyboardId'] === 'string'
          ? { storyboardId: payload['storyboardId'] }
          : {}),
      });

    default:
      throw new Error(`No handler for job kind: ${job.kind as string}`);
  }
}

async function enqueueNext(
  context: StageContext,
  kind: JobKind,
  payload: Record<string, unknown>,
  priority: number,
): Promise<void> {
  const { newId } = await import('@act-one/core');
  const now = new Date().toISOString();
  await context.store.jobs.enqueue({
    id: newId('job'),
    organizationId: context.organizationId,
    projectId: context.project.id,
    kind,
    state: 'queued',
    payload,
    progress: 0,
    statusMessage: '',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    startedAt: null,
    priority,
    createdAt: now,
    updatedAt: now,
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export { jobIsTerminal };
