import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  cutAspect,
  FILM_CUTS,
  pitchDrift,
  AUDIO_STANDARDS,
  DEFAULT_FPS,
  DIALOGUE_LEAD_MIN,
  cite,
  dimensionsFor,
  displayHost,
  firstClause,
  isRealProductAsset,
  newId,
  posterMoment,
  REAL_PRODUCT_VISUAL_TYPES,
  storyboardDuration,
  type AspectRatio,
  type BrandSystem,
  type ProductUnderstanding,
  normalizeFindings,
  blocksRelease,
  type QaFinding,
  type Render,
  type RenderKind,
  type RenderQuality,
  weakestDimensions,
  type DirectorsVerdict,
  type Storyboard,
  type SpeechQuality,
  directVoice,
  type FilmCut,
  type QaIssue,
  type RepairRecord,
  type RepairAction,
  type ReleaseState,
  type RepairScore,
  type QaCheck,
  type QaLayer,
  type FilmContract,
  type DeliveryFacts,
  type ProjectStage,
  deliveryState,
  CreativeEscalation,
  releaseDecision,
} from '@act-one/core';
import { getSystem } from '@act-one/creative';
import { renderFilm } from '@act-one/motion';
import { resolveTokens } from '@act-one/design';
import {
  bedReductionDb,
  buildMix,
  directSound,
  masterLoudness,
  measureDialogueLead,
  mixArgs,
  muxArgs,
  posterArgs,
  runFfmpeg,
  DEFAULT_LIBRARY,
} from '@act-one/sound';
import {
  abruptEndIssue,
  applyRepairs,
  buildContactSheet,
  captionSyncIssues,
  colourShares,
  deadAirIssues,
  distributionIssues,
  factCheck,
  flashIssues,
  heldFrameIssues,
  inspectFrame,
  isFullRange,
  levelJumpIssues,
  measureFilm,
  silentMasterIssue,
  parseFrameStats,
  planRepairs,
  rangeIssues,
  redFlashIssues,
  redirectFor,
  redness,
  relativeLuminance,
  reviewCut,
  runDeterministicChecks,
  selectFramesToInspect,
  speechDriftIssues,
  verdictIssues,
  verifyMaster,
  type SpokenLine,
  beginRepair,
  settleRepairs,
  retimeCaptionsToSpeech,
  contractFor,
  scoreRepair,
  type RepairIntent,
} from '@act-one/qa';
import { footageAmong, resolveAssetUrls, storeAsset, type StageContext } from '../context.ts';
import { runSceneAssets } from './assets.ts';
import { runCreativeMasterGate } from './creative-gate.ts';
import {
  renderModeFor,
  summariseCoverage,
  visualReadiness,
  type MasterReadiness,
  type RenderMode,
} from '../master-readiness.ts';
import { masterTermsFor, planAllows, planFor } from '../entitlements.ts';
import { narrate } from '../narration.ts';
import { captionFilm, NO_CAPTIONS, type FilmCaptions } from './captions.ts';
import { scoreFilm } from './score.ts';

/**
 * The render stage.
 *
 * Motion, sound, mix, mux, QA, repair — in that order, with the repair loop
 * bounded. Every intermediate lands in a temp directory that is removed in a
 * finally block: a render worker that leaks a 4K frame sequence per job fills
 * its disk in a morning.
 */
export type RenderOptions = {
  storyboardId: string;
  aspect?: AspectRatio;
  /**
   * Overrides the resolution the plan would give.
   *
   * Only the animatic sets this. Watermarking is not overridable at all: it is
   * what a plan pays to remove, so it is decided here from the plan and nowhere
   * else.
   */
  quality?: RenderQuality;
  maxRepairAttempts?: number;
  /** Skips vision QA. Used for previews and animatics, where it is not worth it. */
  skipVisionQa?: boolean;
  /**
   * What this render is: the film, a campaign cut, or a timing animatic.
   *
   * Only a film is a deliverable. Anything else must not become the project's
   * latest render — or the page offers a six-second bumper as the master, the
   * cuts stop appearing beside it because they hang off a render nothing points
   * at any more, and the next campaign is cut from a cut — and must not spend a
   * render from the customer's plan.
   */
  kind?: RenderKind;
  /**
   * Whether the captions go into the picture as well as beside it.
   *
   * Set per cut, from the format's own spec: a vertical ad is watched muted in
   * a feed, where a caption the viewer has to switch on is a caption nobody
   * reads. Every render gets the sidecar track regardless.
   */
  burnCaptions?: boolean;
};

