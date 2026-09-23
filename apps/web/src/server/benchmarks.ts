import 'server-only';
import { createHash } from 'node:crypto';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  BENCHMARK_CONTENT_TYPES,
  Benchmark,
  PLATFORM_ORGANIZATION_ID,
  benchmarkBusy,
  benchmarkKeys,
  cleanFileName,
  freshStages,
  newId,
  sniffContainer,
  titleFromFileName,
  type BenchmarkRetrieval,
  type Job,
} from '@act-one/core';
import type { BenchmarkQuery } from '@act-one/db';
import type { FilmIR, ValidationReport } from '@act-one/film-ir';
import { getStorage } from './assets.ts';
import { getStore } from './store.ts';

/**
 * The Benchmark Library, for the console.
 *
 * Everything here is staff-only and the callers check that first; nothing in
 * this module is reachable by a customer. Films arrive as a stream and are
 * never held in memory whole, are identified by their own bytes rather than
 * their names, and are stored once however many times they are uploaded.
 * Analysis is only ever asked for here and done by the worker.
 */

/** The Gemini Files API accepts up to 2 GB; a film the model cannot watch is not worth storing. */
export const MAX_BENCHMARK_BYTES = Number(process.env.ACT_ONE_BENCHMARK_MAX_BYTES ?? 2 * 1024 ** 3);

export type UploadInput = {
  body: ReadableStream<Uint8Array> | null;
  declaredBytes: number | null;
  fileName: string;
  title: string | null;
  origin: string | null;
  rights: string | null;
  analyze: boolean;
  userId: string;
};

export type UploadResult = { benchmark: Benchmark; duplicate: boolean };

