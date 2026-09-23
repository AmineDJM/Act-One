import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  BENCHMARK_STAGE_LABELS,
  PLATFORM_ORGANIZATION_ID,
  benchmarkKeys,
  retryDelayMs,
  sniffContainer,
  toAppError,
  type Benchmark,
  type BenchmarkStage,
  type BenchmarkStageId,
  type Job,
} from '@act-one/core';
import {
  EXPECTED_PASSES,
  ForensicsError,
  analysisVersion,
  analyzeFilm,
  checkForensicsRuntime,
  mediaFromDocument,
  mediaFromProbe,
  probeFilm,
  storageCheckpoints,
  summarizeFilmIR,
  type AnalyzeResult,
  type AnalyzeStage,
} from '@act-one/film-ir';
import { resolveFfmpeg } from '@act-one/sound';
import type { JobOutcome, RunnerDeps } from './runner.ts';

/**
 * Reading one reference film into its FilmIR, as a queued job.
 *
 * The film is fetched from storage, checked against the bytes that were
 * uploaded, probed, and handed to the reverse compiler with its checkpoints
 * in object storage under the benchmark's current run. Every stage the
 * compiler starts, finishes, skips or fails is mirrored onto the benchmark
 * record as it happens, so the console shows where a film is without reading
 * storage, and a retry — this job's own, after a crash or a deploy, or one an
 * operator asks for — resumes at the first stage without a checkpoint.
 *
 * A new analysis is a new run with a new prefix; the last complete FilmIR
 * stays the library's until the new one has been written, and only then is
 * the previous run's prefix removed.
 */
export type BenchmarkJobPayload = { benchmarkId: string; runId: string; redo?: AnalyzeStage[] };

export type BenchmarkJobOverrides = {
  analyze?: typeof analyzeFilm;
  probe?: typeof probeFilm;
  ffmpeg?: string;
  /** Asked only when the real analyzer will run: a test that replaces it needs no Python. */
  runtime?: typeof checkForensicsRuntime;
};

/**
 * Whether this worker can run the analyzer, asked before a film's analysis
 * rather than discovered twenty minutes into one. A missing runtime is an
 * operator's problem that retrying will not fix, so it fails the job at once
 * with the reason. Remembered once it is yes; a no is asked again next time,
 * so an operator's fix needs no restart.
 */
const analyzerReady = new WeakSet<typeof checkForensicsRuntime>();

async function requireAnalyzer(check: typeof checkForensicsRuntime): Promise<void> {
  if (analyzerReady.has(check)) return;
  const runtime = await check();
  if (!runtime.ok) throw new ForensicsError(`This worker cannot run the forensic analyzer: ${runtime.reason}. Install it with "npm run forensics", then retry the analysis.`, false);
  analyzerReady.add(check);
}

const STAGE_FOR: Record<AnalyzeStage, BenchmarkStageId> = {
  forensics: 'forensics',
  transcription: 'transcription',
  upload: 'upload',
  passes: 'passes',
  compile: 'compile',
  validate: 'integrity',
};

/** Where each stage sits on the job's progress bar. Forensics is most of the work. */
const PROGRESS_AT: Record<BenchmarkStageId, number> = {
  validate: 0.02,
  probe: 0.04,
  forensics: 0.05,
  transcription: 0.62,
  upload: 0.66,
  passes: 0.7,
  compile: 0.95,
  integrity: 0.98,
};

