import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ASPECT_DIMENSIONS, DEFAULT_FPS, sceneWindows, storyboardDuration } from '@act-one/core';
import { resolveTokens, watermark } from '@act-one/design';
import type { RenderFilmOptions, RenderFilmResult } from '@act-one/motion';
import type { CallContext, LlmProvider, LlmTier } from '@act-one/providers';
import { writeProject } from './assemble.ts';
import { safeStem, stageAssets, type AssetFailure, type AssetLimits, type AssetRequest, type StagedAsset } from './assets.ts';
import {
  authorScene,
  authorScenes,
  engineScene,
  isEngineScene,
  type AuthoredScene,
  type SceneAuthorOptions,
  type SceneTokens,
} from './author.ts';
import { authoringCanvas, outputPlan } from './canvas.ts';
import { captionsMarkup } from './captions.ts';
import { blocking, CheckOutputError, parseCheckOutput, type CheckReport, type EngineFinding } from './checks.ts';
import { bundleFonts } from './fonts.ts';
import { deliver, deliveryProblems, MediaError, normaliseClip, probeMedia } from './media.ts';
import { buildPackets, referencedAssetIds } from './packets.ts';
import { MemorySceneStore } from './scene-store.ts';
import { studioCss } from './studio.ts';
import { filmTokens, tokenCss } from './tokens.ts';
import { resolveTools, runCli, type HyperFramesTools, type ToolOptions } from './tools.ts';
import type { AuthoredSceneStore, ScenePacket, SceneReport } from './types.ts';
import type { ValidationFinding } from './validate.ts';
import { ENGINE_NAME, ENGINE_VERSION } from './version.ts';

/**
 * The film, rendered by HyperFrames.
 *
 * The same contract as the Remotion engine's `renderFilm` — the same props,
 * the same silent H.264 at the same size and length, the same list of
 * pictures that would not load — so the render stage can hand either engine
 * the same job and mix the same sound onto whichever file comes back.
 *
 * What differs is how the frames come to exist. Each scene is written as a
 * HyperFrames composition by an agent from a brief (or drawn by the engine's
 * own port of the Remotion components when there is no agent, or the agent
 * cannot produce a scene that passes), checked here, assembled with the
 * joins, captions and watermark the engine writes itself, checked again by
 * HyperFrames in its own browser, and only then rendered. A scene HyperFrames
 * refuses is sent back to its author with the reasons; one that still fails
 * is replaced by the engine's composition, and the result says so.
 */
export type SceneAuthorConfig = {
  /** Null (or no config at all) draws every scene with the engine's own composition. */
  llm: LlmProvider | null;
  call: CallContext;
  /** Where written scenes are kept between renders. The animatic's scenes are the master's. */
  store?: AuthoredSceneStore;
  tier?: LlmTier;
  /** Model calls per scene before the engine draws it itself. */
  maxAttempts?: number;
  /** Scenes written at once. */
  concurrency?: number;
  /** Show the model the scene's pictures, small. */
  showPictures?: boolean;
};

export type HyperFramesRenderOptions = RenderFilmOptions & {
  author?: SceneAuthorConfig;
  /** Rewrites of scenes HyperFrames' own check refuses, before the engine draws them itself. */
  maxRepairPasses?: number;
  tools?: ToolOptions;
  /** Where the render's working directory is made. Defaults to the system's temporary directory. */
  workRoot?: string;
  /** Keeps the project and intermediates after the render, for inspection. */
  keepWorkDir?: boolean;
  log?: (line: string) => void;
  assetLimits?: Partial<AssetLimits>;
  fetchImpl?: typeof fetch;
  renderTimeoutMs?: number;
};

export type HyperFramesRenderResult = RenderFilmResult & {
  engine: typeof ENGINE_NAME;
  engineVersion: string;
  cliVersion: string;
  /** Scene by scene: who drew it, in how many attempts, at what cost, and why it fell back when it did. */
  scenes: SceneReport[];
  checks: {
    /** How many times the assembled film was checked. */
    passes: number;
    /** Scenes rewritten or replaced because HyperFrames refused them. */
    rewritten: string[];
    /** What the last check still said: warnings and notes, never errors. */
    findings: EngineFinding[];
  };
  failedAssets: AssetFailure[];
  costUsd: number;
  notes: string[];
  timingsMs: Record<string, number>;
  /** Set when the working directory was kept. */
  workDir: string | null;
};