export async function receiveBenchmarkUpload(input: UploadInput): Promise<UploadResult> {
  if (!input.body) throw new AppError('validation_failed', 'No film was sent.', { status: 400 });
  if (input.declaredBytes !== null && input.declaredBytes > MAX_BENCHMARK_BYTES) {
    throw new AppError('validation_failed', `Films are limited to ${formatBytes(MAX_BENCHMARK_BYTES)}.`, { status: 413 });
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'act-one-upload-'));
  const file = path.join(dir, 'film');
  try {
    const { bytes, sha256, head } = await receiveToFile(input.body, file, MAX_BENCHMARK_BYTES);
    if (bytes === 0) throw new AppError('validation_failed', 'The file is empty.', { status: 400 });
    const container = sniffContainer(head);
    if (!container) {
      throw new AppError('validation_failed', 'That file is not an MP4, MOV, WebM or Matroska film.', { status: 415 });
    }
    const store = getStore();
    const existing = await store.benchmarks.getBySha256(sha256);
    if (existing) return { benchmark: existing, duplicate: true };

    const id = newId('bmk');
    const key = benchmarkKeys(id).source(container);
    const storage = await getStorage();
    await storage.putFile(key, file, { contentType: BENCHMARK_CONTENT_TYPES[container], visibility: 'private' });
    const now = new Date().toISOString();
    const fileName = cleanFileName(input.fileName || `film.${container}`);
    const benchmark = Benchmark.parse({
      id,
      title: (input.title?.trim() || titleFromFileName(fileName)).slice(0, 200),
      status: 'uploaded',
      source: {
        storageKey: key,
        fileName,
        bytes,
        sha256,
        contentType: BENCHMARK_CONTENT_TYPES[container],
        container,
        uploadedByUserId: input.userId,
        uploadedAt: now,
        origin: input.origin?.trim().slice(0, 500) || null,
        rights: input.rights?.trim().slice(0, 500) || null,
      },
      stages: freshStages(),
      analysis: {},
      createdAt: now,
      updatedAt: now,
    });
    try {
      await store.benchmarks.create(benchmark);
    } catch (error) {
      // The same film, uploaded twice at once: the other upload's record stands.
      if (error instanceof AppError && error.code === 'conflict') {
        await storage.delete(key).catch(() => undefined);
        const winner = await store.benchmarks.getBySha256(sha256);
        if (winner) return { benchmark: winner, duplicate: true };
      }
      throw error;
    }
    record(input.userId, 'benchmark.uploaded', `Uploaded "${benchmark.title}" to the benchmark library`, { benchmarkId: id, bytes, container });
    const final = input.analyze ? await requestBenchmarkAnalysis(id, 'new', input.userId) : benchmark;
    return { benchmark: final, duplicate: false };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * The request body to a file, hashed as it arrives, cut off the moment it
 * passes the limit — whatever the Content-Length claimed.
 */
async function receiveToFile(body: ReadableStream<Uint8Array>, file: string, limit: number): Promise<{ bytes: number; sha256: string; head: Uint8Array }> {
  const handle = await open(file, 'w');
  const hash = createHash('sha256');
  const head = new Uint8Array(64);
  let headLength = 0;
  let bytes = 0;
  try {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw new AppError('validation_failed', `Films are limited to ${formatBytes(limit)}.`, { status: 413 });
      if (headLength < head.length) {
        const take = Math.min(head.length - headLength, chunk.byteLength);
        head.set(chunk.subarray(0, take), headLength);
        headLength += take;
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return { bytes, sha256: hash.digest('hex'), head: head.subarray(0, headLength) };
}

export type AnalysisMode = 'new' | 'resume';

/**
 * Queue an analysis.
 *
 * `new` starts a fresh run — first analysis or re-analysis — with its own
 * checkpoints; the last complete FilmIR stays until the new one replaces it.
 * `resume` retries the current run from its first unfinished stage. Never
 * two at once: a film already queued or being analysed is left alone.
 */
export async function requestBenchmarkAnalysis(id: string, mode: AnalysisMode, actorUserId: string): Promise<Benchmark> {
  const store = getStore();
  const current = await store.benchmarks.get(id);
  if (!current) throw new AppError('not_found', 'That benchmark is not in the library.');
  if (benchmarkBusy(current)) throw new AppError('conflict', 'This film is already queued or being analysed.');
  if (mode === 'resume' && !current.analysis.runId) throw new AppError('conflict', 'There is no analysis to resume; start one.');

  const runId = mode === 'new' ? newId('bmr') : current.analysis.runId!;
  const now = new Date().toISOString();
  const jobId = newId('job');
  const updated = await store.benchmarks.mutate(id, (benchmark) => {
    if (benchmarkBusy(benchmark)) throw new AppError('conflict', 'This film is already queued or being analysed.');
    const stages = mode === 'new'
      ? freshStages()
      : Object.fromEntries(Object.entries(benchmark.stages).map(([stage, state]) => [stage, state.status === 'failed' ? { ...state, status: 'pending' as const } : state])) as Benchmark['stages'];
    return {
      ...benchmark,
      status: 'queued',
      stages,
      analysis: {
        ...benchmark.analysis,
        runId,
        jobId,
        requestedAt: now,
        ...(mode === 'new' ? { startedAt: null, finishedAt: null, deterministic: 'pending' as const, gemini: 'pending' as const, passesCompleted: 0, failures: [], warnings: [] } : { failures: [] }),
      },
    };
  });
  const job: Job = {
    id: jobId,
    organizationId: PLATFORM_ORGANIZATION_ID,
    projectId: null,
    kind: 'analyze_benchmark',
    state: 'queued',
    payload: { benchmarkId: id, runId },
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
    // Below every customer's work: a reference film can wait, a customer's film cannot.
    priority: -10,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await store.jobs.enqueue(job);
  } catch (error) {
    // A film marked queued with no job behind it would wait forever: put it back as it was.
    await store.benchmarks.mutate(id, (benchmark) => ({ ...benchmark, status: current.status, stages: current.stages, analysis: current.analysis })).catch(() => undefined);
    throw error;
  }
  record(actorUserId, mode === 'new' ? 'benchmark.analysis_requested' : 'benchmark.analysis_resumed', `${mode === 'new' ? 'Queued an analysis of' : 'Resumed the analysis of'} "${updated.title}"`, { benchmarkId: id, runId, jobId });
  return updated;
}

/**
 * Every film uploaded and never analysed, queued at once: the library's
 * "analyse everything" after one film has been checked by hand.
 *
 * The ids are gathered before anything is queued. Queuing a film takes it out
 * of the "uploaded" list, so paging through that list while queuing would
 * skip a page for every page queued.
 */
export async function analyzeAllUnanalyzed(actorUserId: string): Promise<{ queued: number; failed: number }> {
  const store = getStore();
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await store.benchmarks.list({ status: 'uploaded', limit: 200, offset });
    ids.push(...page.map((benchmark) => benchmark.id));
    if (page.length < 200) break;
  }
  let queued = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await requestBenchmarkAnalysis(id, 'new', actorUserId);
      queued += 1;
    } catch (error) {
      // Another operator queued or deleted it meanwhile; anything else is worth a line in the log.
      if (!(error instanceof AppError && (error.code === 'conflict' || error.code === 'not_found'))) {
        failed += 1;
        console.error(`[benchmarks] could not queue ${id}:`, error);
      }
    }
  }
  return { queued, failed };
}

