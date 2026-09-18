import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
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
  type QaIssue,
  type Render,
  type RenderKind,
  type RenderQuality,
  type Storyboard,
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
  applyRepairs,
  factCheck,
  flashIssues,
  inspectFrame,
  isFullRange,
  planRepairs,
  relativeLuminance,
  colourShares,
  distributionIssues,
  parseFrameStats,
  rangeIssues,
  redFlashIssues,
  redness,
  runDeterministicChecks,
  selectFramesToInspect,
  verifyMaster,
} from '@act-one/qa';
import { resolveAssetUrls, storeAsset, type StageContext } from '../context.ts';
import { masterTermsFor, planFor } from '../entitlements.ts';

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
};

export async function runRender(
  context: StageContext,
  options: RenderOptions,
): Promise<{ renderId: string; assetId: string; qaPassed: boolean; issues: QaIssue[] }> {
  const { store, registry, project, organizationId } = context;
  const aspect = options.aspect ?? '16:9';
  const kind = options.kind ?? 'film';

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
  const terms = masterTermsFor(await planFor(store, organizationId));
  const quality = options.quality ?? (kind === 'animatic' ? 'preview' : terms.quality);
  const watermarked = kind === 'animatic' ? false : terms.watermarked;

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
    let issues: QaIssue[] = [];
    let masterPath = '';
    const maxAttempts = options.maxRepairAttempts ?? 2;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      const rendered = await renderOnce(context, {
        render,
        storyboard: current,
        brand,
        system,
        aspect,
        quality,
        watermarked,
        workDir,
        attempt,
        understanding,
      });
      masterPath = rendered.path;

      issues = await inspect(context, {
        storyboard: current,
        brand,
        aspect,
        masterPath,
        workDir,
        skipVision: options.skipVisionQa ?? false,
        understanding,
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
            atSeconds: null,
            detectedBy: 'deterministic',
            evidenceAssetId: null,
            check: 'missing_audio',
            severity: 'major',
            message:
              `The sound library is missing ${rendered.missingAudio.length} file(s), so this film ` +
              `is silent where it was scored. Run \`npm run sound-library\`. ` +
              `First missing: ${rendered.missingAudio[0]}`,
            confidence: 1,
            repair: 'manual_review',
          },
        ];
      }

      const report = await store.qaReports.create(
        {
          id: newId('ast'),
          renderId: render.id,
          projectId: project.id,
          passed: !issues.some((issue) => issue.severity === 'blocker'),
          issues,
          repairActions: [],
          framesInspected: issues.length,
          createdAt: new Date().toISOString(),
        },
        organizationId,
      );

      const plan = planRepairs(report, attempt, maxAttempts);
      if (plan.shippable || plan.deadEnd) {
        await store.renders.update(organizationId, render.id, { qaReportId: report.id });
        break;
      }

      await context.progress(0.8, `Repairing ${plan.scenes.length} scene(s)`);
      // Only what broke. Re-rendering everything would change scenes the
      // customer already approved.
      const applied = applyRepairs(current, plan);
      current = applied.storyboard;
      await store.storyboards.replaceScenes(organizationId, current.id, current.scenes);
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
    const blocked = issues.some((issue) => issue.severity === 'blocker');
    const passed = !blocked || kind === 'animatic';
    await store.renders.update(organizationId, render.id, {
      status: passed ? 'completed' : 'failed',
      masterAssetId: master.asset.id,
      posterAssetId: posterAsset?.asset.id ?? null,
      durationSeconds: storyboardDuration(current),
      completedAt: new Date().toISOString(),
      ...(passed ? {} : { error: 'Quality checks did not pass.' }),
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

    await context.progress(1, blocked ? 'Finished with issues' : 'Done');
    // The honest QA result, not the delivery decision above: an animatic that
    // completes with blockers still has blockers, and the caller is told so.
    return { renderId: render.id, assetId: master.asset.id, qaPassed: !blocked, issues };
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
  },
): Promise<{ path: string; missingAudio: string[]; soundIssues: QaIssue[] }> {
  const { storyboard, brand, system } = params;

  await context.progress(0.15, params.attempt === 0 ? 'Rendering the film' : 'Re-rendering repaired scenes');

  const assetUrls = await resolveAssetUrls(
    context,
    storyboard.scenes.flatMap((scene) => scene.assetRefs),
  );

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
    },
    aspect: params.aspect,
    quality: params.quality,
    outputPath: silentPath,
    signal: context.signal,
    onProgress: ({ progress }) => void context.progress(0.15 + progress * 0.45, 'Rendering'),
  });

  await context.progress(0.62, 'Designing the sound');

  const design = directSound({
    storyboard,
    behaviour: system.sound,
    channel: params.aspect === '9:16' ? 'social' : 'web',
    hasVoiceOver: storyboard.scenes.some((scene) => scene.voiceOver),
  });

  // A film with no whoosh is still a film, so a missing asset never fails the
  // render — but it is reported, and the caller turns it into a QA finding.
  const { resolved: resolvedPaths, missing: missingAudio } = await resolveLibraryPaths(context, design);
  const voiceTracks = await speakNarration(context, storyboard, params.workDir, params.attempt);

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
  const soundIssues: QaIssue[] = [];
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
        atSeconds: voiceTracks[0]?.atSeconds ?? null,
        detectedBy: 'deterministic',
        evidenceAssetId: null,
        check: 'audio_balance',
        severity: 'major',
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
    return { path: silentPath, missingAudio, soundIssues };
  }

  await context.progress(0.72, 'Mixing');

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
    return { ...(await mux(context, silentPath, premasterPath, params, missingAudio)), soundIssues };
  }

  return { ...(await mux(context, silentPath, audioPath, params, missingAudio)), soundIssues };
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
): Promise<QaIssue[]> {
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
          atSeconds: null,
          detectedBy: 'deterministic',
          evidenceAssetId: null,
          check: 'flicker',
          severity: 'major',
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
): Promise<QaIssue[]> {
  const tokens = resolveTokens(params.brand, { aspect: params.aspect });
  const candidates = params.storyboard.scenes
    .filter((scene) => ['kinetic_typography', 'statistic', 'quote'].includes(scene.visualType))
    .filter((scene) => scene.onScreenText.some((line) => line.trim().length > 0))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3);

  const issues: QaIssue[] = [];
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
  },
): Promise<QaIssue[]> {
  const { registry, project, organizationId } = context;
  await context.progress(0.78, 'Checking the film');

  const { understanding } = params;

  const issues: QaIssue[] = [
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

  if (params.skipVision) return issues;

  // Vision QA reads actual frames, extracted from the finished film so it sees
  // exactly what the customer will.
  const frames = selectFramesToInspect(params.storyboard.scenes, { maxFrames: 6 });
  for (const frame of frames) {
    const framePath = path.join(params.workDir, `qa-${frame.scene.id}.jpg`);
    const extracted = await runFfmpeg(posterArgs(params.masterPath, frame.atSeconds, framePath), {
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
          { frameUrl: dataUrl, scene: frame.scene, atSeconds: frame.atSeconds },
          { organizationId, projectId: project.id, sceneId: frame.scene.id, signal: context.signal },
        )),
      );
    } catch (error) {
      // A failed inspection is not a failed film.
      console.error('[render] frame inspection failed:', (error as Error).message);
    }
  }

  return issues;
}