export async function runBenchmarkJob(deps: RunnerDeps, job: Job, signal?: AbortSignal, overrides: BenchmarkJobOverrides = {}): Promise<JobOutcome> {
  const { store } = deps;
  const payload = job.payload as Partial<BenchmarkJobPayload>;
  if (typeof payload.benchmarkId !== 'string' || typeof payload.runId !== 'string') {
    await store.jobs.complete(job.id, 'failed', 'The job names no benchmark or no run.');
    return { status: 'failed', error: 'malformed benchmark job', retryable: false };
  }
  const benchmarkId = payload.benchmarkId;
  const runId = payload.runId;
  const found = await store.benchmarks.get(benchmarkId);
  if (!found) {
    await store.jobs.complete(job.id, 'canceled', 'The benchmark was deleted.');
    return { status: 'skipped', reason: 'benchmark deleted' };
  }
  if (found.analysis.runId !== runId) {
    // An operator asked for a newer analysis since this one was queued.
    await store.jobs.complete(job.id, 'canceled', 'A newer analysis of this film superseded this one.');
    return { status: 'skipped', reason: 'superseded' };
  }

  // Deleting the benchmark mid-run stops the run: its stages have nowhere to go.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let gone = false;
  const change = async (update: (current: Benchmark) => Benchmark): Promise<Benchmark | null> => {
    try {
      return await store.benchmarks.mutate(benchmarkId, update);
    } catch (error) {
      if (toAppError(error).code === 'not_found') {
        gone = true;
        controller.abort();
        return null;
      }
      throw error;
    }
  };
  const stage = (id: BenchmarkStageId, patch: Partial<BenchmarkStage>) =>
    change((current) => ({
      ...current,
      stages: {
        ...current.stages,
        [id]: {
          ...current.stages[id],
          ...patch,
          ...(patch.status === 'running' ? { attempts: current.stages[id].attempts + 1, startedAt: new Date().toISOString(), finishedAt: null, detail: null } : {}),
          ...(patch.status === 'completed' || patch.status === 'failed' || patch.status === 'skipped' ? { finishedAt: new Date().toISOString() } : {}),
        },
      },
    }));
  let lastProgressWrite = 0;
  const progress = async (fraction: number, message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressWrite < 5_000) return;
    lastProgressWrite = now;
    await store.jobs.update(job.id, { progress: Math.max(0, Math.min(1, fraction)), statusMessage: message.slice(0, 240) }).catch(() => undefined);
  };

  const keys = benchmarkKeys(benchmarkId, runId);
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-benchmark-'));
  let current: BenchmarkStageId | null = null;
  try {
    await store.jobs.update(job.id, { state: 'researching', progress: 0.01, statusMessage: 'Fetching the film' });
    const started = await change((benchmark) => ({
      ...benchmark,
      status: 'analyzing',
      analysis: { ...benchmark.analysis, jobId: job.id, startedAt: benchmark.analysis.startedAt ?? new Date().toISOString(), finishedAt: null, deterministic: 'running' },
    }));
    if (!started) return await canceled(deps, job);

    const registry = await deps.buildRegistry({ organizationId: PLATFORM_ORGANIZATION_ID, projectId: null });
    const storage = registry.storage();
    const gemini = registry.videoOrNull();
    const recognizer = safely(() => registry.recognizer());
    const filmPath = path.join(workDir, `source.${started.source.container}`);

    // ——— the analyzer can run here: asked before a gigabyte is fetched for it ———
    const runtime = overrides.runtime ?? (overrides.probe && overrides.analyze ? null : checkForensicsRuntime);
    if (runtime) {
      current = 'probe';
      await requireAnalyzer(runtime);
    }

    // ——— validate: the bytes in storage are the bytes that were uploaded ———
    current = 'validate';
    await stage('validate', { status: 'running' });
    await progress(PROGRESS_AT.validate, 'Fetching and checking the film', true);
    await storage.getToFile(started.source.storageKey, filmPath);
    await verifyFilm(filmPath, started);
    await stage('validate', { status: 'completed', detail: `${started.source.bytes} bytes, SHA-256 and ${started.source.container.toUpperCase()} signature match the upload` });

    // ——— probe: what the container says, shown before the long work starts ———
    current = 'probe';
    await stage('probe', { status: 'running' });
    await progress(PROGRESS_AT.probe, 'Reading the container', true);
    const probe = await (overrides.probe ?? probeFilm)(filmPath, { signal: controller.signal });
    const declared = mediaFromProbe(probe);
    await change((benchmark) => ({ ...benchmark, media: declared }));
    await stage('probe', { status: 'completed', detail: `${declared.width}×${declared.height}, ${declared.frameRate ?? 'unknown'} fps declared, ${declared.audio ? `${declared.audio.codec} ${declared.audio.sampleRate} Hz × ${declared.audio.channels}` : 'no audio'}` });

    if (!gemini) {
      for (const id of ['upload', 'passes'] as const) await stage(id, { status: 'skipped', detail: 'No Gemini key is configured; the film is read by the measurements alone.' });
    }
    if (!probe.audio.length) await stage('transcription', { status: 'skipped', detail: 'The file has no audio stream.' });

    // ——— the reverse compiler, checkpointed under this run ———
    let passesDone = 0;
    const result: AnalyzeResult = await (overrides.analyze ?? analyzeFilm)({
      id: benchmarkId,
      title: started.title,
      filmPath,
      mimeType: started.source.contentType,
      workDir,
      ffmpeg: overrides.ffmpeg ?? (await resolveFfmpeg()),
      checkpoints: storageCheckpoints(storage, keys.checkpoints!),
      filmSha256: started.source.sha256,
      gemini,
      recognizer,
      context: { organizationId: PLATFORM_ORGANIZATION_ID, projectId: null, signal: controller.signal },
      ...(payload.redo?.length ? { redo: payload.redo } : {}),
      onStage: async (name, state, detail) => {
        const id = STAGE_FOR[name];
        current = id;
        if (state === 'started') {
          await stage(id, { status: 'running' });
          await progress(PROGRESS_AT[id], `${BENCHMARK_STAGE_LABELS[id]}…`, true);
        } else if (state === 'completed') {
          await stage(id, { status: 'completed', detail: detail ?? null });
        } else if (state === 'skipped') {
          // Done on an earlier attempt: its checkpoint stands.
          await stage(id, { status: 'completed', detail: 'resumed from its checkpoint' });
        } else {
          await stage(id, { status: 'failed', detail: detail ?? 'failed' });
        }
      },
      onProgress: (name, _fraction, message) => {
        if (name === 'passes') {
          passesDone += 1;
          void progress(PROGRESS_AT.passes + (PROGRESS_AT.compile - PROGRESS_AT.passes) * Math.min(1, passesDone / EXPECTED_PASSES.length), message, true);
        } else {
          void progress(PROGRESS_AT[STAGE_FOR[name]], message);
        }
      },
    });
    if (gone) return await canceled(deps, job);

    // ——— keep the FilmIR, then summarise it onto the record ———
    current = 'integrity';
    const filmIrPath = path.join(workDir, 'FilmIR.json');
    await writeFile(filmIrPath, JSON.stringify(result.document));
    const stored = await storage.putFile(keys.filmIr!, filmIrPath, { contentType: 'application/json', visibility: 'private' });
    await storage.put(keys.validation!, new TextEncoder().encode(JSON.stringify(result.validation, null, 1)), { contentType: 'application/json', visibility: 'private' });

    const summary = summarizeFilmIR(result.document, result.validation);
    const passes = Object.values(result.passes);
    const completedPasses = passes.filter((record) => record.status === 'completed').length;
    const status = result.validation.status === 'READY' ? 'ready' : result.validation.status === 'PARTIAL' ? 'partial' : 'failed';
    const previous = found.analysis.filmIrKey && !found.analysis.filmIrKey.startsWith(`${keys.run}/`) ? found.analysis.filmIrKey : null;
    const finished = await change((benchmark) => ({
      ...benchmark,
      status,
      media: mediaFromDocument(result.document, benchmark.media),
      analysis: {
        ...benchmark.analysis,
        version: analysisVersion(result.document),
        finishedAt: new Date().toISOString(),
        lastAnalyzedAt: new Date().toISOString(),
        deterministic: 'completed',
        gemini: !gemini ? 'skipped' : completedPasses === EXPECTED_PASSES.length ? 'completed' : completedPasses === 0 ? 'failed' : 'partial',
        passesCompleted: completedPasses,
        passesExpected: gemini ? EXPECTED_PASSES.length : 0,
        filmIr: status,
        meanConfidence: summary.meanConfidence,
        knownShare: summary.knownShare,
        evidenceMix: summary.evidenceMix,
        counts: summary.counts,
        warnings: summary.warnings,
        failures: summary.failures,
        costUsd: Math.round(result.costUsd * 1e5) / 1e5,
        filmIrKey: keys.filmIr!,
        validationKey: keys.validation!,
        filmIrBytes: stored.bytes,
      },
    }));
    if (!finished) return await canceled(deps, job);
    if (previous) await removePrefix(storage, previous.replace(/\/FilmIR\.json$/, '')).catch(() => undefined);

    await store.jobs.complete(job.id, 'completed', `FilmIR ${result.validation.status}`);
    return { status: 'completed', result: { benchmarkId, runId, status: result.validation.status } };
  } catch (error) {
    if (gone) return await canceled(deps, job);
    const { app, retryable } = classify(error);
    // A worker shutting down did not fail the film: it goes back in the queue at once.
    const retryAt = signal?.aborted
      ? new Date().toISOString()
      : retryable && job.attempts < job.maxAttempts
        ? new Date(Date.now() + retryDelayMs(job.attempts)).toISOString()
        : null;
    if (current) await stage(current, { status: 'failed', detail: app.message.slice(0, 600) }).catch(() => undefined);
    await change((benchmark) => ({
      ...benchmark,
      // Queued while the queue will try again; failed once it will not.
      status: retryAt ? 'queued' : 'failed',
      analysis: {
        ...benchmark.analysis,
        deterministic: benchmark.stages.forensics.status === 'completed' ? 'completed' : retryAt ? benchmark.analysis.deterministic : 'failed',
        failures: [`${current ? BENCHMARK_STAGE_LABELS[current] : 'Analysis'}: ${app.message}`.slice(0, 400), ...benchmark.analysis.failures].slice(0, 40),
        finishedAt: retryAt ? null : new Date().toISOString(),
      },
    })).catch(() => undefined);
    await store.jobs.fail(job.id, app.message, retryAt, app.code);
    return { status: 'failed', error: app.message, retryable: Boolean(retryAt) };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function canceled(deps: RunnerDeps, job: Job): Promise<JobOutcome> {
  await deps.store.jobs.complete(job.id, 'canceled', 'The benchmark was deleted while it was being analysed.').catch(() => undefined);
  return { status: 'skipped', reason: 'benchmark deleted' };
}

/**
 * The file in storage is the file that was uploaded: same length, same
 * digest, and still a film by its own first bytes. Anything else is a
 * corrupted or replaced object, and analysing it would describe some other
 * film under this one's name.
 */
async function verifyFilm(filmPath: string, benchmark: Benchmark): Promise<void> {
  const size = (await stat(filmPath)).size;
  if (size !== benchmark.source.bytes) {
    throw new AppError('validation_failed', `The stored film is ${size} bytes; ${benchmark.source.bytes} were uploaded.`);
  }
  const handle = await open(filmPath, 'r');
  try {
    const head = new Uint8Array(64);
    await handle.read(head, 0, 64, 0);
    if (sniffContainer(head) !== benchmark.source.container) {
      throw new AppError('validation_failed', `The stored file is not the ${benchmark.source.container.toUpperCase()} film that was uploaded.`);
    }
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filmPath)) hash.update(chunk as Buffer);
  const digest = hash.digest('hex');
  if (digest !== benchmark.source.sha256) {
    throw new AppError('validation_failed', `The stored film's SHA-256 is ${digest.slice(0, 12)}…, not the ${benchmark.source.sha256.slice(0, 12)}… that was uploaded.`);
  }
}

/** The analyzer's own errors say whether trying again can help; everything else is judged as the runner judges it. */
function classify(error: unknown): { app: AppError; retryable: boolean } {
  if (error instanceof ForensicsError) {
    return { app: new AppError(error.retryable ? 'internal' : 'validation_failed', error.message), retryable: error.retryable };
  }
  const app = toAppError(error);
  return { app, retryable: !['validation_failed', 'forbidden', 'unsafe_operation', 'not_found', 'conflict', 'entitlement_required'].includes(app.code) };
}

function safely<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

async function removePrefix(storage: { list(prefix: string): Promise<string[]>; delete(key: string): Promise<void> }, prefix: string): Promise<void> {
  for (const key of await storage.list(prefix)) await storage.delete(key);
}