export async function setBenchmarkRetrieval(id: string, retrieval: BenchmarkRetrieval, actorUserId: string): Promise<Benchmark> {
  const updated = await getStore().benchmarks.mutate(id, (benchmark) => ({ ...benchmark, retrieval }));
  record(actorUserId, 'benchmark.retrieval', `${retrieval === 'enabled' ? 'Enabled' : 'Disabled'} retrieval of "${updated.title}"`, { benchmarkId: id, retrieval });
  return updated;
}

export async function updateBenchmarkDetails(id: string, details: { title: string; origin: string; rights: string; notes: string }, actorUserId: string): Promise<Benchmark> {
  const title = details.title.trim();
  if (!title) throw new AppError('validation_failed', 'A benchmark needs a title.');
  const updated = await getStore().benchmarks.mutate(id, (benchmark) => ({
    ...benchmark,
    title: title.slice(0, 200),
    notes: details.notes.slice(0, 4000),
    source: { ...benchmark.source, origin: details.origin.trim().slice(0, 500) || null, rights: details.rights.trim().slice(0, 500) || null },
  }));
  record(actorUserId, 'benchmark.edited', `Edited "${updated.title}"`, { benchmarkId: id });
  return updated;
}

/**
 * Remove a film and everything made from it.
 *
 * A queued analysis is cancelled; one already running finds its benchmark
 * gone at its next stage and stops. The files go first, so a failure leaves
 * a record pointing at nothing rather than files nothing points at.
 */
export async function deleteBenchmark(id: string, actorUserId: string): Promise<void> {
  const store = getStore();
  const benchmark = await store.benchmarks.get(id);
  if (!benchmark) return;
  if (benchmark.analysis.jobId) {
    const job = await store.jobs.get(PLATFORM_ORGANIZATION_ID, benchmark.analysis.jobId);
    if (job && job.state === 'queued' && !job.lockedBy) await store.jobs.complete(job.id, 'canceled', 'The benchmark was deleted.');
  }
  const storage = await getStorage();
  for (const key of await storage.list(benchmarkKeys(id).root)) await storage.delete(key);
  await store.benchmarks.delete(id);
  record(actorUserId, 'benchmark.deleted', `Deleted "${benchmark.title}" and its files`, { benchmarkId: id, sha256: benchmark.source.sha256 });
}

export async function listBenchmarks(query: BenchmarkQuery): Promise<{ benchmarks: Benchmark[]; total: number; counts: Record<string, number> }> {
  const store = getStore();
  const { limit: _limit, offset: _offset, ...filters } = query;
  const [benchmarks, total, counts] = await Promise.all([store.benchmarks.list(query), store.benchmarks.count(filters), store.benchmarks.countByStatus()]);
  return { benchmarks, total, counts };
}

export async function getBenchmark(id: string): Promise<Benchmark | null> {
  return getStore().benchmarks.get(id);
}

/**
 * The FilmIR, parsed once and kept for a minute.
 *
 * A reference film's FilmIR runs to tens of megabytes, and the inspector
 * renders one view of it per request; reading and parsing it for every tab an
 * operator opens would be most of the page's time.
 */
const documents = new Map<string, { at: number; document: Promise<FilmIR | null> }>();

export async function readFilmIr(benchmark: Benchmark): Promise<FilmIR | null> {
  const key = benchmark.analysis.filmIrKey;
  if (!key) return null;
  const cached = documents.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.document;
  // The promise is what is kept, so two tabs opened at once parse the document once.
  const document = loadFilmIr(key);
  documents.set(key, { at: Date.now(), document });
  document.then(
    (loaded) => loaded === null && documents.delete(key),
    () => documents.delete(key),
  );
  // Two documents at most — a parsed reference film holds about a hundred
  // megabytes: an inspector compares, it does not browse the library in memory.
  while (documents.size > 2) documents.delete(documents.keys().next().value!);
  return document;
}

async function loadFilmIr(key: string): Promise<FilmIR | null> {
  const storage = await getStorage();
  if (!(await storage.exists(key))) return null;
  return JSON.parse(new TextDecoder().decode(await storage.get(key))) as FilmIR;
}

export async function readValidation(benchmark: Benchmark): Promise<ValidationReport | null> {
  const key = benchmark.analysis.validationKey;
  if (!key) return null;
  const storage = await getStorage();
  if (!(await storage.exists(key))) return null;
  return JSON.parse(new TextDecoder().decode(await storage.get(key))) as ValidationReport;
}

function record(actorUserId: string, event: string, message: string, detail: Record<string, unknown>): void {
  getStore().log.recordSafely({
    level: 'info',
    source: 'admin',
    event,
    message,
    organizationId: null,
    projectId: null,
    jobId: null,
    actorUserId,
    durationMs: null,
    detail,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