export async function runRender(
  context: StageContext,
  options: RenderOptions,
): Promise<{
  renderId: string;
  assetId: string;
  qaPassed: boolean;
  issues: QaFinding[];
  /**
   * What the render could not solve, for whoever can.
   *
   * The render and repair layers edit a timeline; they do not author. When a
   * defect turns out to be authorial — a beat with a second of content in a
   * six-second slot — they stop and say so precisely, and the orchestrator
   * takes it from there. This is the one place the renderer talks upwards,
   * and it does it with a structure rather than by calling a model.
   */
  escalation: CreativeEscalation | null;
}> {
  const { store, registry, project, organizationId } = context;
  /*
   * The master is composed in its own cut's frame.
   *
   * This used to be sixteen by nine unless a campaign cut said otherwise,
   * which meant a customer who asked for a reel got a landscape film and a
   * vertical crop of it afterwards — the exact thing a reel must not be. A cut
   * passed in the options still wins, because that is the campaign asking for
   * a specific frame from material already approved.
   */
  const cut = project.brief.filmCut;
  const aspect = options.aspect ?? cutAspect(cut);
  const kind = options.kind ?? 'film';
  /*
   * And a short wears its captions in the picture. It is watched muted in a
   * feed, where a caption the viewer has to switch on is a caption nobody
   * reads. A caller that has decided for itself — the campaign — still wins.
   */
  const burnCaptions = options.burnCaptions ?? FILM_CUTS[cut].captionsBurned;

  /*
   * The plan decides the master, and the worker asks the plan rather than
   * believing the job payload. Pro sells 4K and this defaulted to 1080p, so the
   * most expensive plan delivered what the one below it did; and a job that sat
   * in the queue while a subscription lapsed used to keep the answer from when
   * it was enqueued.
   *
   * Cuts inherit the film's terms. An animatic is neither: it is a preview at
   * preview resolution whatever anybody is paying.
   */
  /*
   * Preview or master, decided once and carried.
   *
   * The kind has always been recorded and never enforced: an animatic and a
   * film went through the same composition with the same behaviour, and that
   * behaviour was to draw type whenever a picture was missing. Only one of
   * the two is allowed to do that.
   */
  const mode = renderModeFor(kind);
  const plan = await planFor(store, organizationId);
  const terms = masterTermsFor(plan);
  const quality = options.quality ?? (kind === 'animatic' ? 'preview' : terms.quality);
  const watermarked = kind === 'animatic' ? false : terms.watermarked;
  // The voice, by entitlement and never by plan name: the premium engine for
  // finals, alternative takes where the plan carries them.
  const voice: VoiceTerms = {
    premium: planAllows(plan, 'voice.premium'),
    takes: planAllows(plan, 'voice.takes') ? registry.config.speech.takes : 1,
    regenerations: registry.config.speech.maxRegenerations,
  };

  const storyboard = await store.storyboards.get(organizationId, options.storyboardId);
  if (!storyboard) throw new AppError('not_found', 'Storyboard not found.');

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  // The creative system decides pacing, type scale, canvas and sound behaviour.
  // Resolving it from the storyboard's own concept is what makes two customers
  // on the same pipeline get films that do not look alike.
  const concept = await store.concepts.get(organizationId, storyboard.conceptId);
  if (!concept) throw new AppError('conflict', 'The concept behind this storyboard is missing.');
  const system = getSystem(concept.creativeSystem);

  await assertProductIsReal(context, storyboard);

  // Loaded once: the end card needs the customer's own line about themselves,
  // and the fact check needs the evidence behind every claim on screen.
  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : null;

  const render = await store.renders.create({
    id: newId('rnd'),
    projectId: project.id,
    storyboardId: storyboard.id,
    organizationId,
    kind,
    /*
     * Films are numbered; cuts and animatics ride the version of the film they
     * come from, so "version 3" always means the customer's third film.
     *
     * At least one, always. An animatic is usually made before any film
     * exists, and the arithmetic gave it version 0 \u2014 which the schema has
     * forbidden since it was written and nothing ever checked, because the
     * store took a whole `Render` and never parsed it. A preview of the film
     * that does not exist yet is a preview of version 1.
     */
    version: versionFor(kind, await store.renders.countForProject(organizationId, project.id)),
    aspect,
    quality,
    fps: DEFAULT_FPS,
    status: 'rendering_scenes',
    masterAssetId: null,
    posterAssetId: null,
    captionsAssetId: null,
    watermarked,
    durationSeconds: storyboardDuration(storyboard),
    costUsd: 0,
    qaReportId: null,
    productionVerdict: null,
    creativeVerdict: null,
    creativeReason: '',
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    createdAt: new Date().toISOString(),
  });

  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-render-'));

  try {
    let current = storyboard;
    let issues: QaFinding[] = [];
    let masterPath = '';
    /*
     * From the last attempt, not the first: a repair re-reads the shots it
     * changed, so the timings shift and a track built from the first pass
     * would caption a film that no longer exists.
     */
    let captions: FilmCaptions = NO_CAPTIONS;
    const maxAttempts = options.maxRepairAttempts ?? 2;

    /*
     * The repair record.
     *
     * What was wrong, what was tried, whether it worked, and what it cost in
     * money and in the customer's waiting. None of this was kept before, so
     * "did the loop help" and "what does a repair cost us" were both
     * unanswerable, and the Quality page could only count defects rather than
     * whether they were being fixed.
     */
    const repairs: RepairRecord[] = [];
    let attempted: RepairRecord[] = [];
    let previousFindings: QaIssue[] = [];
    let filmRepairs: RepairAction[] = [];
    let extraCostUsd = 0;
    let extraLatencyMs = 0;
    let extraComputeMs = 0;
    let rendersSpent = 0;
    let releaseState: ReleaseState = 'generating';
    let costBeforePass = await store.costs.totalForProject(organizationId, project.id);
    let passStartedAt = Date.now();

    /*
     * A repair pass is a transaction.
     *
     * `accepted` is the last cut that was rendered and judged whole: the film
     * as it stands. A pass builds a `candidate` from it, renders that, and
     * scores it against the contract. Only a candidate that keeps every
     * constraint replaces the accepted cut; one that does not is rolled back,
     * and the film the customer gets is the one from before rather than a
     * half-repaired thing nobody approved.
     *
     * Without this the loop could only move forwards. A trim that removed
     * every held frame and half the runtime was applied, saved over the
     * storyboard, and delivered — there was no state to go back to and
     * nothing that would have wanted to.
     */
    const contract = contractFor(storyboard, { cut });
    let accepted = storyboard;
    let acceptedFindings: QaIssue[] = [];
    let lastScore: RepairScore | null = null;
    let intent: RepairIntent = {};
    let targeted: QaIssue[] = [];
    let starved: string[] = [];
    /** The checks with no automatic repair, so the hold says what is actually wrong. */
    let heldBy: string[] = [];
    let escalation: CreativeEscalation | null = null;
    let qaLayers: QaLayer[] = [];
    /** What the director said watching the last cut back, for the creative gate. */
    let directorsVerdict: DirectorsVerdict | null = null;
    let starvedCheck: QaCheck = 'still_frame_hold';
    /** The manifest the delivered cut was rendered from. Null until the first pass. */
    let lastReadiness: MasterReadiness | null = null;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      const rendered = await renderOnce(context, {
        render,
        filmRepairs,
        storyboard: current,
        brand,
        system,
        aspect,
        quality,
        watermarked,
        workDir,
        attempt,
        understanding,
        voice,
        burnCaptions,
        mode,
      });
      masterPath = rendered.path;
      captions = rendered.captions;
      lastReadiness = rendered.readiness;

      const inspected = await inspect(context, {
        storyboard: current,
        brand,
        aspect,
        masterPath,
        workDir,
        skipVision: options.skipVisionQa ?? false,
        understanding,
        attempt,
        captions: rendered.captions,
        spoken: rendered.spoken,
        cut,
        fps: DEFAULT_FPS,
        durationSeconds: storyboardDuration(current),
        hasSound: rendered.hasSound,
      });
      issues = inspected.issues;
      qaLayers = inspected.layers;
      // Carried out of the loop so the creative gate can read what the
      // director already said rather than pay to have it watched twice.
      directorsVerdict = inspected.watched;

      /*
       * A film that was scored and came out silent.
       *
       * Not repairable by any storyboard edit: the library is not provisioned,
       * and that is an operator's job. It used to be a major rather than a
       * blocker, on the reasoning that the picture is finished and withholding
       * it helps nobody. What that reasoning produced was a customer opening
       * their launch film and hearing nothing, with the system calling it
       * READY — so the severity now follows what is actually missing. Every
       * file gone is a film with no sound at all and does not ship; some files
       * gone is a thinner mix, which is a note.
       */
      issues = [...issues, ...rendered.soundIssues, ...rendered.degradedIssues];
      if (rendered.missingAudio.length > 0) {
        /*
         * Every file the score asked for, gone, and no voice to carry the
         * film instead: that is not a thinner mix, it is no sound at all.
         */
        const everything =
          rendered.soundKeys > 0 &&
          rendered.missingAudio.length >= rendered.soundKeys &&
          rendered.spoken.length === 0;
        issues = [
          ...issues,
          {
            id: newId('evt'),
            sceneId: null,
            timecodeStart: null,
            detectedBy: 'deterministic',
            evidenceAssetId: null,
            check: 'missing_audio',
            severity: everything ? 'hard_fail' : 'soft_fail',
            message:
              `The sound library is missing ${rendered.missingAudio.length} of ${rendered.soundKeys} ` +
              `file(s), so this film is silent where it was scored. Run \`npm run sound-library\`. ` +
              `First missing: ${rendered.missingAudio[0]}`,
            confidence: 1,
            repair: 'manual_review',
          },
        ];
      }

      /*
       * Loose findings become real ones here, once.
       *
       * Every check hands back what it knows and leaves the rest alone; this
       * is where the defaults are filled and each check is stamped with the
       * layer it belongs to, so nothing downstream has to guess.
       */
      let findings = normalizeFindings(issues);
      rendersSpent += 1;
      const report = await store.qaReports.create(
        {
          id: newId('ast'),
          renderId: render.id,
          projectId: project.id,
          passed: !findings.some((issue) => blocksRelease(issue.severity)),
          state: 'analyzing',
          attempt,
          issues: findings,
          repairs: [],
          extraCostUsd: 0,
          extraLatencyMs: 0,
          extraComputeMs: 0,
          extraComputeCostUsd: 0,
          rendersSpent: 0,
          score: null,
          /*
           * The passes that actually ran. A layer that found nothing and a
           * layer that never ran produce the same empty list of findings and
           * mean opposite things.
           */
          layers: qaLayers,
          // What was being made, so the console can break failures down by it
          // without joining back to a project that may have changed since.
          cut,
          format: project.brief.filmFormat,
          renderKind: kind,
          durationSeconds: storyboardDuration(current),
          shots: current.scenes.map((scene) => ({ sceneId: scene.id, archetype: scene.visualType })),
          framesInspected: findings.length,
          // What this pass was rendered from, kept with its verdict.
          coverage: rendered.readiness.coverage,
          createdAt: new Date().toISOString(),
        },
        organizationId,
      );

      /*
       * What the last pass's repairs actually achieved.
       *
       * Settled here rather than when they were applied, because the only
       * evidence a repair worked is that its finding did not come back — and
       * that is not knowable until the film has been rendered and inspected
       * again. The cost and the wait are divided across the repairs of that
       * pass, which is the honest attribution when they shared a render.
       */
      if (attempted.length > 0) {
        /*
         * Judge the whole film, not only the defect that was repaired.
         *
         * `scoreRepair` asks four questions: did the targeted defects go, did
         * anything new arrive, does the cut still satisfy the contract the
         * customer approved, and is the material still all there. A candidate
         * that fails any of them is rolled back — which is the difference
         * between a repair loop and a loop that grinds a film down.
         */
        const score = scoreRepair({
          contract,
          candidate: current,
          before: acceptedFindings,
          after: findings,
          targeted,
          intent,
        });
        lastScore = score;

        const wallClockMs = Date.now() - passStartedAt;
        const computeMs = wallClockMs;
        const settled = settleRepairs({
          attempted,
          before: previousFindings,
          after: findings,
          providerCostUsd: Math.max(
            0,
            (await store.costs.totalForProject(organizationId, project.id)) - costBeforePass,
          ),
          computeMs,
          estimatedComputeCostUsd: computeCostUsd(computeMs),
          wallClockMs,
          rejected: !score.accepted,
        });
        repairs.push(...settled);
        extraCostUsd += settled.reduce((sum, record) => sum + record.providerCostUsd, 0);
        extraLatencyMs += wallClockMs;
        extraComputeMs += computeMs;
        attempted = [];

        if (!score.accepted) {
          /*
           * Roll back, and stop pretending a repair is available.
           *
           * The candidate is discarded, the storyboard goes back to the cut
           * that was last whole, and the film is handed to a person with the
           * reason in plain words. Trying the same class of repair again would
           * produce the same rejection and spend another render proving it.
           */
          current = accepted;
          await store.storyboards.replaceScenes(organizationId, current.id, current.scenes);
          findings = acceptedFindings;
          releaseState = 'needs_attention';
          /*
           * The one case the deterministic layer can diagnose but not solve.
           *
           * A beat gave time back that no shot could carry, so the only edit
           * left would take the film under the runtime the customer approved.
           * That is not a timing problem, and the orchestrator is told exactly
           * which beat, how much room it has, and how much it earns.
           */
          if (starved.length > 0) {
            escalation = CreativeEscalation.parse({
              type: 'creative_replan_required',
              renderId: render.id,
              storyboardId: current.id,
              sceneIds: starved,
              check: starvedCheck,
              diagnosis: replanMessage(score, starved, current),
              requiredSeconds: contract.approvedSeconds,
              usableSeconds: round3(
                Math.max(0, contract.approvedSeconds - (score.runtimeBefore - score.runtimeAfter)),
              ),
              preservedConstraints: contractLines(contract, project),
              previousAttempts: repairs.map((repair) => ({
                action: repair.action,
                outcome: repair.outcome,
                attempt: repair.attempt,
              })),
            });
          }
          await store.qaReports.update?.(organizationId, report.id, {
            state: releaseState,
            issues: findings,
            repairs,
            score,
            extraCostUsd: round3(extraCostUsd),
            extraLatencyMs,
            extraComputeMs,
            extraComputeCostUsd: computeCostUsd(extraComputeMs),
            rendersSpent,
          });
          await store.renders.update(organizationId, render.id, {
            qaReportId: report.id,
            status: 'needs_attention',
            error: replanMessage(score, starved, current),
          });
          await context.activity({
            step: 'motion',
            kind: 'refine',
            label: 'final quality pass',
            detail: score.reason,
            status: 'done',
          });
          break;
        }

        /*
         * Accepted: this is the film now, and the diagnosis goes with it.
         *
         * `starved` names the beats whose recovered time had nowhere to go.
         * Left standing after an accepted pass it described a problem that no
         * longer existed, and the film was held with a reason about a beat
         * that had just been fixed.
         */
        accepted = current;
        starved = [];
      }
      acceptedFindings = findings;
      previousFindings = findings;

      const plan = planRepairs({ report, attempt, maxAttempts, history: repairs, deliverable: kind !== 'animatic' });

      if (plan.shippable || plan.deadEnd) {
        releaseState = plan.state;
        heldBy = plan.manual.map((issue) => issue.check);
        await store.qaReports.update?.(organizationId, report.id, {
          state: plan.state,
          repairs,
          score: lastScore,
          extraCostUsd: round3(extraCostUsd),
          extraLatencyMs,
          extraComputeMs,
          extraComputeCostUsd: computeCostUsd(extraComputeMs),
          rendersSpent,
        });
        await store.renders.update(organizationId, render.id, {
          qaReportId: report.id,
          status: plan.state === 'ready' ? 'qa' : 'needs_attention',
          ...(plan.state === 'ready'
            ? {}
            : { error: replanMessage(lastScore, starved, current, heldBy) }),
        });
        // Whatever was being refined is finished, one way or the other.
        if (attempt > 0) {
          await context.activity({ step: 'motion', kind: 'refine', label: 'shots refined', status: 'done' });
        }
        break;
      }

      /*
       * Not a failure: the film was inspected, some of it did not meet the
       * standard, and it is being worked on again. The customer is told what
       * is happening in the words of the work — "Repairing timing", "Improving
       * the audio mix" — and never in the words of the checker.
       */
      releaseState = 'repairing';
      const total = plan.scenes.length + plan.film.length;
      await store.renders.update(organizationId, render.id, { status: 'repairing' });
      /*
       * One line, the same every time.
       *
       * The customer used to read the repair: "Repairing the timing",
       * "Optimising the captions". Said once it sounds like craft; said on
       * every small defect of every film it sounds like an engine struggling,
       * and it invites a question — what was wrong with my film? — that the
       * answer to is "nothing you will ever see". The detail is on the
       * console, in the report and in the logs, where somebody acts on it.
       */
      await context.progress(0.8, 'Polishing the final cut');
      await context.activity({
        step: 'motion',
        kind: 'refine',
        label: 'final quality pass',
        // Operator-facing, and the only place the actions are named.
        detail: `${repairHeadline(plan)} · ${total} repair${total === 1 ? '' : 's'}`,
        status: 'active',
      });

      for (const repair of plan.scenes) {
        attempted.push(beginRepair({ ...repair, attempt }));
      }
      for (const repair of plan.film) {
        attempted.push(beginRepair({ ...repair, sceneId: null, attempt }));
      }

      /*
       * Only what broke, and the film keeps its length.
       *
       * Re-rendering everything would change scenes the customer already
       * approved. Handing the approved runtime to `applyRepairs` is what keeps
       * a trim from being a deletion: the seconds a dead hold gives back go to
       * the shots that can carry them, and what cannot be placed is reported.
       */
      targeted = [...plan.scenes, ...plan.film].flatMap((repair) =>
        findings.filter((issue) => issue.id === repair.issueId),
      );
      intent = {
        removing: plan.scenes.filter((r) => r.action === 'remove_scene').map((r) => r.sceneId),
        refetching: plan.scenes
          .filter((r) => REGENERATES.has(r.action))
          .map((r) => r.sceneId),
      };
      const applied = applyRepairs(current, plan, {
        issues: findings,
        cut,
        preserveSeconds: contract.approvedSeconds,
      });
      current = applied.storyboard;
      starved = applied.starvedSceneIds;
      /*
       * A repair that asks for material has to be given some.
       *
       * `applyRepairs` clears a shot's assets and marks it `assets_pending`
       * when a repair says to fetch the picture again — and until now nothing
       * read the list it hands back. The next pass therefore rendered a shot
       * with no assets at all, which is to say as type on the canvas: the
       * repair loop turning a flawed picture into no picture, quietly, and
       * calling it a repair. The asset stage is asked for exactly those
       * scenes, and what it cannot produce comes back as a blocker on the
       * next readiness pass rather than as a title card.
       */
      const refetch = [...new Set(applied.needsProvider.map((entry) => entry.sceneId))];
      if (refetch.length > 0) {
        await store.storyboards.replaceScenes(organizationId, current.id, current.scenes);
        try {
          const reacquired = await runSceneAssets(context, {
            storyboardId: current.id,
            sceneIds: refetch,
          });
          await context.activity({
            step: 'captures',
            kind: 'note',
            label: `re-acquiring ${refetch.length} shot${refetch.length === 1 ? '' : 's'}`,
            detail: `${reacquired.generated} produced, ${reacquired.failed} failed, ${reacquired.skipped} skipped`,
            status: reacquired.failed > 0 ? 'failed' : 'done',
          });
          extraCostUsd += reacquired.costUsd;
        } catch (error) {
          // A provider that will not answer is a blocker, not a crash: the
          // readiness pass below states it in terms an operator can act on.
          console.error('[render] re-acquisition failed:', (error as Error).message.slice(0, 200));
        }
        const refreshed = await store.storyboards.get(organizationId, current.id);
        if (refreshed) current = refreshed;
      }
      if (applied.starvedSceneIds.length > 0) {
        starvedCheck =
          findings.find((issue) => applied.starvedSceneIds.includes(issue.sceneId ?? ''))?.check ??
          'still_frame_hold';
      }
      await store.storyboards.replaceScenes(organizationId, current.id, current.scenes);
      filmRepairs = plan.film.map((repair) => repair.action);
      costBeforePass = await store.costs.totalForProject(organizationId, project.id);
      passStartedAt = Date.now();
    }

    await context.progress(0.93, 'Checking the file will play');

    /*
     * The last gate, on the bytes that will be delivered.
     *
     * The container has to say the right things — avc1 in a known brand, a
     * profile and level every decoder covers, 4:2:0 8-bit, BT.709 tagged in
     * the bitstream, AAC-LC, the index ahead of the media — and the decoder
     * has to get through every frame without complaint. Nobody on this project
     * had ever watched a master play in a browser, because the development
     * Chromium has no H.264; this is what stands in for that, on every render.
     * A master that would not play is not delivered, and the job says why.
     */
    const target = dimensionsFor(aspect, quality);
    const playable = await verifyMaster(
      masterPath,
      { width: target.width, height: target.height },
      { ...(context.signal ? { signal: context.signal } : {}) },
    );
    if (playable.issues.length > 0) {
      throw new AppError(
        'internal',
        `The master would not play: ${playable.issues.join(' ')}`,
        { publicMessage: 'The film did not come out of the encoder in a form every player accepts. We have stopped rather than deliver it; try again.' },
      );
    }

    await context.progress(0.95, 'Saving your film');

    const master = await storeAsset(context, {
      data: new Uint8Array(await readFile(masterPath)),
      kind: 'master_video',
      origin: 'rendered',
      rights: 'customer_owned',
      extension: 'mp4',
      contentType: 'video/mp4',
      durationSeconds: storyboardDuration(current),
      metadata: { aspect, quality, watermarked },
    });

    /*
     * Read it back before calling it delivered.
     *
     * Every check up to here has been on a file in this worker's temp
     * directory. What the customer plays is whatever comes back out of
     * storage, and those are the same bytes only if the store is one both
     * services can reach. A deployment with no object store configured fell
     * back to local disk: the worker wrote each master to its own instance,
     * the web service answered ENOENT to every download, and the film existed
     * in the database, was offered on the page and could not be played by
     * anybody. Nothing in the pipeline noticed, because nothing had ever
     * asked storage for a film back.
     *
     * One question, once, at the only moment it can still be answered
     * honestly: is the film there.
     */
    if (!(await registry.storage().exists(master.asset.storageKey))) {
      throw new AppError(
        'internal',
        `The master was stored at ${master.asset.storageKey} and is not readable back from ` +
          `${registry.storage().name}.`,
        {
          publicMessage:
            'Your film was made and could not be saved where you can reach it. ' +
            'Nothing is lost; we have stopped rather than hand you a film that will not play.',
        },
      );
    }

    /*
     * The caption track, stored whether or not it is also in the picture.
     *
     * WCAG asks for captions on prerecorded audio and the sidecar is what a
     * browser, a screen reader and a search index can all read; burning them
     * into the frame satisfies a viewer and nothing else.
     */
    const captionAsset =
      captions.vtt.length > 0
        ? await storeAsset(context, {
            data: new TextEncoder().encode(captions.vtt),
            kind: 'caption_track',
            origin: 'rendered',
            rights: 'customer_owned',
            extension: 'vtt',
            contentType: 'text/vtt',
            metadata: {
              cues: captions.cues.length,
              language: current.language ?? context.project.brief.language ?? null,
              timing: captions.alignedPassages === captions.passages ? 'aligned' : 'estimated',
              burnedIn: burnCaptions,
            },
          })
        : null;

    const posterPath = path.join(workDir, 'poster.jpg');
    const poster = await runFfmpeg(
      // Chosen from the cut rather than from the clock: a fixed 1.5s lands
      // inside the opening animation, and the poster showed type still
      // arriving. See posterMoment.
      posterArgs(masterPath, posterMoment(current.scenes), posterPath),
      { signal: context.signal, timeoutMs: 60_000 },
    );
    const posterAsset = poster.ok
      ? await storeAsset(context, {
          data: new Uint8Array(await readFile(posterPath)),
          kind: 'poster_frame',
          origin: 'rendered',
          rights: 'customer_owned',
          extension: 'jpg',
          contentType: 'image/jpeg',
        })
      : null;

    /*
     * Quality gates exist to stop us delivering a bad film. An animatic is not
     * delivered — it is the customer looking at their own cut while they are
     * still changing it — so it is never failed for the state of the thing they
     * are in the middle of fixing. Held to the same bar, a preview of a
     * storyboard with one unsupported claim in it renders perfectly and is then
     * thrown away, and the customer presses a button that does nothing.
     *
     * The issues are returned either way, and the storyboard shows them.
     */
    /*
     * The gate, on the bytes that are about to be delivered.
     *
     * One function decides this, the same one the loop consulted on every
     * pass, so "may this ship" has exactly one answer in this codebase. Ready
     * requires nothing hard or critical outstanding; a warning may remain, and
     * a soft fail may remain only because the loop already tried and could not
     * repair it, which is recorded rather than ignored.
     */
    const gate = releaseDecision({
      issues: normalizeFindings(issues),
      attempt: maxAttempts,
      maxAttempts,
      deliverable: kind !== 'animatic',
    });
    /*
     * The loop's verdict stands where it is the stricter of the two.
     *
     * `releaseDecision` reads the findings, and a rolled-back pass is not a
     * finding: the film that survived is whole and one of its beats does not
     * earn the room it was given, which no check can say. Recomputing the gate
     * from the findings alone put that film back to `completed` and told the
     * customer it was finished — the exact silence this layer exists to break.
     */
    /*
     * Five facts, then a decision — not one flag that meant four things.
     *
     * A render that succeeded, a repair transaction that may have been rolled
     * back, QA on the cut that actually survived, and an escalation nobody has
     * answered yet are different questions, and a film that rolled back to an
     * earlier whole cut with its defects still in it used to answer "passed"
     * to all of them at once.
     */
    const facts: DeliveryFacts = {
      renderSucceeded: true,
      repairTransactionSucceeded: lastScore === null || lastScore.accepted,
      globalQaPassed: gate.state === 'ready' && releaseState !== 'needs_attention',
      creativeEscalationResolved: escalation === null,
      // A preview is allowed to be incomplete. This is the master gate.
      materialComplete: lastReadiness === null || lastReadiness.ready,
    };
    const productionPassed = deliveryState(facts) === 'ready';

    /*
     * The second gate, on the file that is about to be handed over.
     *
     * Everything above this line asked whether anything is wrong. A film can
     * answer no to all of it and still be thirty seconds of type on a flat
     * field in silence \u2014 which is what a customer received while every
     * check in this system reported success, because every check was reading
     * the plan. So the creative gate opens the master, measures what is
     * actually on the screen and in the track, shows the cut to the panel and
     * asks the director to decide.
     *
     * Not on an animatic: a preview is the customer looking at their own cut
     * while they are still changing it, and it is not delivered.
     */
    const creative =
      kind === 'animatic' || options.skipVisionQa
        ? null
        : await runCreativeMasterGate(context, {
            renderId: render.id,
            storyboard: current,
            masterPath,
            workDir,
            watched: directorsVerdict,
          }).catch((error: unknown) => {
            /*
             * A gate that could not run has not passed. It is recorded as
             * having not run \u2014 `creativeVerdict` stays null \u2014 and the
             * film is not held for it, because withholding a customer's film
             * over an outage is a different failure from withholding it over
             * quality.
             */
            console.error('[render] the creative gate could not run:', (error as Error).message.slice(0, 200));
            return null;
          });

    const creativeOk =
      creative === null || creative.verdict === 'pass' || creative.verdict === 'pass_with_concerns';
    const passed = productionPassed && creativeOk;
    const heldForAPerson = !passed;
    const holdReason = !productionPassed
      ? replanMessage(lastScore, starved, current, heldBy)
      : creativeOk
        ? ''
        : creative!.reason;
    await store.renders.update(organizationId, render.id, {
      /*
       * `needs_attention`, not `failed`.
       *
       * The film exists and is not good enough, which is a different thing
       * from the render throwing — and a customer can be told the difference.
       * Both used to read as failed.
       */
      status: passed ? 'completed' : 'needs_attention',
      masterAssetId: master.asset.id,
      posterAssetId: posterAsset?.asset.id ?? null,
      captionsAssetId: captionAsset?.asset.id ?? null,
      durationSeconds: storyboardDuration(current),
      /*
       * Two verdicts, recorded apart, because they answer different questions
       * and a film can pass one and fail the other. `releasable()` reads both;
       * a gate that never ran stays null rather than being written down as a
       * pass nobody gave.
       */
      productionVerdict: productionPassed ? 'pass' : 'needs_attention',
      ...(creative ? { creativeVerdict: creative.verdict, creativeReason: creative.reason } : {}),
      completedAt: new Date().toISOString(),
      ...(passed ? {} : { error: holdReason || gate.reason || 'Quality checks did not pass.' }),
    });

    /*
     * A film that has escalated is not a failed project.
     *
     * The Creative Director has been handed the beat and the orchestrator is
     * about to queue another render. Marking the project failed here put a red
     * status over a production that was still being worked on, and the
     * customer would have watched it fail and then quietly un-fail.
     *
     * `qa` is the honest stage for it: the film exists, it is being judged,
     * and nobody needs to do anything yet.
     */
    const filmStage: ProjectStage = passed ? 'film_ready' : escalation ? 'qa' : 'failed';
    await store.projects.update(
      organizationId,
      project.id,
      kind === 'film'
        ? { latestRenderId: render.id, stage: filmStage }
        : // A cut that fails is one missing format, not a failed project: the
          // film is still finished and the other cuts still arrive. An animatic
          // that fails cost the customer nothing and changed nothing.
          {},
    );

    // A finished film is what a referral was waiting for. Never allowed to
    // fail the render: the customer's film is delivered either way.
    if (kind === 'film' && passed) {
      try {
        const { advanceReferral } = await import('@act-one/db');
        await advanceReferral(store, organizationId, 'film_ready');
      } catch (error) {
        console.error('[render] referral reward failed', error);
      }
    }

    await context.activity({
      step: 'composition',
      kind: 'step',
      label: passed ? 'film mastered and saved' : 'finished, with issues to look at',
      status: 'done',
    });
    await context.progress(1, passed ? 'Done' : 'Finished — one thing needs your eye');
    /*
     * The honest QA result, which is the delivery decision.
     *
     * These used to differ: `qaPassed` counted blockers and the status came
     * from the gate, so a film held back for a person came back reporting
     * that QA had passed. One answer, and it is the one the render row says.
     */
    return { renderId: render.id, assetId: master.asset.id, qaPassed: passed, issues, escalation };
  } catch (error) {
    await store.renders.update(organizationId, render.id, {
      status: 'failed',
      error: (error as Error).message.slice(0, 1000),
      completedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    // Always. A leaked frame sequence per job fills a render host's disk in a
    // morning, and the failure that follows looks nothing like the cause.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** What number this render carries: the next film, or the film the rest ride on. */
export function versionFor(kind: RenderKind, filmsMade: number): number {
  return kind === 'film' ? filmsMade + 1 : Math.max(1, filmsMade);
}

/**
 * Refuses to render a film that would show invented software as the product.
 *
 * This is the product's one absolute rule and it is checked here, at the
 * boundary where frames are about to be made, rather than trusted to hold
 * because of how the storyboard was planned. Planning is upstream of a
 * revision, a repair pass and a campaign cut, any of which can rewrite a
 * scene; a check that runs before every render survives all three.
 *
 * It refuses rather than degrades. A scene silently dropped to typography is a
 * film the customer still receives, believing the product beat is theirs.
 */
async function assertProductIsReal(context: StageContext, storyboard: Storyboard): Promise<void> {
  const productScenes = storyboard.scenes.filter((scene) =>
    REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType),
  );

  /*
   * And a pitch is refused when it has become a product tour.
   *
   * Not when it shows the product — one glimpse is the point of allowing it —
   * but when the interface opens the film, carries two beats in a row, runs
   * past a fifth of the runtime, or is being worked through. Checked here for
   * the same reason as everything else in this function: planning is upstream
   * of a revision, a repair pass and a campaign cut, and any of those can turn
   * a cutaway into a walkthrough.
   */
  if (context.project.brief.filmFormat === 'pitch') {
    const drift = pitchDrift(storyboard.scenes);
    const blocking = drift.filter((entry) => entry.severity === 'blocking');
    if (blocking.length > 0) {
      throw new AppError(
        'unsafe_operation',
        `This production is a pitch film, and it has become a product tour. ${blocking
          .map((entry) => entry.message)
          .join(' ')} Switch the production to a product tour, or direct those scenes another way.`,
      );
    }
    /*
     * The rest are signals rather than verdicts, and they go on the record
     * instead of stopping the film. A pitch that opens on a striking frame of
     * the product may be exactly what the director wanted; refusing to render
     * it would be a system overruling the person it works for.
     */
    for (const entry of drift) {
      await context.activity({
        step: 'composition',
        kind: 'note',
        label: 'the story is meant to lead here',
        detail: entry.message,
        status: 'done',
      });
    }
  }

  const ids = [...new Set(productScenes.flatMap((scene) => scene.assetRefs))];
  if (ids.length === 0) return;

  const assets = await context.store.assets.getMany(context.organizationId, ids);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  for (const scene of productScenes) {
    for (const id of scene.assetRefs) {
      const asset = byId.get(id);
      // An id that resolves to nothing renders as no imagery at all, which is
      // a worse-looking scene and not a false one. Only a real asset that is
      // not the product is a reason to stop.
      if (!asset || isRealProductAsset(asset)) continue;
      throw new AppError(
        'unsafe_operation',
        `Scene ${scene.index + 1} shows the product but is backed by ${asset.origin} material. ` +
          'Act One does not present generated imagery as a real interface.',
      );
    }
  }
}

/**
 * What the customer is told while a repair runs.
 *
 * In the words of the work, not the words of the checker. "Optimising
 * captions" is something a post-production house says; "caption_onset
 * soft_fail x2" is something only this codebase should ever see. The
 * obsessiveness is internal — what reaches the person who paid is that their
 * film is being looked after.
 */
function repairHeadline(plan: { scenes: { action: RepairAction }[]; film: { action: RepairAction }[] }): string {
  const actions = [...plan.film.map((r) => r.action), ...plan.scenes.map((r) => r.action)];
  const first = actions[0];
  switch (first) {
    case 'retime_captions':
    case 'reposition_captions':
      return 'Optimising the captions';
    case 'retime_scene':
    case 'trim_hold':
    case 'reduce_duration':
      return 'Repairing the timing';
    case 'remix_audio':
    case 'realign_audio':
    case 'refade_audio':
      return 'Improving the audio mix';
    case 'replan_opening':
      return 'Rebuilding the opening beat';
    case 'alternate_provider':
    case 'alternate_archetype':
      return 'Trying a different approach to a shot';
    default: {
      const count = plan.scenes.length;
      return `Refining ${count} shot${count === 1 ? '' : 's'}`;
    }
  }
}

/**
 * The constraints handed to the Creative Director as facts, not suggestions.
 *
 * Written out rather than left implicit because a model given a film and told
 * to improve a beat will improve the film, and the film was approved.
 */
function contractLines(contract: FilmContract, project: StageContext['project']): string[] {
  return [
    `The film runs ${contract.approvedSeconds.toFixed(2)}s and must still run ${contract.approvedSeconds.toFixed(2)}s.`,
    `It is a ${contract.cut === 'short' ? 'vertical short' : 'landscape film'} and stays one.`,
    `Format: ${project.brief.filmFormat.replace(/_/g, ' ')}.`,
    `Language: ${project.brief.language ?? 'the customer’s own'}.`,
    /*
     * Said out loud, because a director handed a beat to rewrite will write a
     * line for it unless told the film has no voice.
     */
    project.brief.voiceStrategy && project.brief.voiceStrategy !== 'none'
      ? 'The film is narrated. A beat you rewrite carries its own line.'
      : 'The film does not speak. Write no narration: this beat is type, picture and sound.',
    `Shots: ${contract.shots.length}, in the order they are in, unless you replace a beat outright.`,
    contract.requiresPayoff ? 'The film ends on its closing card. That beat stays.' : '',
    'Every other beat is finished work. Do not touch what you were not asked about.',
  ].filter(Boolean);
}

/** Repairs that pay a provider again, so an asset leaving a shot is deliberate. */
const REGENERATES: ReadonlySet<RepairAction> = new Set<RepairAction>([
  'regenerate_shot',
  'alternate_provider',
  'alternate_archetype',
  'recapture_product',
  'swap_asset',
  'recrop',
]);

/**
 * What a second of render time costs us.
 *
 * A deterministic repair pays no provider and is not free — it costs a render
 * worker, and reporting it as $0.0000 is how "one trim costs nothing" became
 * a thing this system believed about itself. A flat rate from the worker's
 * hourly price is enough to make the number honest and to make a loop that
 * re-renders four times visible in the ledger; nobody is billed from it.
 */
const COMPUTE_USD_PER_HOUR = 0.45;

export function computeCostUsd(ms: number): number {
  return Math.round((ms / 3_600_000) * COMPUTE_USD_PER_HOUR * 10000) / 10000;
}

/**
 * Why a film is waiting for a person, in words that say what to change.
 *
 * "The cut came out the wrong length" tells nobody anything. The beat that
 * could not fill its slot, and by how much, is a note a writer can act on.
 */
function replanMessage(
  score: RepairScore | null,
  starvedSceneIds: readonly string[],
  storyboard: Storyboard,
  heldBy: readonly string[] = [],
): string {
  // Only while the diagnosis is current: an accepted pass fixed the beat it
  // was about, and repeating it describes a problem that no longer exists.
  if (starvedSceneIds.length > 0 && score !== null && !score.accepted) {
    const beats = storyboard.scenes
      .map((scene, index) => ({ scene, number: index + 1 }))
      .filter(({ scene }) => starvedSceneIds.includes(scene.id));
    const named = beats.map(({ number }) => `beat ${number}`).join(', ');
    return (
      `${named} ${beats.length === 1 ? 'has' : 'have'} less to say than the time the film gives ` +
      `${beats.length === 1 ? 'it' : 'them'}. Shortening ${beats.length === 1 ? 'it' : 'them'} ` +
      `would take the film under the length you approved, so it needs a change to what the beat ` +
      `says rather than to its timing.`
    );
  }
  if (heldBy.length > 0) {
    const named = [...new Set(heldBy)].map((check) => check.replace(/_/g, ' ')).join(', ');
    const plural = new Set(heldBy).size > 1;
    return (
      `The film is finished. ${named} ${plural ? 'need' : 'needs'} a person: ` +
      'nothing here can be repaired automatically.'
    );
  }
  return (
    (score && !score.accepted ? score.reason : '') ||
    'The film needs a look from a person before it goes out.'
  );
}

/** How much of the tail the fade repair covers. */
/*
 * A second, not a quarter of one.
 *
 * The old value could not satisfy the check it existed for: a linear fade of
 * 250ms is still four fifths up when the final 200ms begins, so the loop
 * applied it, measured no change, and escalated to a person on every film that
 * had music. A second is what an ending sounds like, and it clears the
 * twelve-decibel drop the check now asks for with room to spare.
 */
const TAIL_FADE_REPAIR_SECONDS = 1;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function renderOnce(
  context: StageContext,
  params: {
    render: Render;
    storyboard: Storyboard;
    brand: NonNullable<Awaited<ReturnType<StageContext['store']['brands']['get']>>>;
    aspect: AspectRatio;
    quality: RenderQuality;
    watermarked: boolean;
    workDir: string;
    attempt: number;
    system: ReturnType<typeof getSystem>;
    understanding: ProductUnderstanding | null;
    voice: VoiceTerms;
    /** Whether this cut wears its captions in the picture. */
    burnCaptions: boolean;
    /** Preview or master. A preview may be incomplete; a master may not. */
    mode: RenderMode;
    /** Film-level repairs this pass must carry out. Empty on the first pass. */
    filmRepairs?: readonly RepairAction[];
  },
): Promise<{
  path: string;
  missingAudio: string[];
  soundIssues: QaFinding[];
  captions: FilmCaptions;
  /** Where each line landed in the finished file, for the temporal checks. */
  spoken: SpokenLine[];
  /**
   * Whether this film was supposed to make a sound.
   *
   * A film with no bed, no cues and no voice is meant to be silent, and a
   * silent master is the correct outcome. Everything else that comes back
   * silent has failed, and only this flag tells the two apart.
   */
  hasSound: boolean;
  /** How many library files the score asked for, so "some missing" and "all missing" differ. */
  soundKeys: number;
  /** Shots that rendered as type because their material did not resolve. */
  degradedIssues: QaFinding[];
  /** The manifest this pass was rendered from: what resolved, what did not. */
  readiness: MasterReadiness;
}> {
  const { storyboard, brand, system } = params;

  /*
   * The voice, before the picture.
   *
   * Captions are burned into the frame on the cuts that need them, and a
   * caption cannot be burned into a film that has already been rendered. The
   * narration does not depend on the picture — it is read from the storyboard
   * — so reading it first costs nothing and has one more benefit: a render
   * that was going to fail on the voice now fails before the expensive part
   * rather than after it.
   */
  await context.progress(0.08, 'Reading the narration');
  await context.activity({ step: 'voice', kind: 'step', label: 'reading the narration', status: 'active' });
  const narration = await speakNarration(context, storyboard, params.workDir, params.quality, params.voice);
  const voiceTracks = narration.tracks;
  /*
   * Where the words actually are, as opposed to where the plan put them.
   *
   * A track is placed at its scene's start, but the file begins with however
   * much silence the engine left at the head, so the speech starts later than
   * the track does. The temporal checks compare captions and cuts against
   * this, not against the plan — the plan is what was intended, and the whole
   * point of these checks is to catch the gap between the two.
   */
  const spoken: SpokenLine[] = voiceTracks.map((track) => ({
    sceneId: track.sceneId,
    startsAt: track.atSeconds + track.headSilenceSeconds,
    endsAt: track.atSeconds + track.durationSeconds - track.tailSilenceSeconds,
    text: track.text,
  }));
  await context.activity({
    step: 'voice',
    kind: 'step',
    label:
      voiceTracks.length > 0
        ? `${voiceTracks.length} passage${voiceTracks.length === 1 ? '' : 's'} read`
        : storyboard.voiceStrategy === 'none'
          ? 'no voice-over on this film'
          : 'nothing to read',
    status: voiceTracks.length > 0 || storyboard.voiceStrategy === 'none' ? 'done' : 'skipped',
  });

  const built = await captionFilm(context, {
    tracks: voiceTracks,
    language: storyboard.language ?? context.project.brief.language ?? null,
    filmSeconds: storyboardDuration(storyboard),
    boundaries: storyboard.scenes.map((scene) => scene.startTime).filter((at) => at > 0),
  });
  /*
   * The repair the timing checks ask for, carried out.
   *
   * Only when the loop asked: cues estimated from a script are usually right,
   * and snapping every film's captions onto the measured speech would throw
   * away good timing along with bad.
   */
  const captions: FilmCaptions = params.filmRepairs?.includes('retime_captions')
    ? { ...built, cues: retimeCaptionsToSpeech({ cues: built.cues, spoken, fps: DEFAULT_FPS }) }
    : built;
  if (captions.cues.length > 0) {
    await context.activity({
      step: 'voice',
      kind: 'step',
      label: `${captions.cues.length} caption${captions.cues.length === 1 ? '' : 's'}`,
      detail:
        captions.alignedPassages === captions.passages
          ? 'timed from the recording'
          : `${captions.alignedPassages} of ${captions.passages} timed from the recording`,
      status: 'done',
    });
  }

  /*
   * The same words on every pass.
   *
   * "Directing the refined shots again" told the customer there had been a
   * first attempt they were not shown and that it had not been good enough.
   * They did not ask, they cannot act on it, and the honest summary of what
   * is happening is that the master is being composed.
   */
  await context.progress(0.15, 'Composing the master');
  await context.activity({
    step: 'motion',
    kind: 'step',
    // Operator-facing: the pass number belongs here and nowhere the customer looks.
    label:
      params.attempt === 0
        ? `rendering ${storyboard.scenes.length} scenes`
        : `rendering ${storyboard.scenes.length} scenes · pass ${params.attempt + 1}`,
    status: 'active',
  });

  const referenced = storyboard.scenes.flatMap((scene) => scene.assetRefs);
  const { urls: assetUrls, missing: missingAssets } = await resolveAssetUrls(context, referenced);
  /*
   * Which of them play. A generated shot and a 3D render are clips; everything
   * else the film draws is a still, and handing one to the other is how a
   * commissioned shot ends up as an empty frame.
   */
  const footageAssetIds = await footageAmong(context, referenced);

  /*
   * Master readiness, before a frame is rendered.
   *
   * The composition degrades rather than fails: a shot whose capture is gone
   * draws the scene's line of copy on the canvas instead. For a preview that
   * is exactly right — a preview is allowed to be incomplete. For a master it
   * is how thirty seconds of title cards on black went out as a finished film,
   * because nothing between the plan and the encoder ever compared what the
   * director asked for against what the renderer was actually handed.
   *
   * Measured here because this is the one place that holds both.
   */
  const readiness = visualReadiness({
    storyboard,
    mode: params.mode,
    resolved: new Set(Object.keys(assetUrls)),
    missing: missingAssets,
  });
  await context.activity({
    step: 'motion',
    kind: 'note',
    label: `material ${readiness.coverage.shotsWithMaterial}/${readiness.coverage.shotsRequiringMaterial}`,
    detail: summariseCoverage(readiness.coverage),
    status: readiness.ready ? 'done' : 'failed',
  });
  const degradedIssues: QaFinding[] = readiness.blockers.map((blocker) => {
    const scene = storyboard.scenes.find((candidate) => candidate.id === blocker.sceneId);
    return {
      id: newId('evt'),
      sceneId: blocker.sceneId,
      timecodeStart: scene?.startTime ?? null,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      check: 'composition',
      severity: 'hard_fail',
      message: blocker.message,
      confidence: 1,
      /*
       * A generated shot that was never produced can be asked for again. A
       * capture whose bytes are not in the storage this worker can reach
       * cannot be — no amount of re-rendering puts them there — so it goes to
       * a person rather than around the loop a second time.
       */
      repair:
        blocker.code !== 'asset_missing'
          ? 'manual_review'
          : scene && scene.generativeNeeds.length > 0
            ? 'regenerate_shot'
            : 'manual_review',
    } satisfies QaFinding;
  });

  const silentPath = path.join(params.workDir, `film-${params.attempt}.mp4`);
  await renderFilm({
    props: {
      storyboard,
      brand,
      assetUrls,
      typeScale: {
        displayRatio: system.typeScale.display.displayRatio,
        bodyRatio: system.typeScale.display.bodyRatio,
        tracking: system.typeScale.display.tracking,
        lineHeight: system.typeScale.display.lineHeight,
      },
      theme: system.palette.canvas === 'light' ? 'light' : system.palette.canvas === 'dark' ? 'dark' : 'auto',
      /*
       * The mark a plan pays to remove, and what it says.
       *
       * It used to say "PREVIEW", burned into the bottom right of a file the
       * customer downloads as their master. That is not what the file is: the
       * render is a real master of a real film, and the watermark is there
       * because the plan does not carry `render.clean`. A customer who opened
       * their film and read PREVIEW on every frame reasonably concluded that
       * the system had handed them the wrong artifact.
       *
       * So it carries the studio's name instead, which is true of the file
       * whatever the plan is, and the interface says the rest: this delivery
       * is labelled a workprint until the mark comes off.
       */
      watermarkLabel: params.watermarked ? 'Act One' : null,
      /*
       * The end card is the company's own address and the company's own line
       * about itself. It used to say "Start free" on every film ever rendered —
       * a promise about a product nobody had checked has a free tier, made on
       * the customer's behalf, on their launch day. By our own editorial rule
       * that is a claim, and we had no evidence for it.
       */
      cta: displayHost(context.project.websiteUrl),
      /*
       * One clause, not the whole one-liner: the lockup holds a single line,
       * and handing it a paragraph is how a film ends mid-phrase. In the
       * brand's own language, because where the clause is cut depends on which
       * words can end a line — a French film ended on "les conducteurs à"
       * because this call did not say what language it was cutting.
       */
      tagline: params.understanding
        ? firstClause(params.understanding.oneLiner, 72, brand.communication.language)
        : '',
      /*
       * Burned in only where the format asks for it.
       *
       * A vertical cut is watched with the sound off in a feed, so a caption
       * that can be turned off is a caption nobody sees. A hero film is
       * watched on a page with a player around it, where a track the viewer
       * controls is better than type nailed to the frame. Both get the track.
       */
      ...(params.burnCaptions && captions.cues.length > 0 ? { captions: captions.cues } : {}),
      ...(footageAssetIds.length > 0 ? { footageAssetIds } : {}),
    },
    aspect: params.aspect,
    quality: params.quality,
    outputPath: silentPath,
    signal: context.signal,
    onProgress: ({ progress }) => void context.progress(0.15 + progress * 0.45, 'Rendering'),
  });

  await context.activity({
    step: 'motion',
    kind: 'step',
    label: `${storyboard.scenes.length} scenes rendered`,
    detail: `${params.aspect} · ${params.quality}`,
    status: 'done',
  });
  await context.progress(0.62, 'Designing the sound');

  const directed = directSound({
    storyboard,
    behaviour: system.sound,
    channel: params.aspect === '9:16' ? 'social' : 'web',
    hasVoiceOver: storyboard.scenes.some((scene) => scene.voiceOver),
  });

  /*
   * A film that ends rather than stops.
   *
   * The repair for `abrupt_music_end`, and it belongs to the bed rather than
   * to a scene: the tail is a property of the track. A quarter second is long
   * enough to read as an ending and short enough that nothing is lost.
   *
   * A film with no music cannot be repaired this way, and nothing here
   * pretends otherwise — the finding comes back on the next pass, the loop
   * escalates it, and a person is asked.
   */
  const design =
    params.filmRepairs?.includes('refade_audio') && directed.music
      ? {
          ...directed,
          music: {
            ...directed.music,
            fadeOutSeconds: Math.max(directed.music.fadeOutSeconds ?? 0, TAIL_FADE_REPAIR_SECONDS),
          },
        }
      : directed;

  // A film with no whoosh is still a film, so a missing asset never fails the
  // render — but it is reported, and the caller turns it into a QA finding.
  const { resolved: resolvedPaths, missing: missingAudio } = await resolveLibraryPaths(context, design);

  /*
   * A score written for this film, and sounds built for these shots.
   *
   * Substituted into the same resolution table the library fills, so the mix,
   * the ducking, the metering and the master are the code that was already
   * measured rather than a second path that has to be trusted. With no
   * composer configured this changes nothing at all.
   */
  const scored = await scoreFilm(context, {
    storyboard,
    design,
    brand,
    understanding: params.understanding,
    creativeSystem: system.id,
    workDir: params.workDir,
    aspect: params.aspect,
    hasVoiceOver: storyboard.scenes.some((scene) => scene.voiceOver),
  });
  if (scored.musicPath && design.music) {
    const key = `composed:${params.attempt}`;
    resolvedPaths[key] = scored.musicPath;
    design.music.storageKey = key;
    /*
     * A composed score starts where the film starts and resolves on the mark.
     * The entry point and the fade exist for a library track, which has to be
     * cut into; this one was written to the picture, and fading its ending
     * would undo the resolution it was written to land.
     */
    design.music.startOffsetSeconds = 0;
    design.music.enterAtSeconds = 0;
    design.music.fadeInSeconds = 0;
    design.music.fadeOutSeconds = 0.15;
  }
  for (const cue of design.cues) {
    const built = scored.effectPaths[cue.id];
    if (!built) continue;
    const key = `built:${cue.id}`;
    resolvedPaths[key] = built;
    cue.storageKey = key;
  }
  /*
   * What is still missing, after the substitutions.
   *
   * Recomputed from what the design now points at rather than filtered from
   * the first pass: a cue whose library sample was missing and whose sound was
   * then built is not missing anything, and reporting it would send an
   * operator to provision a file nobody is going to play.
   */
  const stillMissing = [
    ...new Set(
      [design.music?.storageKey, ...design.cues.map((cue) => cue.storageKey)]
        .filter((key): key is string => typeof key === 'string')
        .filter((key) => resolvedPaths[key] === undefined),
    ),
  ].sort();
  await context.activity({ step: 'composition', kind: 'step', label: 'designing the sound', status: 'active' });

  /*
   * The voice has to lead the bed by the standard's four LU, measured, not
   * assumed. The sidechain ducks the music under narration by a fixed ratio,
   * which is the right tool and still a guess about how much: a loud bed
   * ducks to not enough. So the bed and the voice are metered separately
   * inside the voice windows, and if the lead is short the bed is taken down
   * by the difference and mixed again — one correction, then a finding.
   */
  let plan = buildMix({
    design,
    resolvedPaths,
    durationSeconds: storyboardDuration(storyboard),
    ...(voiceTracks.length > 0 ? { voiceTracks } : {}),
  });
  const soundIssues: QaFinding[] = [...narration.issues, ...captions.issues];
  /*
   * What the film was scored to carry, before anything was resolved or mixed.
   * Read off the design rather than off the mix, because the whole question
   * downstream is whether a film that asked for sound came back without it.
   */
  const hasSound = Boolean(design.music) || design.cues.length > 0 || voiceTracks.length > 0;
  const soundKeys = new Set(
    [design.music?.storageKey, ...design.cues.map((cue) => cue.storageKey)].filter(
      (key): key is string => typeof key === 'string',
    ),
  ).size;
  if (voiceTracks.length > 0 && design.music) {
    let lead = await measureDialogueLead(plan, voiceTracks, { ...(context.signal ? { signal: context.signal } : {}) });
    const reduction = lead ? bedReductionDb(lead) : 0;
    if (lead && reduction > 0) {
      plan = buildMix({
        design: { ...design, music: { ...design.music, baseGainDb: design.music.baseGainDb - reduction } },
        resolvedPaths,
        durationSeconds: storyboardDuration(storyboard),
        voiceTracks,
      });
      lead = await measureDialogueLead(plan, voiceTracks, { ...(context.signal ? { signal: context.signal } : {}) });
    }
    if (lead && lead.leadLu < DIALOGUE_LEAD_MIN) {
      soundIssues.push({
        id: newId('evt'),
        sceneId: null,
        timecodeStart: voiceTracks[0]?.atSeconds ?? null,
        detectedBy: 'deterministic',
        evidenceAssetId: null,
        check: 'audio_balance',
        severity: 'soft_fail',
        message:
          `The voice sits ${lead.leadLu.toFixed(1)} LU above the music while speaking; ` +
          `${DIALOGUE_LEAD_MIN} is the floor (${cite(AUDIO_STANDARDS.dialogueLead)}). ` +
          'The bed was taken down once already and the words still do not carry.',
        confidence: 0.9,
        repair: 'manual_review',
      });
    }
  }

  const premasterPath = path.join(params.workDir, `premix-${params.attempt}.wav`);
  const mixed = await runFfmpeg(mixArgs(plan, premasterPath), {
    signal: context.signal,
    timeoutMs: 300_000,
  });

  if (!mixed.ok) {
    // A broken filter graph must not cost the whole render; ship the picture.
    console.error('[render] mix failed, shipping silent film:', mixed.stderr.slice(-400));
    return { path: silentPath, missingAudio: stillMissing, soundIssues, captions, spoken, hasSound, soundKeys, degradedIssues, readiness };
  }

  await context.progress(0.72, 'Mixing');
  await context.activity({ step: 'composition', kind: 'step', label: 'mixing and mastering', status: 'active' });

  /*
   * The master, in two passes, by the same code that masters the sound library.
   *
   * The mix used to normalise itself in one pass inside its own filter graph,
   * which lands a decibel or two from the target — most of the tolerance
   * EBU R 128 allows for a whole programme, spent before the film is even
   * muxed. A measured pass costs seconds against a render that costs minutes.
   */
  const audioPath = path.join(params.workDir, `mix-${params.attempt}.wav`);
  try {
    await masterLoudness({
      source: premasterPath,
      target: audioPath,
      lufs: design.targetLufs,
      // Still lossless: the mux does the one AAC encode this file ever gets.
      outputArgs: ['-c:a', 'pcm_s24le'],
      ...(context.signal ? { signal: context.signal } : {}),
      timeoutMs: 300_000,
    });
  } catch (error) {
    // The premaster is a finished mix at the wrong level, which is a far better
    // film than no sound at all.
    console.error('[render] mastering failed, shipping the premaster:', (error as Error).message);
    await rm(audioPath, { force: true });
    return { ...(await mux(context, silentPath, premasterPath, params, stillMissing)), soundIssues, captions, spoken, hasSound, soundKeys, degradedIssues, readiness };
  }

  return { ...(await mux(context, silentPath, audioPath, params, stillMissing)), soundIssues, captions, spoken, hasSound, soundKeys, degradedIssues, readiness };
}

/**
 * Runs the photosensitivity check over the finished film.
 *
 * The only check here that is about harm rather than quality, so it runs on
 * every render including the ones that skip vision QA: an animatic nobody pays
 * for can still hurt somebody watching it.
 *
 * Analysed at 160px wide, because whole-frame average luminance is what the
 * threshold is defined against and a downscale computes the same average
 * roughly a hundred times faster. The per-frame data goes to a file rather than
 * through stderr: a minute of film is tens of thousands of lines, and the
 * process buffer is deliberately bounded.
 */
async function checkFlashRate(
  context: StageContext,
  masterPath: string,
  workDir: string,
): Promise<QaFinding[]> {
  const metadataPath = path.join(workDir, `luma-${newId('evt')}.txt`);

  try {
    const probe = await runFfmpeg(['-i', masterPath, '-frames:v', '1', '-f', 'null', '-'], {
      signal: context.signal,
      timeoutMs: 60_000,
    });

    const analysed = await runFfmpeg(
      [
        '-i', masterPath,
        '-vf', `scale=160:-2,signalstats,metadata=print:file=${metadataPath}`,
        '-an',
        '-f', 'null',
        '-',
      ],
      { signal: context.signal, timeoutMs: 180_000 },
    );
    if (!analysed.ok) {
      // Never silently pass: a check for harm that fails open is worse than no
      // check, because everyone downstream believes it ran.
      console.error('[render] flash analysis failed:', analysed.stderr.slice(-300));
      return [
        {
          id: newId('evt'),
          sceneId: null,
          timecodeStart: null,
          detectedBy: 'deterministic',
          evidenceAssetId: null,
          check: 'flicker',
          severity: 'soft_fail',
          message:
            'The photosensitivity check could not run on this film, so it has not been ' +
            'cleared for flashing content.',
          confidence: 1,
          repair: 'manual_review',
        },
      ];
    }

    const raw = await readFile(metadataPath, 'utf8').catch(() => '');
    const fullRange = isFullRange(probe.stderr);
    const stats = parseFrameStats(raw);
    const luminance = stats.yavg.map((value) => relativeLuminance(value, fullRange));
    // One pass, three rules: the general flash threshold, its red companion,
    // and the studio range every frame has to stay inside.
    return [
      ...flashIssues(luminance, DEFAULT_FPS),
      ...redFlashIssues(stats.vavg.map((value) => redness(value, fullRange)), DEFAULT_FPS),
      ...rangeIssues(stats, fullRange, DEFAULT_FPS),
    ];
  } finally {
    await rm(metadataPath, { force: true }).catch(() => undefined);
  }
}

/**
 * The 60/30/10 rule, on the frames that are the film's own composition.
 *
 * Up to three typographic scenes, longest first, each read at its settled
 * moment. Product scenes are skipped: their colours are the customer's.
 */
async function checkColourDistribution(
  context: StageContext,
  params: { storyboard: Storyboard; brand: BrandSystem; aspect: AspectRatio; masterPath: string; workDir: string },
): Promise<QaFinding[]> {
  const tokens = resolveTokens(params.brand, { aspect: params.aspect });
  const candidates = params.storyboard.scenes
    .filter((scene) => ['kinetic_typography', 'statistic', 'quote'].includes(scene.visualType))
    .filter((scene) => scene.onScreenText.some((line) => line.trim().length > 0))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3);

  const issues: QaFinding[] = [];
  for (const scene of candidates) {
    const framePath = path.join(params.workDir, `palette-${scene.id}.jpg`);
    const extracted = await runFfmpeg(
      posterArgs(params.masterPath, scene.startTime + scene.duration * 0.6, framePath),
      { signal: context.signal, timeoutMs: 60_000 },
    );
    if (!extracted.ok) continue;
    try {
      issues.push(...distributionIssues(await colourShares(framePath, tokens), scene));
    } catch (error) {
      // A frame that will not decode is the container check's problem, not this one's.
      console.error('[render] palette measurement failed:', (error as Error).message);
    } finally {
      await rm(framePath, { force: true }).catch(() => undefined);
    }
  }
  return issues;
}

/** Puts the picture and the mix together, falling back to the silent cut. */
async function mux(
  context: StageContext,
  silentPath: string,
  audioPath: string,
  params: { workDir: string; attempt: number },
  missingAudio: string[],
): Promise<{ path: string; missingAudio: string[] }> {
  const masterPath = path.join(params.workDir, `master-${params.attempt}.mp4`);
  const muxed = await runFfmpeg(muxArgs(silentPath, audioPath, masterPath), {
    signal: context.signal,
    timeoutMs: 300_000,
  });

  return { path: muxed.ok ? masterPath : silentPath, missingAudio };
}

/**
 * The temporal pass.
 *
 * One measurement of the master, then the arithmetic. Everything here is a
 * defect that the plan cannot contain and only the render can produce, which
 * is why it runs on the file rather than on the storyboard.
 *
 * A measurement that fails reports nothing rather than failing the film: the
 * checks exist to catch defects, not to become one.
 */
async function checkTiming(
  context: StageContext,
  params: {
    storyboard: Storyboard;
    masterPath: string;
    workDir: string;
    captions: FilmCaptions;
    spoken: readonly SpokenLine[];
    cut: FilmCut;
    fps: number;
    durationSeconds: number;
    /** Whether the film was scored at all. A silent film meant to be silent is not a defect. */
    hasSound: boolean;
  },
): Promise<QaFinding[]> {
  const issues: QaFinding[] = [
    ...captionSyncIssues({ cues: params.captions.cues, spoken: params.spoken, fps: params.fps }),
    ...speechDriftIssues({ spoken: params.spoken, scenes: params.storyboard.scenes }),
  ];

  try {
    const measured = await measureFilm(params.masterPath, {
      ...(context.signal ? { signal: context.signal } : {}),
      workDir: params.workDir,
    });
    issues.push(
      ...heldFrameIssues({
        freezes: measured.freezes,
        scenes: params.storyboard.scenes,
        cut: params.cut,
        fps: params.fps,
      }),
      ...deadAirIssues({
        silences: measured.silences,
        durationSeconds: params.durationSeconds,
        cut: params.cut,
        scenes: params.storyboard.scenes,
      }),
      ...levelJumpIssues(measured.windows),
      ...abruptEndIssue({
        tailPeakDb: measured.tailPeakDb,
        peakDb: measured.peakDb,
        durationSeconds: params.durationSeconds,
      }),
      /*
       * The question none of the above can ask. Dead air is measured between
       * the head and the tail, and a film that is silent end to end has no
       * middle — its one silence is exempt at both ends by construction.
       */
      ...silentMasterIssue({
        peakDb: measured.peakDb,
        scored: params.hasSound,
        durationSeconds: params.durationSeconds,
      }),
    );
  } catch (error) {
    console.error('[render] timing measurement failed:', (error as Error).message);
  }

  return issues;
}

async function inspect(
  context: StageContext,
  params: {
    storyboard: Storyboard;
    brand: NonNullable<Awaited<ReturnType<StageContext['store']['brands']['get']>>>;
    aspect: AspectRatio;
    masterPath: string;
    workDir: string;
    skipVision: boolean;
    understanding: ProductUnderstanding | null;
    /** Which pass this is. The director only sends a shot back on the first. */
    attempt: number;
    /** The captions as they will ship, for the checks that read a clock. */
    captions: FilmCaptions;
    /** Where each line was actually spoken, head silence already removed. */
    spoken: readonly SpokenLine[];
    cut: FilmCut;
    fps: number;
    durationSeconds: number;
    /** Whether the film was scored at all, for the check that it can be heard. */
    hasSound: boolean;
  },
): Promise<{ issues: QaFinding[]; layers: QaLayer[]; watched: DirectorsVerdict | null }> {
  const { registry, project, organizationId } = context;
  await context.progress(0.78, 'Checking the film');
  await context.activity({ step: 'composition', kind: 'step', label: 'checking the film frame by frame', status: 'active' });

  const { understanding } = params;

  const issues: QaFinding[] = [
    ...(await checkFlashRate(context, params.masterPath, params.workDir)),
    ...(await checkColourDistribution(context, {
      storyboard: params.storyboard,
      brand: params.brand,
      aspect: params.aspect,
      masterPath: params.masterPath,
      workDir: params.workDir,
    })),
    ...runDeterministicChecks({
      storyboard: params.storyboard,
      brand: params.brand,
      aspect: params.aspect,
      cut: params.cut,
      format: project.brief.filmFormat,
      cta: displayHost(project.websiteUrl),
      ...(understanding
        ? { knownEvidenceIds: new Set(understanding.evidence.map((evidence) => evidence.id)) }
        : {}),
    }),
  ];

  if (understanding) {
    issues.push(
      ...factCheck({
        storyboard: params.storyboard,
        understanding,
        excludedClaims: project.brief.excludedClaims,
      }),
    );
  }

  /*
   * The clock, on the file itself.
   *
   * Everything above decides from the plan or from one frame. These are
   * measured out of the finished master — frozen frames, holes in the track,
   * loudness moving between windows, a tail that stops rather than ends —
   * because they are exactly the defects that are correct in the plan and
   * wrong in the render.
   */
  issues.push(...(await checkTiming(context, params)));

  /*
   * Which passes actually ran, recorded rather than inferred.
   *
   * A layer that found nothing and a layer that never ran produce the same
   * empty list of findings, and they mean opposite things: one is a clean
   * film, the other is a film nobody looked at. The report has carried a
   * `layers` field since the first version of this and nothing ever filled
   * it, so every report claimed none of them had run.
   */
  const layers: QaLayer[] = ['spec', 'structural', 'visual', 'audio', 'cross_modal'];

  if (params.skipVision) return { issues, layers, watched: null };

  // Vision QA reads actual frames, extracted from the finished film so it sees
  // exactly what the customer will.
  const frames = selectFramesToInspect(params.storyboard.scenes, { maxFrames: 6 });
  for (const frame of frames) {
    const framePath = path.join(params.workDir, `qa-${frame.scene.id}.jpg`);
    const extracted = await runFfmpeg(posterArgs(params.masterPath, frame.timecodeStart, framePath), {
      signal: context.signal,
      timeoutMs: 60_000,
    });
    if (!extracted.ok) continue;

    try {
      const bytes = await readFile(framePath);
      const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      issues.push(
        ...(await inspectFrame(
          registry.llm(),
          { frameUrl: dataUrl, scene: frame.scene, timecodeStart: frame.timecodeStart },
          { organizationId, projectId: project.id, sceneId: frame.scene.id, signal: context.signal },
        )),
      );
    } catch (error) {
      // A failed inspection is not a failed film.
      console.error('[render] frame inspection failed:', (error as Error).message);
    }
  }

  // Vision ran, which is a stronger visual pass than the deterministic one.
  const verdict = await askTheDirector(context, params);
  if (verdict) {
    issues.push(...verdictIssues(verdict));

    /*
     * One shot back, on the first pass only.
     *
     * A director who does not change anything is a critic, and the whole
     * complaint about a generated film is that nothing sends it back. So the
     * weakest shot becomes an ordinary repairable finding and goes through the
     * machinery that already re-directs shots and re-renders — no second loop,
     * no second set of bounds.
     *
     * First pass only, and one shot, because taste is not convergent: a
     * reviewer asked again about a film it has already sent back will find
     * something else to send back, for ever, on the customer's money.
     */
    const back = params.attempt === 0 ? redirectFor(verdict, params.storyboard.scenes) : null;
    if (back) {
      issues.push({
        id: newId('evt'),
        check: 'direction',
        // Major rather than blocker: it earns a second attempt at one shot,
        // and it can never be the reason a finished film is withheld.
        severity: 'soft_fail',
        sceneId: back.sceneId,
        timecodeStart: null,
        message: `The weakest shot in the cut: ${back.reason}`,
        evidenceAssetId: null,
        confidence: 0.7,
        repair: 'regenerate_shot',
        detectedBy: 'vision',
      });
    }
  }

  return { issues, layers, watched: verdict };
}

/**
 * The cut, watched as a cut.
 *
 * Every check above this line asks whether something is wrong, and by the time
 * they have all passed the film may still be one nobody remembers — which is
 * the normal outcome of generating one and the only failure none of them can
 * see. The director is shown the whole film at once, as a contact sheet, with
 * the shot list and the script, and grades it on a scale where "nothing wrong
 * with it" is a failing grade.
 *
 * It never blocks. A film the customer paid for is not withheld over taste,
 * and a model's opinion is not a reason to stop a delivery. What it earns is
 * one shot sent back where a shot can be sent back, and otherwise a note that
 * says plainly what it thought — which is worth more to the person deciding
 * whether to ship than a silent pass.
 */
async function askTheDirector(
  context: StageContext,
  params: {
    storyboard: Storyboard;
    masterPath: string;
    workDir: string;
    understanding: ProductUnderstanding | null;
    brand: NonNullable<Awaited<ReturnType<StageContext['store']['brands']['get']>>>;
  },
): Promise<DirectorsVerdict | null> {
  const scenes = params.storyboard.scenes;
  if (scenes.length === 0) return null;

  await context.progress(0.9, 'Watching it back');
  await context.activity({ step: 'composition', kind: 'step', label: 'watching the cut back', status: 'active' });

  const frames: { sceneId: string; timecodeStart: number; data: Uint8Array }[] = [];
  for (const scene of scenes) {
    // Six tenths in: the motion has settled and the shot is not yet leaving.
    const timecodeStart = scene.startTime + scene.duration * 0.6;
    const framePath = path.join(params.workDir, `cut-${scene.id}.jpg`);
    const extracted = await runFfmpeg(posterArgs(params.masterPath, timecodeStart, framePath), {
      signal: context.signal,
      timeoutMs: 60_000,
    });
    if (!extracted.ok) continue;
    frames.push({ sceneId: scene.id, timecodeStart, data: new Uint8Array(await readFile(framePath)) });
  }
  if (frames.length === 0) return null;

  try {
    const sheet = await buildContactSheet(frames);
    const verdict = await reviewCut(
      context.registry.llm(),
      {
        storyboard: params.storyboard,
        contactSheet: {
          url: `data:image/png;base64,${Buffer.from(sheet.png).toString('base64')}`,
          shots: sheet.shots,
        },
        brief: params.understanding
          ? `${params.understanding.name}: ${params.understanding.oneLiner}`
          : context.project.name,
        tone: params.brand.tone,
        format: context.project.brief.filmFormat,
        cut: context.project.brief.filmCut,
      },
      { organizationId: context.organizationId, projectId: context.project.id, signal: context.signal },
    );

    /*
     * The whole verdict on the job's own timeline, which the console already
     * renders. An operator asking why a shot was sent back, or why a film that
     * passed every check still reads flat, gets the reasoning where they are
     * already looking rather than in a report nothing displays.
     */
    await context.activity({
      step: 'composition',
      kind: 'note',
      label: `the director says: ${verdict.grade}`,
      detail: verdict.summary,
      status: 'done',
    });
    for (const note of weakestDimensions(verdict)) {
      await context.activity({
        step: 'composition',
        kind: 'note',
        label: `${note.dimension}: ${note.grade}`,
        detail: note.atSeconds === null ? note.note : `${note.atSeconds.toFixed(1)}s — ${note.note}`,
        status: 'done',
      });
    }
    await context.activity({
      step: 'composition',
      kind: 'note',
      label: 'one change would lift it',
      detail: verdict.oneChange,
      status: 'done',
    });
    return verdict;
  } catch (error) {
    // An opinion nobody could obtain is not a reason to fail a finished film.
    console.error('[render] the director could not watch it:', (error as Error).message.slice(0, 200));
    return null;
  }
}

/**
 * Speaks the narration the storyboard was approved with.
 *
 * The storyboard panel shows narration in quotes and the customer approves it,
 * so a film that never says any of it is a film that does not match what they
 * signed off. Read per scene rather than as one long take, because each line
 * has to land inside its own scene — a single file drifts against the cut the
 * moment any scene's duration changes — and read as one performance all the
 * same, each line told the lines around it.
 *
 * The narration engine does the work: the spoken adaptation, the fit to the
 * scene (rewritten shorter before it is ever hurried), the takes, the listen
 * back, the regeneration and the levelling. Previews and plans without the
 * premium voice read on the preview tier; everything else is the studio voice.
 *
 * A stock persona, never a cloned voice: cloning needs a recorded consent grant
 * naming the person, and nothing here has one. The provider refuses without it
 * and this does not ask.
 *
 * Failure is survivable in exactly the way a missing sound effect is. A film
 * that lost its voice-over is still a film, and losing the picture because a
 * speech API was down would be the worse trade.
 */
async function speakNarration(
  context: StageContext,
  storyboard: Storyboard,
  workDir: string,
  quality: RenderQuality,
  voice: VoiceTerms,
): Promise<{
  tracks: {
    path: string;
    /** The scene this line belongs to, so its timing can be judged against it. */
    sceneId: string | null;
    atSeconds: number;
    durationSeconds: number;
    headSilenceSeconds: number;
    tailSilenceSeconds: number;
    text: string;
  }[];
  issues: QaFinding[];
}> {
  const spoken = storyboard.scenes.filter(
    (scene) => scene.voiceOver && scene.narration.trim().length > 0,
  );
  if (storyboard.voiceStrategy === 'none' || spoken.length === 0) return { tracks: [], issues: [] };

  // A preview is for timing; the studio voice is for the film, on plans that carry it.
  const tier: SpeechQuality = quality === 'preview' || !voice.premium ? 'preview' : 'final';
  const brief = context.project.brief;
  const language = storyboard.language ?? brief.language ?? null;
  // The direction: the kind of film, the language it was written in, and the
  // customer's word on who reads it and how. The same object whichever engine reads.
  const direction = directVoice({
    context: 'launch_film',
    language,
    accent: brief.voiceAccent ?? null,
    gender: brief.voiceGender ?? null,
    style: brief.voiceStyle ?? null,
    pace: brief.voicePace ?? null,
    tone: brief.tone ?? null,
  });

  try {
    const result = await narrate(context, {
      passages: spoken.map((scene) => ({
        id: `scene-${scene.index}`,
        text: scene.narration.trim(),
        sceneId: scene.id,
        roomSeconds: scene.duration,
        atSeconds: scene.startTime,
      })),
      direction,
      quality: tier,
      context: 'launch_film',
      workDir,
      takes: tier === 'final' ? voice.takes : 1,
      regenerations: voice.regenerations,
      // Previews are not listened back to: the ear costs as much as the voice there.
      listenBack: tier === 'final',
      keepTakes: tier === 'final' && voice.takes > 1,
      persona: PERSONA_FOR_STRATEGY[storyboard.voiceStrategy] ?? 'narrator_neutral',
      label: 'render',
    });
    if (result.usage.calls > 0) {
      console.log(
        `[render] narration: ${result.tracks.length}/${spoken.length} scenes read by ${result.usage.provider ?? 'nobody'}` +
          ` (${result.usage.model ?? '-'}), ${result.usage.characters} characters, $${result.usage.costUsd.toFixed(3)}`,
      );
    }
    return {
      tracks: result.tracks.map((track) => ({
        path: track.path,
        sceneId: track.sceneId ?? null,
        atSeconds: track.atSeconds,
        durationSeconds: track.durationSeconds,
        // Carried for the captions: where the words start inside the file, and
        // what was actually read, which is not always what the scene says
        // after a line was shortened to fit its room.
        headSilenceSeconds: track.headSilenceSeconds,
        tailSilenceSeconds: track.tailSilenceSeconds,
        text: track.text,
      })),
      issues: result.issues,
    };
  } catch (error) {
    console.error('[render] narration failed:', (error as Error).message.slice(0, 200));
    return { tracks: [], issues: [] };
  }
}

/** What the plan says about the voice. Resolved once per render, from the live subscription. */
type VoiceTerms = { premium: boolean; takes: number; regenerations: number };

/** Each voice strategy has a register; none of them is a cloned person. */
const PERSONA_FOR_STRATEGY: Record<string, 'narrator_neutral' | 'narrator_warm' | 'narrator_low'> = {
  founder: 'narrator_warm',
  narrator: 'narrator_neutral',
  documentary: 'narrator_low',
};

/**
 * Resolves the library assets this sound design asks for.
 *
 * Anything missing is reported rather than only skipped. A mix that quietly
 * drops every track it cannot find still produces a perfectly valid, entirely
 * silent film — which is how an unprovisioned library goes unnoticed until
 * somebody plays a master and wonders why a launch film has no sound.
 */
async function resolveLibraryPaths(
  context: StageContext,
  design: ReturnType<typeof directSound>,
): Promise<{ resolved: Record<string, string>; missing: string[] }> {
  const keys = [
    ...(design.music ? [design.music.storageKey] : []),
    ...design.cues.map((cue) => cue.storageKey).filter((key): key is string => key !== null),
  ];

  const storage = context.registry.storage();
  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      if (await storage.exists(key)) {
        resolved[key] = await storage.signedUrl(key, 3600);
      } else {
        missing.push(key);
      }
    }),
  );

  return { resolved, missing: missing.sort() };
}

export { DEFAULT_LIBRARY };
