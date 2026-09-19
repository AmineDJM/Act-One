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
} from '@act-one/qa';
import { footageAmong, resolveAssetUrls, storeAsset, type StageContext } from '../context.ts';
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
): Promise<{ renderId: string; assetId: string; qaPassed: boolean; issues: QaFinding[] }> {
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
    // Films are numbered; cuts and animatics ride the version of the film they
    // come from, so "version 3" always means the customer's third film.
    version: (await store.renders.countForProject(organizationId, project.id)) + (kind === 'film' ? 1 : 0),
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
    let releaseState: ReleaseState = 'generating';
    let costBeforePass = await store.costs.totalForProject(organizationId, project.id);
    let passStartedAt = Date.now();

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
      });
      masterPath = rendered.path;
      captions = rendered.captions;

      issues = await inspect(context, {
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
      });

      /*
       * A film that was scored and came out silent. Reported rather than
       * repaired, because no change to the storyboard fixes it: the library is
       * not provisioned, and that is an operator's job. A major rather than a
       * blocker, because the picture is finished and withholding it helps
       * nobody — but it never ships unremarked.
       */
      issues = [...issues, ...rendered.soundIssues];
      if (rendered.missingAudio.length > 0) {
        issues = [
          ...issues,
          {
            id: newId('evt'),
            sceneId: null,
            timecodeStart: null,
            detectedBy: 'deterministic',
            evidenceAssetId: null,
            check: 'missing_audio',
            severity: 'soft_fail',
            message:
              `The sound library is missing ${rendered.missingAudio.length} file(s), so this film ` +
              `is silent where it was scored. Run \`npm run sound-library\`. ` +
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
      const findings = normalizeFindings(issues);
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
          layers: [],
          // What was being made, so the console can break failures down by it
          // without joining back to a project that may have changed since.
          cut,
          format: project.brief.filmFormat,
          renderKind: kind,
          durationSeconds: storyboardDuration(current),
          shots: current.scenes.map((scene) => ({ sceneId: scene.id, archetype: scene.visualType })),
          framesInspected: findings.length,
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
        const settled = settleRepairs({
          attempted,
          before: previousFindings,
          after: findings,
          costUsd: Math.max(0, (await store.costs.totalForProject(organizationId, project.id)) - costBeforePass),
          latencyMs: Date.now() - passStartedAt,
        });
        repairs.push(...settled);
        extraCostUsd += settled.reduce((sum, record) => sum + record.costUsd, 0);
        extraLatencyMs += Date.now() - passStartedAt;
        attempted = [];
      }
      previousFindings = findings;

      const plan = planRepairs({ report, attempt, maxAttempts, history: repairs, deliverable: kind !== 'animatic' });

      if (plan.shippable || plan.deadEnd) {
        releaseState = plan.state;
        await store.qaReports.update?.(organizationId, report.id, {
          state: plan.state,
          repairs,
          extraCostUsd: round3(extraCostUsd),
          extraLatencyMs,
        });
        await store.renders.update(organizationId, render.id, {
          qaReportId: report.id,
          status: plan.state === 'ready' ? 'qa' : 'needs_attention',
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
      await context.progress(0.8, repairHeadline(plan));
      await context.activity({
        step: 'motion',
        kind: 'refine',
        label: `${repairHeadline(plan).toLowerCase()} (${total})`,
        detail: 'It did not meet the standard, so it is being worked on again.',
        status: 'active',
      });

      for (const repair of plan.scenes) {
        attempted.push(beginRepair({ ...repair, attempt }));
      }
      for (const repair of plan.film) {
        attempted.push(beginRepair({ ...repair, sceneId: null, attempt }));
      }

      // Only what broke. Re-rendering everything would change scenes the
      // customer already approved.
      const applied = applyRepairs(current, plan, { issues: findings });
      current = applied.storyboard;
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
    const passed = gate.state === 'ready';
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
      completedAt: new Date().toISOString(),
      ...(passed ? {} : { error: gate.reason || 'Quality checks did not pass.' }),
    });

    await store.projects.update(
      organizationId,
      project.id,
      kind === 'film'
        ? { latestRenderId: render.id, stage: passed ? 'film_ready' : 'failed' }
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
      label: gate.blocking.length > 0 ? 'finished, with issues to look at' : 'film mastered and saved',
      status: 'done',
    });
    await context.progress(1, gate.blocking.length > 0 ? 'Finished with issues' : 'Done');
    // The honest QA result, not the delivery decision above: an animatic that
    // completes with blockers still has blockers, and the caller is told so.
    return { renderId: render.id, assetId: master.asset.id, qaPassed: gate.blocking.length === 0, issues };
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

/** How much of the tail the fade repair covers. */
const TAIL_FADE_REPAIR_SECONDS = 0.25;

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

  await context.progress(0.15, params.attempt === 0 ? 'Composing the master' : 'Directing the refined shots again');
  await context.activity({
    step: 'motion',
    kind: 'step',
    label: params.attempt === 0 ? `rendering ${storyboard.scenes.length} scenes` : 'directing the refined shots again',
    status: 'active',
  });

  const referenced = storyboard.scenes.flatMap((scene) => scene.assetRefs);
  const assetUrls = await resolveAssetUrls(context, referenced);
  /*
   * Which of them play. A generated shot and a 3D render are clips; everything
   * else the film draws is a still, and handing one to the other is how a
   * commissioned shot ends up as an empty frame.
   */
  const footageAssetIds = await footageAmong(context, referenced);

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
      watermarkLabel: params.watermarked ? 'Preview' : null,
      /*
       * The end card is the company's own address and the company's own line
       * about itself. It used to say "Start free" on every film ever rendered —
       * a promise about a product nobody had checked has a free tier, made on
       * the customer's behalf, on their launch day. By our own editorial rule
       * that is a claim, and we had no evidence for it.
       */
      cta: displayHost(context.project.websiteUrl),
      // One clause, not the whole one-liner: the lockup holds a single line,
      // and handing it a paragraph is how a film ends mid-phrase.
      tagline: params.understanding ? firstClause(params.understanding.oneLiner) : '',
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
    return { path: silentPath, missingAudio: stillMissing, soundIssues, captions, spoken };
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
    return { ...(await mux(context, silentPath, premasterPath, params, stillMissing)), soundIssues, captions, spoken };
  }

  return { ...(await mux(context, silentPath, audioPath, params, stillMissing)), soundIssues, captions, spoken };
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
      ...abruptEndIssue({ tailPeakDb: measured.tailPeakDb, durationSeconds: params.durationSeconds }),
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
  },
): Promise<QaFinding[]> {
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

  if (params.skipVision) return issues;

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

  return issues;
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