/**
 * Speaks the narration the storyboard was approved with.
 *
 * The storyboard panel shows narration in quotes and the customer approves it,
 * so a film that never says any of it is a film that does not match what they
 * signed off. Written per scene rather than as one long take, because each line
 * has to land inside its own scene — a single file drifts against the cut the
 * moment any scene's duration changes.
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
  attempt: number,
): Promise<{ path: string; atSeconds: number; durationSeconds: number }[]> {
  const spoken = storyboard.scenes.filter(
    (scene) => scene.voiceOver && scene.narration.trim().length > 0,
  );
  if (storyboard.voiceStrategy === 'none' || spoken.length === 0) return [];

  const speech = context.registry.speech();
  const persona = PERSONA_FOR_STRATEGY[storyboard.voiceStrategy] ?? 'narrator_neutral';
  const tracks: { path: string; atSeconds: number; durationSeconds: number }[] = [];

  for (const scene of spoken) {
    try {
      const result = await speech.synthesize(
        {
          text: scene.narration.trim(),
          persona,
          // Rate is set from the room the line has to fit in, not from taste: a
          // line written for 2.4 seconds must not run 3.
          rate: speakingRateFor(scene.narration, scene.duration),
          format: 'wav',
        },
        { organizationId: context.organizationId, projectId: context.project.id },
      );

      const file = path.join(workDir, `vo-${attempt}-${scene.index}.wav`);
      await writeFile(file, result.audio);
      tracks.push({
        path: file,
        atSeconds: scene.startTime,
        durationSeconds: Math.min(result.durationSecondsEstimate, scene.duration),
      });
    } catch (error) {
      console.error(
        `[render] narration for scene ${scene.index} failed:`,
        (error as Error).message.slice(0, 200),
      );
    }
  }

  return tracks;
}

/** Each voice strategy has a register; none of them is a cloned person. */
const PERSONA_FOR_STRATEGY: Record<string, 'narrator_neutral' | 'narrator_warm' | 'narrator_low'> = {
  founder: 'narrator_warm',
  narrator: 'narrator_neutral',
  documentary: 'narrator_low',
};

/**
 * How fast to read so the line fits its scene.
 *
 * Clamped hard at both ends: a line rushed past 1.15 sounds panicked, and one
 * slowed below 0.85 sounds drugged. Outside that range the honest answer is
 * that the copy is wrong for the cut, which the timing engine already fixes
 * upstream.
 */
export function speakingRateFor(narration: string, seconds: number): number {
  const words = narration.trim().split(/\s+/).length;
  // Around 2.6 words a second is an unhurried read.
  const needed = words / 2.6;
  if (seconds <= 0) return 1;
  return Math.min(1.15, Math.max(0.85, needed / seconds));
}

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