export type HyperFramesErrorCode = 'invalid_input' | 'check_failed' | 'render_failed' | 'output_mismatch';

export class HyperFramesRenderError extends Error {
  readonly code: HyperFramesErrorCode;
  readonly details: string[];

  constructor(code: HyperFramesErrorCode, message: string, details: string[] = []) {
    super(details.length > 0 ? `${message}\n  ${details.slice(0, 12).join('\n  ')}` : message);
    this.name = 'HyperFramesRenderError';
    this.code = code;
    this.details = details;
  }
}

const CHECK_TIMEOUT_MS = 10 * 60_000;
const STILL_TIMEOUT_MS = 5 * 60_000;
const LOGO_ID = 'brand-logo';

export async function renderFilmWithHyperFrames(options: HyperFramesRenderOptions): Promise<HyperFramesRenderResult> {
  const log = options.log ?? ((line: string) => console.log(`[hyperframes] ${line}`));
  const fps = options.fps ?? DEFAULT_FPS;
  const quality = options.quality ?? 'hd';
  const { props, aspect, signal } = options;
  const storyboard = props.storyboard;
  checkInput(options, fps);

  const durationSeconds = storyboardDuration(storyboard);
  // Counted as the Remotion engine counts a film: its length at this rate, rounded to a frame.
  const filmFrames = Math.max(1, Math.round(durationSeconds * fps));
  const canvas = authoringCanvas(aspect);
  const plan = outputPlan(aspect, quality);
  const crf = quality === 'uhd' ? 16 : 18;
  const design = resolveTokens(props.brand, {
    aspect,
    quality: 'hd',
    theme: props.theme ?? 'auto',
    ...(props.typeScale ? { scale: props.typeScale } : {}),
  });
  const tokens: SceneTokens = { film: filmTokens(design), design };
  const notes: string[] = plan.note ? [plan.note] : [];
  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await work();
    } finally {
      timings[label] = (timings[label] ?? 0) + (Date.now() - started);
    }
  };
  const progress = progressReporter(options.onProgress, filmFrames);

  const tools = await resolveTools({
    ...(options.browserExecutable ? { browserPath: options.browserExecutable } : {}),
    ...options.tools,
  });
  const workDir = await mkdtemp(path.join(options.workRoot ?? os.tmpdir(), 'act-one-hyperframes-'));
  const projectDir = path.join(workDir, 'project');
  log(`${storyboard.scenes.length} scenes, ${durationSeconds.toFixed(2)} s at ${fps} fps → ${plan.width}×${plan.height} (${quality}); HyperFrames ${tools.cliVersion}`);

  try {
    await mkdir(projectDir, { recursive: true });
    await mkdir(path.dirname(options.outputPath), { recursive: true });

    // 1. The pictures and clips, fetched, checked and made seekable.
    const requests = assetRequests(options);
    const stagedResult = await timed('assets', () =>
      stageAssets(requests, projectDir, {
        ffprobePath: tools.ffprobePath,
        ...(options.assetLimits ? { limits: options.assetLimits } : {}),
        ...(signal ? { signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
    );
    const failed = [...stagedResult.failed];
    const staged = await timed('clips', () => seekableClips(stagedResult.staged, projectDir, fps, tools, failed, signal, log));
    const footageHint = new Set(props.footageAssetIds ?? []);
    for (const id of footageHint) {
      if (staged.get(id)?.kind === 'image') notes.push(`${id} was listed as footage but is a still picture; it is placed as one.`);
    }
    const logo = logoOf(options, staged, failed, notes);
    const referenced = new Set(referencedAssetIds(storyboard));
    const undecodable = failed.filter((failure) => referenced.has(failure.id)).map((failure) => `${failure.id} (${failure.url}): ${failure.reason}`);
    for (const line of undecodable) log(`asset refused: ${line}`);

    // 2. The briefs.
    const fonts = await bundleFonts(projectDir);
    const packets = buildPackets({
      storyboard,
      brandName: props.brand.name,
      canvas,
      staged,
      logo,
      cta: props.cta ?? '',
      tagline: props.tagline ?? '',
      design,
    });
    const frameIds = new Set(packets.map((packet) => packet.frameId));
    const windows = new Map(
      sceneWindows(storyboard).map((window) => [packets.find((packet) => packet.sceneId === window.sceneId)!.frameId, window]),
    );

    // 3. The scenes.
    const authorOptions = sceneAuthorOptions(options, log);
    const authored = await timed('author', () => authorScenes(packets, tokens, projectDir, authorOptions));
    progress.phase(0.3, `${authored.length} scenes written`);
    const scenes = new Map(authored.map((scene) => [scene.packet.frameId, scene]));

    // 4. Assembled and checked by HyperFrames, scene rewrites until it passes.
    const assemble = async () => {
      await writeProject({
        projectDir,
        canvas,
        fps,
        filmFrames,
        language: storyboard.language ?? 'en',
        packets,
        scenes: new Map([...scenes].map(([frameId, scene]) => [frameId, scene.html])),
        windows,
        tokenCss: tokenCss(tokens.film),
        studioCss: studioCss(design),
        fontCss: fonts.css,
        captionsHtml: props.captions && props.captions.length > 0 ? captionsMarkup(props.captions, tokens.film, aspect, 3) : '',
        watermarkSvg: props.watermarkLabel ? watermark(design, props.watermarkLabel) : null,
      });
    };
    const checked = await timed('check', () =>
      checkUntilClean({
        scenes,
        packets,
        windows,
        fps,
        frameIds,
        tokens,
        projectDir,
        tools,
        authorOptions,
        maxRepairPasses: options.maxRepairPasses ?? 2,
        assemble,
        log,
        ...(signal ? { signal } : {}),
      }),
    );
    progress.phase(0.35, 'checked');
    const sceneReports = packets.map((packet) => scenes.get(packet.frameId)!.report);
    const costUsd = sceneReports.reduce((sum, report) => sum + report.costUsd, 0);
    const summary = summarise(sceneReports);
    log(`scenes: ${summary}; ${checked.passes} check pass(es); $${costUsd.toFixed(4)} on scene writing`);

    const common = {
      fps,
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      cliVersion: tools.cliVersion,
      scenes: sceneReports,
      checks: { passes: checked.passes, rewritten: checked.rewritten, findings: checked.findings },
      failedAssets: failed,
      costUsd,
      notes,
      timingsMs: timings,
      workDir: options.keepWorkDir ? workDir : null,
    } as const;

    // 5a. A still, for posters and animatic frames.
    if (options.stillAtSeconds !== undefined) {
      await timed('still', () => renderStill(tools, projectDir, workDir, options.outputPath, options.stillAtSeconds!, fps, plan, signal));
      progress.phase(1, 'still written');
      return { ...common, outputPath: options.outputPath, durationSeconds: 0, width: plan.width, height: plan.height, undecodable: [] };
    }

    // 5b. The film.
    const rawPath = path.join(workDir, 'render.mp4');
    const renderArgs = [
      'render',
      '--output', rawPath,
      '--format', 'mp4',
      '--fps', String(fps),
      '--quality', 'high',
      // The Remotion engine's rates: visually lossless for interface captures, which band long before photographs do.
      '--crf', String(crf),
      '--workers', options.concurrency && options.concurrency > 0 ? String(Math.floor(options.concurrency)) : 'auto',
      // Software rendering, as the Remotion engine renders: the same pixels on every worker, GPU or not.
      '--no-browser-gpu',
      '--strict',
      // Frames of a customer's clips are extracted into this render's own directory and removed with it.
      '--frames-cache-dir', 'off',
      '--video-frame-format', 'png',
      ...(plan.resolutionPreset ? ['--resolution', plan.resolutionPreset] : []),
      projectDir,
    ];
    const run = await timed('render', () =>
      runCli(tools, renderArgs, {
        cwd: projectDir,
        timeoutMs: options.renderTimeoutMs ?? Math.max(20 * 60_000, filmFrames * (quality === 'uhd' ? 4_000 : 1_500)),
        ...(signal ? { signal } : {}),
        onLine: (line) => progress.renderLine(line),
      }),
    );
    if (run.exitCode !== 0) {
      throw new HyperFramesRenderError('render_failed', `hyperframes render exited with ${run.exitCode ?? run.signal}.`, [
        ...run.stderrTail.slice(-10),
        ...run.stdoutTail.slice(-10),
      ]);
    }

    const delivered = await timed('deliver', () =>
      deliver(tools.ffprobePath, rawPath, options.outputPath, { width: plan.width, height: plan.height, crf }, signal),
    );
    const problems = deliveryProblems(delivered.facts, { width: plan.width, height: plan.height, frames: filmFrames });
    if (problems.length > 0) {
      throw new HyperFramesRenderError('output_mismatch', 'The rendered film is not the film that was asked for.', problems);
    }
    if (delivered.treatment !== 'moved') notes.push(`The rendered file was ${delivered.treatment} to reach the delivery.`);
    progress.phase(1, 'delivered');
    log(`delivered ${options.outputPath} (${delivered.treatment}); timings ${JSON.stringify(timings)}`);

    return {
      ...common,
      outputPath: options.outputPath,
      durationSeconds: (delivered.facts.frames ?? filmFrames) / fps,
      width: plan.width,
      height: plan.height,
      undecodable,
    };
  } finally {
    if (!options.keepWorkDir) {
      await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
        log(`could not remove ${workDir}: ${(error as Error).message}`);
      });
    }
  }
}

function checkInput(options: HyperFramesRenderOptions, fps: number): void {
  const problems: string[] = [];
  const storyboard = options.props?.storyboard;
  if (!storyboard || !Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) problems.push('the storyboard has no scenes');
  else {
    const duration = storyboardDuration(storyboard);
    if (!Number.isFinite(duration) || duration <= 0) problems.push('the storyboard has no duration');
    if (options.stillAtSeconds !== undefined && (!Number.isFinite(options.stillAtSeconds) || options.stillAtSeconds < 0 || options.stillAtSeconds > duration)) {
      problems.push(`a still was asked for at ${options.stillAtSeconds} s, outside the film`);
    }
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) problems.push(`${fps} is not a frame rate this engine renders (1 to 120, whole)`);
  if (!(options.aspect in ASPECT_DIMENSIONS)) problems.push(`${String(options.aspect)} is not an aspect ratio this engine renders`);
  if (typeof options.outputPath !== 'string' || options.outputPath.length === 0) problems.push('no output path');
  if (!options.props?.brand) problems.push('no brand system');
  if (problems.length > 0) throw new HyperFramesRenderError('invalid_input', 'The render cannot start.', problems);
}

/** The files the film places, and the logo, as fetch requests. */
function assetRequests(options: HyperFramesRenderOptions): AssetRequest[] {
  const { props } = options;
  const requests: AssetRequest[] = [];
  for (const id of referencedAssetIds(props.storyboard)) {
    const url = props.assetUrls[id];
    // An asset with no address is the render stage's to report (it knows which were missing); only fetch what was given.
    if (url) requests.push({ id, url, trusted: true });
  }
  const logo = props.brand.logo;
  if (logo?.assetId && props.assetUrls[logo.assetId]) {
    requests.push({ id: logo.assetId, url: props.assetUrls[logo.assetId]!, trusted: true });
  } else if (logo?.url) {
    // Read off the customer's own site: fetched only from a public address.
    requests.push({ id: LOGO_ID, url: logo.url, trusted: false });
  }
  return requests;
}

function logoOf(options: HyperFramesRenderOptions, staged: ReadonlyMap<string, StagedAsset>, failed: readonly AssetFailure[], notes: string[]): StagedAsset | null {
  const logo = options.props.brand.logo;
  if (!logo) return null;
  const id = logo.assetId && options.props.assetUrls[logo.assetId] ? logo.assetId : logo.url ? LOGO_ID : null;
  if (!id) return null;
  const asset = staged.get(id);
  if (asset?.kind === 'image') return asset;
  const failure = failed.find((candidate) => candidate.id === id);
  notes.push(`The logo could not be placed (${failure?.reason ?? 'not a picture'}); the brand name is set in its place.`);
  return null;
}

/**
 * Every clip re-encoded so HyperFrames seeks it to the right frame.
 *
 * The path a scene uses is fixed by the asset's id, so the scene written for
 * the animatic finds the same file in the master; the size recorded is the
 * original's, so the brief (and the cache key) do not depend on the encoder.
 */
async function seekableClips(
  staged: ReadonlyMap<string, StagedAsset>,
  projectDir: string,
  fps: number,
  tools: HyperFramesTools,
  failed: AssetFailure[],
  signal: AbortSignal | undefined,
  log: (line: string) => void,
): Promise<Map<string, StagedAsset>> {
  const result = new Map<string, StagedAsset>();
  for (const [id, asset] of staged) {
    if (asset.kind !== 'video') {
      result.set(id, asset);
      continue;
    }
    const source = path.join(projectDir, asset.path);
    const stem = safeStem(id);
    const temporary = path.join(projectDir, 'assets', `${stem}.seekable.mp4`);
    const finalPath = `assets/${stem}.mp4`;
    try {
      await normaliseClip(source, temporary, fps, signal);
      await rm(source, { force: true });
      await rename(temporary, path.join(projectDir, finalPath));
      const facts = await probeMedia(tools.ffprobePath, path.join(projectDir, finalPath), signal);
      result.set(id, {
        ...asset,
        path: finalPath,
        format: 'mp4',
        width: facts.width,
        height: facts.height,
        durationSeconds: facts.durationSeconds,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof MediaError ? error.message : `the clip could not be prepared: ${(error as Error).message}`;
      log(`${id}: ${reason}`);
      failed.push({ id, url: asset.path, reason });
      await rm(temporary, { force: true });
    }
  }
  return result;
}

function sceneAuthorOptions(options: HyperFramesRenderOptions, log: (line: string) => void): SceneAuthorOptions {
  const author = options.author;
  const signals = [options.signal, author?.call.signal].filter((signal): signal is AbortSignal => signal !== undefined);
  const call: CallContext = {
    ...(author?.call ?? { organizationId: 'act-one-engine' }),
    ...(signals.length > 0 ? { signal: signals.length === 1 ? signals[0]! : AbortSignal.any(signals) } : {}),
  };
  return {
    llm: author?.llm ?? null,
    call,
    tier: author?.tier ?? 'deep',
    store: author?.store ?? new MemorySceneStore(),
    maxAttempts: Math.max(0, Math.floor(author?.maxAttempts ?? 3)),
    concurrency: Math.max(1, Math.floor(author?.concurrency ?? 4)),
    showPictures: author?.showPictures ?? true,
    log,
    breaker: { reason: null },
  };
}

type CheckLoopInput = {
  scenes: Map<string, AuthoredScene>;
  packets: readonly ScenePacket[];
  windows: ReadonlyMap<string, { fromSeconds: number; toSeconds: number }>;
  fps: number;
  frameIds: ReadonlySet<string>;
  tokens: SceneTokens;
  projectDir: string;
  tools: HyperFramesTools;
  authorOptions: SceneAuthorOptions;
  maxRepairPasses: number;
  assemble: () => Promise<void>;
  log: (line: string) => void;
  signal?: AbortSignal;
};

/**
 * Assemble, check, and rewrite what HyperFrames refused, until nothing is refused.
 *
 * Bounded: at most `maxRepairPasses` rounds of rewriting by the agent, then
 * one round in which every scene still refused is replaced by the engine's own
 * composition. If that composition is refused too, or a refusal names no scene
 * at all, the fault is the engine's and the render stops with the findings.
 */
async function checkUntilClean(input: CheckLoopInput): Promise<{ passes: number; rewritten: string[]; findings: EngineFinding[] }> {
  const rewritten = new Set<string>();
  let enginePassUsed = false;
  for (let pass = 1; ; pass += 1) {
    await input.assemble();
    const report = await runCheck(input.tools, input.projectDir, input.frameIds, input.signal);
    const errors = blocking(report.findings);
    if (errors.length === 0) {
      return { passes: pass, rewritten: [...rewritten].sort(), findings: report.findings };
    }
    input.log(`check pass ${pass}: ${errors.length} blocking finding(s): ${errors.map((finding) => `${finding.code}@${finding.frameIds.join('+') || 'film'}`).join(', ')}`);

    const unattributed = errors.filter((finding) => finding.frameIds.length === 0);
    if (unattributed.length > 0) {
      throw new HyperFramesRenderError('check_failed', 'HyperFrames refused the assembled film for reasons no scene accounts for.', unattributed.map(describe));
    }

    const byScene = new Map<string, EngineFinding[]>();
    for (const finding of errors) {
      for (const frameId of finding.frameIds) byScene.set(frameId, [...(byScene.get(frameId) ?? []), finding]);
    }

    const agentMayRewrite =
      pass <= input.maxRepairPasses && input.authorOptions.llm !== null && input.authorOptions.maxAttempts > 0 && !input.authorOptions.breaker?.reason;
    if (!agentMayRewrite && enginePassUsed) {
      throw new HyperFramesRenderError('check_failed', 'HyperFrames still refuses scenes after every rewrite.', errors.map(describe));
    }
    for (const [frameId, findings] of byScene) {
      const current = input.scenes.get(frameId)!;
      if (isEngineScene(current.html)) {
        // The engine's own composition must pass HyperFrames' checks; a refusal here is a bug in this package.
        throw new HyperFramesRenderError('check_failed', `HyperFrames refused the engine's own composition for ${frameId}.`, findings.map(describe));
      }
      if (agentMayRewrite) {
        const next = await authorScene(current.packet, input.tokens, input.projectDir, input.authorOptions, {
          previous: current.html,
          findings: findings.map((finding) => asFeedback(finding, input.windows.get(frameId), input.fps)),
        });
        input.scenes.set(frameId, withHistory(current, next));
      } else {
        const drawn = engineScene(
          current.packet,
          input.tokens.design,
          current.key,
          current.report.attempts,
          current.report.costUsd,
          `HyperFrames refused the written scene: ${findings.map((finding) => finding.code).join(', ')}`,
        );
        await input.authorOptions.store.put(current.key, drawn.html).catch((error: unknown) => {
          input.log(`${frameId}: could not keep the engine's composition (${(error as Error).message})`);
        });
        input.scenes.set(frameId, drawn);
      }
      rewritten.add(frameId);
    }
    if (!agentMayRewrite) enginePassUsed = true;
  }
}

async function runCheck(tools: HyperFramesTools, projectDir: string, frameIds: ReadonlySet<string>, signal?: AbortSignal): Promise<CheckReport> {
  const run = await runCli(
    tools,
    ['check', '--json', '--no-browser-gpu', '--timeout', '20000', '--max-issues', '200', projectDir],
    { cwd: projectDir, timeoutMs: CHECK_TIMEOUT_MS, captureStdout: true, ...(signal ? { signal } : {}) },
  );
  try {
    return parseCheckOutput(run.stdout, projectDir, frameIds);
  } catch (error) {
    if (!(error instanceof CheckOutputError)) throw error;
    throw new HyperFramesRenderError('check_failed', `hyperframes check did not report (exit ${run.exitCode ?? run.signal}).`, [
      ...run.stderrTail.slice(-10),
      ...run.stdoutTail.slice(-5),
    ]);
  }
}

/** A HyperFrames finding, told to the agent in the scene's own time. */
function asFeedback(finding: EngineFinding, window: { fromSeconds: number } | undefined, fps: number): ValidationFinding {
  const local = finding.atSeconds !== null && window ? Math.max(0, finding.atSeconds - Math.round(window.fromSeconds * fps) / fps) : null;
  const where = [finding.selector ? `on ${finding.selector}` : null, local !== null ? `at ${local.toFixed(2)} s into the scene` : null].filter(Boolean).join(' ');
  return {
    code: `hyperframes_${finding.section}_${finding.code}`,
    severity: 'error',
    message: `${finding.message}${where ? ` (${where})` : ''}${finding.fixHint ? ` Fix: ${finding.fixHint}` : ''}`,
  };
}

/** The rewritten scene, carrying the attempts and cost of every version before it. */
function withHistory(previous: AuthoredScene, next: AuthoredScene): AuthoredScene {
  return {
    ...next,
    report: {
      ...next.report,
      attempts: previous.report.attempts + next.report.attempts,
      costUsd: previous.report.costUsd + next.report.costUsd,
    },
  };
}

function describe(finding: EngineFinding): string {
  return `[${finding.section}/${finding.code}]${finding.file ? ` ${finding.file}` : ''}${finding.selector ? ` ${finding.selector}` : ''}: ${finding.message.slice(0, 240)}`;
}

function summarise(reports: readonly SceneReport[]): string {
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report.source, (counts.get(report.source) ?? 0) + 1);
  return [...counts].map(([source, count]) => `${count} ${source}`).join(', ');
}

/**
 * One frame as a PNG, at the size the render would have had.
 *
 * Seeked to the frame the Remotion engine would draw — the requested time
 * rounded to a frame — and scaled only when the size asked for is not the
 * size the scenes were written at.
 */
async function renderStill(
  tools: HyperFramesTools,
  projectDir: string,
  workDir: string,
  outputPath: string,
  atSeconds: number,
  fps: number,
  plan: { width: number; height: number },
  signal: AbortSignal | undefined,
): Promise<void> {
  const stillDir = path.join(workDir, 'still');
  const at = Math.round(atSeconds * fps) / fps;
  const run = await runCli(
    tools,
    ['snapshot', '--at', String(at), '--no-end', '--output', stillDir, '--describe', 'false', '--no-browser-gpu', '--timeout', '20000', projectDir],
    { cwd: projectDir, timeoutMs: STILL_TIMEOUT_MS, ...(signal ? { signal } : {}) },
  );
  const pictures = (await readdir(stillDir).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith('.png')).sort();
  if (run.exitCode !== 0 || pictures.length === 0) {
    throw new HyperFramesRenderError('render_failed', `hyperframes snapshot did not write a frame (exit ${run.exitCode ?? run.signal}).`, [
      ...run.stderrTail.slice(-10),
      ...run.stdoutTail.slice(-5),
    ]);
  }
  await sharp(path.join(stillDir, pictures[0]!))
    .resize({ width: plan.width, height: plan.height, fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toFile(outputPath);
}

/**
 * Progress in the Remotion engine's shape, across the whole engine run.
 *
 * Writing the scenes is most of the wait on a first render and none of it on
 * a re-render from stored scenes, so the fraction is spent in phases: 30% on
 * the scenes, 5% on the check, the rest on frames as HyperFrames reports them.
 */
function progressReporter(
  onProgress: RenderFilmOptions['onProgress'],
  totalFrames: number,
): { phase: (fraction: number, label: string) => void; renderLine: (line: string) => void } {
  let last = -1;
  const emit = (fraction: number, frames: number) => {
    const clamped = Math.min(1, Math.max(0, fraction));
    if (!onProgress || clamped - last < 0.005) return;
    last = clamped;
    try {
      onProgress({ renderedFrames: frames, encodedFrames: frames, progress: clamped });
    } catch {
      // A progress callback must never take the render down with it.
    }
  };
  return {
    phase: (fraction, _label) => emit(fraction, fraction >= 1 ? totalFrames : 0),
    renderLine: (line) => {
      const frame = /frame (\d+)\s*\/\s*(\d+)/i.exec(line);
      if (frame) {
        const done = Number(frame[1]);
        const total = Number(frame[2]) || totalFrames;
        emit(0.35 + 0.6 * (done / total), done);
      }
    },
  };
}
