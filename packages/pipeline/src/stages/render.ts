import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  DEFAULT_FPS,
  newId,
  storyboardDuration,
  type AspectRatio,
  type QaIssue,
  type Render,
  type RenderQuality,
  type Storyboard,
} from '@act-one/core';
import { getSystem } from '@act-one/creative';
import { renderFilm } from '@act-one/motion';
import { buildMix, directSound, mixArgs, muxArgs, posterArgs, runFfmpeg, DEFAULT_LIBRARY } from '@act-one/sound';
import { factCheck, planRepairs, applyRepairs, runDeterministicChecks, selectFramesToInspect, inspectFrame } from '@act-one/qa';
import { resolveAssetUrls, storeAsset, type StageContext } from '../context.ts';

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
  quality?: RenderQuality;
  watermarked?: boolean;
  maxRepairAttempts?: number;
  /** Skips vision QA. Used for previews and animatics, where it is not worth it. */
  skipVisionQa?: boolean;
};

export async function runRender(
  context: StageContext,
  options: RenderOptions,
): Promise<{ renderId: string; assetId: string; qaPassed: boolean; issues: QaIssue[] }> {
  const { store, registry, project, organizationId } = context;
  const aspect = options.aspect ?? '16:9';
  const quality = options.quality ?? 'hd';

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

  const render = await store.renders.create({
    id: newId('rnd'),
    projectId: project.id,
    storyboardId: storyboard.id,
    organizationId,
    version: (await store.renders.countForProject(organizationId, project.id)) + 1,
    aspect,
    quality,
    fps: DEFAULT_FPS,
    status: 'rendering_scenes',
    masterAssetId: null,
    posterAssetId: null,
    watermarked: options.watermarked ?? false,
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
        watermarked: options.watermarked ?? false,
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
      metadata: { aspect, quality, watermarked: options.watermarked ?? false },
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

    const passed = !issues.some((issue) => issue.severity === 'blocker');
    await store.renders.update(organizationId, render.id, {
      status: passed ? 'completed' : 'failed',
      masterAssetId: master.asset.id,
      posterAssetId: posterAsset?.asset.id ?? null,
      durationSeconds: storyboardDuration(current),
      completedAt: new Date().toISOString(),
      ...(passed ? {} : { error: 'Quality checks did not pass.' }),
    });

    await store.projects.update(organizationId, project.id, {
      latestRenderId: render.id,
      stage: passed ? 'film_ready' : 'failed',
    });

    await context.progress(1, passed ? 'Done' : 'Finished with issues');
    return { renderId: render.id, assetId: master.asset.id, qaPassed: passed, issues };
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
  const plan = buildMix({
    design,
    resolvedPaths,
    durationSeconds: storyboardDuration(storyboard),
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
