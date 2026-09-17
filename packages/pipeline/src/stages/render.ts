import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  DEFAULT_FPS,
  isRealProductAsset,
  newId,
  REAL_PRODUCT_VISUAL_TYPES,
  storyboardDuration,
  type AspectRatio,
  type QaIssue,
  type Render,
  type RenderKind,
  type RenderQuality,
  type Storyboard,
} from '@act-one/core';
import { getSystem } from '@act-one/creative';
import { renderFilm } from '@act-one/motion';
import { buildMix, directSound, mixArgs, muxArgs, posterArgs, runFfmpeg, DEFAULT_LIBRARY } from '@act-one/sound';
import { factCheck, planRepairs, applyRepairs, runDeterministicChecks, selectFramesToInspect, inspectFrame } from '@act-one/qa';
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
      masterPath = await renderOnce(context, {
        render,
        storyboard: current,
        brand,
        system,
        aspect,
        quality,
        watermarked,
        workDir,
        attempt,
      });

      issues = await inspect(context, {
        storyboard: current,
        brand,
        aspect,
        masterPath,
        workDir,
        skipVision: options.skipVisionQa ?? false,
      });

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
      posterArgs(masterPath, Math.min(1.5, storyboardDuration(current) * 0.2), posterPath),
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
  },
): Promise<string> {
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
      cta: 'Start free',
      tagline: '',
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

  // Resolve library assets to local paths. Anything missing is simply absent
  // from the mix rather than failing the render — a film with no whoosh is
  // still a film.
  const resolvedPaths = await resolveLibraryPaths(context, design);
  const voiceTracks = await speakNarration(context, storyboard, params.workDir, params.attempt);
  const plan = buildMix({
    design,
    resolvedPaths,
    durationSeconds: storyboardDuration(storyboard),
    ...(voiceTracks.length > 0 ? { voiceTracks } : {}),
  });

  const audioPath = path.join(params.workDir, `mix-${params.attempt}.m4a`);
  const mixed = await runFfmpeg(mixArgs(plan, audioPath), {
    signal: context.signal,
    timeoutMs: 300_000,
  });

  if (!mixed.ok) {
    // A broken filter graph must not cost the whole render; ship the picture.
    console.error('[render] mix failed, shipping silent film:', mixed.stderr.slice(-400));
    return silentPath;
  }

  await context.progress(0.72, 'Mixing');

  const masterPath = path.join(params.workDir, `master-${params.attempt}.mp4`);
  const muxed = await runFfmpeg(muxArgs(silentPath, audioPath, masterPath), {
    signal: context.signal,
    timeoutMs: 300_000,
  });

  return muxed.ok ? masterPath : silentPath;
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
  },
): Promise<QaIssue[]> {
  const { store, registry, project, organizationId } = context;
  await context.progress(0.78, 'Checking the film');

  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : null;

  const issues: QaIssue[] = [
    ...runDeterministicChecks({
      storyboard: params.storyboard,
      brand: params.brand,
      aspect: params.aspect,
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

async function resolveLibraryPaths(
  context: StageContext,
  design: ReturnType<typeof directSound>,
): Promise<Record<string, string>> {
  const keys = [
    ...(design.music ? [design.music.storageKey] : []),
    ...design.cues.map((cue) => cue.storageKey).filter((key): key is string => key !== null),
  ];

  const storage = context.registry.storage();
  const resolved: Record<string, string> = {};

  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      if (await storage.exists(key)) {
        resolved[key] = await storage.signedUrl(key, 3600);
      }
    }),
  );

  return resolved;
}

export { DEFAULT_LIBRARY };
