import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Benchmark, PLATFORM_ORGANIZATION_ID, benchmarkKeys, freshStages, newId, type Job } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { compileFilmIR, ForensicReport, ForensicsError, validateFilmIR, type AnalyzeOptions, type AnalyzeResult } from '@act-one/film-ir';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
import { runBenchmarkJob } from '../benchmark.ts';
import { runJob } from '../runner.ts';

/**
 * The benchmark job end to end on the in-memory store and local storage, with
 * the reverse compiler stood in for by one that plays back the synthetic
 * film's real report — so what is tested is the job: fetching, verifying,
 * mirroring stages, storing the FilmIR, retrying and giving up.
 */
const fixture = ForensicReport.parse(JSON.parse(await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../film-ir/src/__tests__/fixtures/synthetic-report.json'), 'utf8')));
// A real MP4 header, then filler: the job checks bytes and signature, never decodes (the analyzer is stood in for).
const FILM = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom'), 0, 0, 2, 0, ...new Array(4000).fill(7)]);

async function setup() {
  const store = new MemoryStore();
  const storage = new LocalFsStorageProvider({ root: await mkdtemp(path.join(tmpdir(), 'act-one-bench-store-')) });
  const registry = new ProviderRegistry({ overrides: { storage, video: null, recognizer: undefined as never } });
  const deps = { store, workerId: 'test-worker', buildRegistry: async () => registry };
  const id = newId('bmk');
  const runId = newId('bmr');
  const key = benchmarkKeys(id).source('mp4');
  const scratch = await mkdtemp(path.join(tmpdir(), 'act-one-bench-film-'));
  await writeFile(path.join(scratch, 'film.mp4'), FILM);
  await storage.putFile(key, path.join(scratch, 'film.mp4'), { contentType: 'video/mp4' });
  const now = new Date().toISOString();
  const benchmark = await store.benchmarks.create(Benchmark.parse({
    id,
    title: 'Synthetic',
    status: 'queued',
    source: {
      storageKey: key,
      fileName: 'film.mp4',
      bytes: FILM.byteLength,
      sha256: createHash('sha256').update(FILM).digest('hex'),
      contentType: 'video/mp4',
      container: 'mp4',
      uploadedByUserId: null,
      uploadedAt: now,
    },
    stages: freshStages(),
    analysis: { runId },
    createdAt: now,
    updatedAt: now,
  }));
  return { store, storage, deps, benchmark, runId };
}

function job(benchmarkId: string, runId: string, over: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: newId('job'), organizationId: PLATFORM_ORGANIZATION_ID, projectId: null, kind: 'analyze_benchmark', state: 'queued',
    payload: { benchmarkId, runId }, progress: 0, statusMessage: '', attempts: 1, maxAttempts: 3, lastError: null, lastErrorCode: null,
    runAfter: now, lockedBy: 'test-worker', lockedAt: now, startedAt: now, priority: 0, createdAt: now, updatedAt: now, ...over,
  };
}

const probe = async () => fixture.probe;

/** Plays back the synthetic film's report through the real compiler and validator, reporting stages as the real one does. */
function playback(options: { failAt?: 'forensics' | 'compile'; retryable?: boolean } = {}) {
  const seen: AnalyzeOptions[] = [];
  const analyze = async (input: AnalyzeOptions): Promise<AnalyzeResult> => {
    seen.push(input);
    await input.onStage?.('forensics', 'started');
    if (options.failAt === 'forensics') {
      await input.onStage?.('forensics', 'failed', 'The analyzer stopped (exit 1)');
      throw new ForensicsError('The analyzer stopped (exit 1): out of memory', options.retryable ?? true);
    }
    await input.checkpoints.put('forensics', { ok: true });
    await input.onStage?.('forensics', 'completed');
    await input.onStage?.('compile', 'started');
    const document = compileFilmIR({ id: input.id, title: input.title, report: fixture }).document;
    await input.onStage?.('compile', 'completed');
    const { report: validation } = validateFilmIR(document);
    await input.onStage?.('validate', 'completed', validation.status);
    return { document: { ...document, validation }, validation, passes: {}, costUsd: 0 };
  };
  return { analyze, seen };
}

describe('the benchmark job', () => {
  it('checks the film, mirrors every stage and keeps the FilmIR beside it', async () => {
    const { store, storage, deps, benchmark, runId } = await setup();
    const { analyze, seen } = playback();
    const fresh = job(benchmark.id, runId);
    await store.jobs.enqueue(fresh);
    const done = await runBenchmarkJob(deps, fresh, undefined, { analyze, probe, ffmpeg: 'ffmpeg' });
    expect(done).toMatchObject({ status: 'completed', result: { status: 'READY' } });

    const after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.status).toBe('ready');
    expect(after.stages.validate).toMatchObject({ status: 'completed', attempts: 1 });
    expect(after.stages.probe.status).toBe('completed');
    expect(after.stages.forensics.status).toBe('completed');
    expect(after.stages.integrity).toMatchObject({ status: 'completed', detail: 'READY' });
    // No Gemini key: the model's stages say so rather than sitting pending.
    expect(after.stages.passes).toMatchObject({ status: 'skipped', detail: expect.stringMatching(/No Gemini key/) });
    expect(after.media).toMatchObject({ width: 320, height: 180, frameRate: '25/1', frameRateSource: 'measured', frameCount: 100, variableFrameRate: false });
    expect(after.analysis).toMatchObject({ filmIr: 'ready', gemini: 'skipped', deterministic: 'completed', counts: { shots: 3, boundaries: 2, textBlocks: 2 } });
    expect(after.analysis.knownShare).toBeGreaterThan(0.5);
    expect(after.analysis.version).toMatch(/actone\.film-ir 1\.0 · forensics 1\.2\.0/);
    expect(seen[0]!.checkpoints).toBeDefined();
    const stored = JSON.parse(new TextDecoder().decode(await storage.get(benchmarkKeys(benchmark.id, runId).filmIr!)));
    expect(stored.schema).toBe('actone.film-ir');
    expect(await storage.exists(`${benchmarkKeys(benchmark.id, runId).checkpoints}/forensics.json`)).toBe(true);
    expect((await store.jobs.get(PLATFORM_ORGANIZATION_ID, fresh.id))?.state).toBe('completed');
  });

  it('refuses a film whose stored bytes are not the ones uploaded, and does not retry', async () => {
    const { store, storage, deps, benchmark, runId } = await setup();
    const tampered = new Uint8Array(FILM);
    tampered[FILM.byteLength - 1] = 9;
    await storage.put(benchmark.source.storageKey, tampered);
    const queued = job(benchmark.id, runId);
    await store.jobs.enqueue(queued);
    const outcome = await runBenchmarkJob(deps, queued, undefined, { ...playback(), probe, ffmpeg: 'ffmpeg' });
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    const after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.status).toBe('failed');
    expect(after.stages.validate).toMatchObject({ status: 'failed', detail: expect.stringMatching(/SHA-256/) });
    expect(after.analysis.failures[0]).toMatch(/^File validation: /);
  });

  it('puts a film back in the queue after a transient failure, and resumes under the same run', async () => {
    const { store, deps, benchmark, runId } = await setup();
    const first = job(benchmark.id, runId);
    await store.jobs.enqueue(first);
    const failed = await runBenchmarkJob(deps, first, undefined, { ...playback({ failAt: 'forensics', retryable: true }), probe, ffmpeg: 'ffmpeg' });
    expect(failed).toMatchObject({ status: 'failed', retryable: true });
    let after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.status).toBe('queued');
    expect(after.stages.forensics.status).toBe('failed');
    expect((await store.jobs.get(PLATFORM_ORGANIZATION_ID, first.id))?.lastError).toMatch(/out of memory/);

    const { analyze, seen } = playback();
    const second = job(benchmark.id, runId, { attempts: 2 });
    await store.jobs.enqueue(second);
    await runBenchmarkJob(deps, second, undefined, { analyze, probe, ffmpeg: 'ffmpeg' });
    after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.status).toBe('ready');
    expect(after.stages.forensics).toMatchObject({ status: 'completed', attempts: 2 });
    expect(seen).toHaveLength(1);
  });

  it('gives up for good when the analyzer says the file cannot be read', async () => {
    const { store, deps, benchmark, runId } = await setup();
    const queued = job(benchmark.id, runId);
    await store.jobs.enqueue(queued);
    const outcome = await runBenchmarkJob(deps, queued, undefined, { ...playback({ failAt: 'forensics', retryable: false }), probe, ffmpeg: 'ffmpeg' });
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    expect((await store.benchmarks.get(benchmark.id))!.status).toBe('failed');
  });

  it('fails at once, before fetching the film, when this worker cannot run the analyzer', async () => {
    const { store, deps, benchmark, runId } = await setup();
    const queued = job(benchmark.id, runId);
    await store.jobs.enqueue(queued);
    const { analyze, seen } = playback();
    const runtime = async () => ({ ok: false as const, reason: 'the analyzer\'s Python module "cv2" is not installed' });
    const outcome = await runBenchmarkJob(deps, queued, undefined, { analyze, probe, ffmpeg: 'ffmpeg', runtime });
    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    const after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.status).toBe('failed');
    expect(after.stages.probe).toMatchObject({ status: 'failed', detail: expect.stringMatching(/cannot run the forensic analyzer: .*"cv2".*npm run forensics/) });
    expect(after.stages.validate.status).toBe('pending');
    expect(seen).toHaveLength(0);
  });

  it('is what the runner does with a platform job, which has no project to load', async () => {
    const { store, deps, benchmark, runId } = await setup();
    await store.benchmarks.delete(benchmark.id);
    const queued = job(benchmark.id, runId);
    await store.jobs.enqueue(queued);
    expect(await runJob(deps, queued)).toEqual({ status: 'skipped', reason: 'benchmark deleted' });
  });

  it('stands down when a newer analysis has been asked for, or the film is gone', async () => {
    const { store, deps, benchmark, runId } = await setup();
    const stale = job(benchmark.id, newId('bmr'));
    await store.jobs.enqueue(stale);
    expect(await runBenchmarkJob(deps, stale, undefined, { ...playback(), probe })).toEqual({ status: 'skipped', reason: 'superseded' });

    await store.benchmarks.delete(benchmark.id);
    const orphan = job(benchmark.id, runId);
    await store.jobs.enqueue(orphan);
    expect(await runBenchmarkJob(deps, orphan, undefined, { ...playback(), probe })).toEqual({ status: 'skipped', reason: 'benchmark deleted' });
    expect((await store.jobs.get(PLATFORM_ORGANIZATION_ID, orphan.id))?.state).toBe('canceled');
  });

  it('keeps the previous FilmIR until the new one is written, then removes the old run', async () => {
    const { store, storage, deps, benchmark, runId } = await setup();
    const first = job(benchmark.id, runId);
    await store.jobs.enqueue(first);
    await runBenchmarkJob(deps, first, undefined, { ...playback(), probe, ffmpeg: 'ffmpeg' });
    const oldKey = benchmarkKeys(benchmark.id, runId).filmIr!;
    expect(await storage.exists(oldKey)).toBe(true);

    const nextRun = newId('bmr');
    await store.benchmarks.mutate(benchmark.id, (current) => ({ ...current, status: 'queued', analysis: { ...current.analysis, runId: nextRun } }));
    // While the new run works, the library still points at the old FilmIR.
    expect((await store.benchmarks.get(benchmark.id))!.analysis.filmIrKey).toBe(oldKey);
    const second = job(benchmark.id, nextRun);
    await store.jobs.enqueue(second);
    await runBenchmarkJob(deps, second, undefined, { ...playback(), probe, ffmpeg: 'ffmpeg' });
    const after = (await store.benchmarks.get(benchmark.id))!;
    expect(after.analysis.filmIrKey).toBe(benchmarkKeys(benchmark.id, nextRun).filmIr);
    expect(await storage.exists(oldKey)).toBe(false);
    expect(await storage.exists(after.analysis.filmIrKey!)).toBe(true);
  });
});
