import {
  CreativeEscalation,
  DEFAULT_PRODUCTION_BUDGET,
  ProductionBudget,
  budgetAllowsReplan,
  spendReplan,
  jobAdvancesProject,
  newId,
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
import { runLocalisation } from './stages/localize.ts';
import { runCopy } from './stages/copy.ts';
import { runAnimatic } from './stages/animatic.ts';
import { runAudioEdition } from './stages/audio-edition.ts';
import { runRevision } from './stages/revision.ts';
import { runSceneAssets } from './stages/assets.ts';
import { runCreativeReplan } from './stages/replan.ts';

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
  creative_replan: 'storyboarding',
  generate_campaign: 'rendering_motion',
  generate_copy: 'writing_copy',
  produce_audio: 'sound',
  localise_film: 'rendering_motion',
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
    activity: async (event) => {
      try {
        await store.jobEvents.record({
          id: newId('jev'),
          organizationId: job.organizationId,
          projectId: job.projectId!,
          jobId: job.id,
          at: event.at ?? new Date().toISOString(),
          step: event.step ?? null,
          kind: event.kind,
          label: event.label.slice(0, 200),
          detail: event.detail?.slice(0, 400) ?? null,
          status: event.status ?? 'done',
          index: event.index ?? null,
        });
      } catch (error) {
        console.error('[runner] activity not recorded:', (error as Error).message.slice(0, 160));
      }
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

    await store.jobs.fail(job.id, appError.message, retryAt, appError.code);

    /*
     * A failure fails the project only if the job was moving the project along.
     *
     * The customer needs to see that it stopped rather than an eternal spinner
     * — but a side errand is not the project. A campaign cut, an audio version
     * or a master in another language all run beside a film that is already
     * finished and delivered, and marking that project failed puts a red
     * status over the top of a page showing the customer their finished film.
     * The errand's own panel says what happened to the errand.
     */
    if (!retryAt && jobAdvancesProject(job.kind)) {
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

    case 'render_film': {
      /*
       * The film orchestrator.
       *
       * The render stage makes a film and repairs what a timeline edit can
       * repair. When it hands up a `creative_replan_required` the problem is
       * authorial, and this — not the renderer — decides what happens next:
       * spend a creative replan if the budget has one, and queue another
       * render of the beat the Director rewrote.
       *
       * The budget travels on the job rather than being read from
       * configuration each time, so a loop cannot refill its own tank by
       * enqueueing itself.
       */
      const budget = ProductionBudget.parse(
        (payload['budget'] as Record<string, unknown>) ?? DEFAULT_PRODUCTION_BUDGET,
      );
      // No watermark flag in the payload: the plan decides, in the worker,
      // at the moment the film is made.
      const outcome = await runRender(context, {
        storyboardId: String(payload['storyboardId'] ?? context.project.activeStoryboardId ?? ''),
        maxRepairAttempts: budget.deterministicPasses,
      });

      if (outcome.escalation && budgetAllowsReplan(budget)) {
        await enqueueNext(
          context,
          'creative_replan',
          {
            escalation: outcome.escalation,
            budget: spendReplan(budget, outcome.escalation.sceneIds.length > 1),
            attempt: DEFAULT_PRODUCTION_BUDGET.creativeReplans - budget.creativeReplans,
          },
          9,
        );
      }
      return outcome;
    }

    case 'creative_replan': {
      const escalation = CreativeEscalation.parse(payload['escalation']);
      const budget = ProductionBudget.parse(
        (payload['budget'] as Record<string, unknown>) ?? DEFAULT_PRODUCTION_BUDGET,
      );
      const replanned = await runCreativeReplan(context, {
        escalation,
        budget,
        attempt: Number(payload['attempt'] ?? 0),
      });

      /*
       * A replan that produced nothing usable spends its attempt and asks
       * again, while there is budget for it.
       *
       * The director is not deterministic: two calls on the same beat produce
       * different options, and a proposal that fell half a second short of
       * filling the beat is not evidence that no proposal can. Stopping on the
       * first empty answer left the budget unspent and the film held for a
       * person over something the next attempt would have fixed. When the
       * budget is gone the film stands as the last whole one, which the render
       * has already committed and already explained.
       */
      if (!replanned.storyboardId) {
        if (budgetAllowsReplan(budget)) {
          await enqueueNext(
            context,
            'creative_replan',
            {
              escalation,
              budget: spendReplan(budget, escalation.sceneIds.length > 1),
              attempt: Number(payload['attempt'] ?? 0) + 1,
            },
            9,
          );
        }
        return replanned;
      }

      await enqueueNext(
        context,
        'render_film',
        { storyboardId: replanned.storyboardId, budget },
        9,
      );
      return replanned;
    }

    case 'render_variant':
      return runRender(context, {
        storyboardId: String(payload['storyboardId'] ?? ''),
        aspect: (payload['aspect'] as '16:9') ?? '16:9',
        skipVisionQa: true,
      });

    case 'generate_campaign':
      return runCampaign(context, { renderId: String(payload['renderId'] ?? '') });

    case 'localise_film':
      return runLocalisation(context, {
        renderId: String(payload['renderId'] ?? ''),
        language: String(payload['language'] ?? ''),
      });

    case 'repair_scene':
      return runRevision(context, {
        storyboardId: String(payload['storyboardId'] ?? ''),
        instruction: String(payload['instruction'] ?? ''),
        authorUserId: String(payload['authorUserId'] ?? ''),
        ...(typeof payload['revisionRequestId'] === 'string'
          ? { revisionRequestId: payload['revisionRequestId'] }
          : {}),
        rerender: payload['rerender'] === true,
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

    case 'produce_audio':
      return runAudioEdition(context, {
        ...(typeof payload['editionId'] === 'string' ? { editionId: payload['editionId'] } : {}),
        ...(typeof payload['storyboardId'] === 'string' ? { storyboardId: payload['storyboardId'] } : {}),
        ...(typeof payload['brandVoiceId'] === 'string' ? { brandVoiceId: payload['brandVoiceId'] } : {}),
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
    lastErrorCode: null,
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
