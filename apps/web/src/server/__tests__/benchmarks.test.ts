import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, PLATFORM_ORGANIZATION_ID, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp } from '../auth.ts';
import { getStorage } from '../assets.ts';
import { deleteBenchmark, requestBenchmarkAnalysis, setBenchmarkRetrieval } from '../benchmarks.ts';
import { POST as upload } from '../../app/api/admin/benchmarks/route.ts';
import { GET as downloadFilmIr } from '../../app/api/admin/benchmarks/[id]/film-ir/route.ts';

/**
 * The Benchmark Library's doors: only staff come in, only films are taken,
 * each film is kept once, and every analysis is asked for exactly once.
 */
let store: MemoryStore;

const MP4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom'), 0, 0, 2, 0, ...Array.from({ length: 70_000 }, (_, i) => i % 251)]);

async function person(name: string) {
  resetRequest();
  request().headers.set('x-forwarded-for', `198.51.100.${Math.floor(Math.random() * 200) + 1}`);
  return signUp({ email: `${name}-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name });
}

function send(bytes: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Several chunks, as a network delivers them.
      for (let i = 0; i < bytes.length; i += 16_384) controller.enqueue(bytes.subarray(i, i + 16_384));
      controller.close();
    },
  });
  return upload(new Request('http://console.test/api/admin/benchmarks', {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { 'content-type': 'video/mp4', host: 'console.test', 'x-file-name': encodeURIComponent('Plasma 5.25 — launch.mp4'), ...headers },
  } as RequestInit & { duplex: 'half' }));
}

beforeAll(async () => {
  process.env.ACT_ONE_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), 'act-one-benchmarks-'));
});

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('uploading a benchmark', () => {
  it('takes a film from staff, streamed, and keeps it under its own bytes', async () => {
    await person('ada');
    const response = await send(MP4, { 'x-benchmark-origin': encodeURIComponent('https://tube.kockatoo.org/w/6a0a27a4'), 'x-benchmark-rights': encodeURIComponent('CC BY-SA 4.0') });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; duplicate: boolean };
    const film = (await store.benchmarks.get(body.id))!;
    expect(film).toMatchObject({
      title: 'Plasma 5.25 — launch',
      status: 'uploaded',
      source: { container: 'mp4', bytes: MP4.byteLength, sha256: createHash('sha256').update(MP4).digest('hex'), uploadedByUserId: expect.stringMatching(/^usr_/), origin: 'https://tube.kockatoo.org/w/6a0a27a4', rights: 'CC BY-SA 4.0', fileName: 'Plasma 5.25 — launch.mp4' },
    });
    const storage = await getStorage();
    expect(new Uint8Array(await storage.get(film.source.storageKey))).toEqual(MP4);

    // The same bytes again: the first film, not a second copy.
    const again = await send(MP4);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: body.id, duplicate: true });
    expect(await store.benchmarks.count()).toBe(1);
  });

  it('refuses what is not a film, whatever it is called', async () => {
    await person('ada');
    const response = await send(new TextEncoder().encode('<html><body>not a film</body></html>'), { 'x-file-name': 'launch.mp4' });
    expect(response.status).toBe(415);
    expect(await store.benchmarks.count()).toBe(0);
  });

  it('refuses a film larger than the limit before reading it', async () => {
    await person('ada');
    const response = await send(MP4, { 'content-length': String(3 * 1024 ** 3) });
    expect(response.status).toBe(413);
  });

  it('refuses a request another site sent, and does not exist for a customer', async () => {
    await person('ada');
    expect((await send(MP4, { origin: 'https://evil.example' })).status).toBe(403);
    await person('bob');
    expect((await send(MP4)).status).toBe(404);
    expect(await store.benchmarks.count()).toBe(0);
  });
});

describe('asking for an analysis', () => {
  async function uploaded() {
    const admin = await person('ada');
    const { id } = (await (await send(MP4)).json()) as { id: string };
    return { admin, id };
  }

  it('queues one platform job with a fresh run, and refuses a second while it waits', async () => {
    const { admin, id } = await uploaded();
    const queued = await requestBenchmarkAnalysis(id, 'new', admin.user.id);
    expect(queued.status).toBe('queued');
    const job = (await store.jobs.get(PLATFORM_ORGANIZATION_ID, queued.analysis.jobId!))!;
    expect(job).toMatchObject({ kind: 'analyze_benchmark', projectId: null, payload: { benchmarkId: id, runId: queued.analysis.runId }, priority: -10 });
    await expect(requestBenchmarkAnalysis(id, 'new', admin.user.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('resumes a failed run under the same run id, and starts over under a new one', async () => {
    const { admin, id } = await uploaded();
    await expect(requestBenchmarkAnalysis(id, 'resume', admin.user.id)).rejects.toMatchObject({ code: 'conflict' });
    const first = await requestBenchmarkAnalysis(id, 'new', admin.user.id);
    await store.benchmarks.mutate(id, (film) => ({ ...film, status: 'failed', stages: { ...film.stages, forensics: { ...film.stages.forensics, status: 'failed', detail: 'out of memory' } } }));
    const resumed = await requestBenchmarkAnalysis(id, 'resume', admin.user.id);
    expect(resumed.analysis.runId).toBe(first.analysis.runId);
    expect(resumed.stages.forensics.status).toBe('pending');
    await store.benchmarks.mutate(id, (film) => ({ ...film, status: 'ready' }));
    const fresh = await requestBenchmarkAnalysis(id, 'new', admin.user.id);
    expect(fresh.analysis.runId).not.toBe(first.analysis.runId);
  });

  it('switches retrieval off and on', async () => {
    const { admin, id } = await uploaded();
    expect((await setBenchmarkRetrieval(id, 'disabled', admin.user.id)).retrieval).toBe('disabled');
    expect((await setBenchmarkRetrieval(id, 'enabled', admin.user.id)).retrieval).toBe('enabled');
  });
});

describe('deleting and downloading', () => {
  it('removes the film, its files and a queued analysis', async () => {
    const admin = await person('ada');
    const { id } = (await (await send(MP4)).json()) as { id: string };
    const queued = await requestBenchmarkAnalysis(id, 'new', admin.user.id);
    const storage = await getStorage();
    const key = `platform/benchmarks/${id}/runs/${queued.analysis.runId}/FilmIR.json`;
    await storage.put(key, new TextEncoder().encode('{}'));
    await deleteBenchmark(id, admin.user.id);
    expect(await store.benchmarks.get(id)).toBeNull();
    expect(await storage.list(`platform/benchmarks/${id}`)).toEqual([]);
    expect((await store.jobs.get(PLATFORM_ORGANIZATION_ID, queued.analysis.jobId!))?.state).toBe('canceled');
  });

  it('downloads a FilmIR as an attachment, and nothing where there is none', async () => {
    await person('ada');
    const { id } = (await (await send(MP4)).json()) as { id: string };
    const params = { params: Promise.resolve({ id }) };
    expect((await downloadFilmIr(new Request(`http://console.test/api/admin/benchmarks/${id}/film-ir`), params)).status).toBe(404);

    const storage = await getStorage();
    const key = `platform/benchmarks/${id}/runs/bmr_test/FilmIR.json`;
    await storage.put(key, new TextEncoder().encode('{"schema":"actone.film-ir"}'));
    await store.benchmarks.mutate(id, (film) => ({ ...film, status: 'ready', analysis: { ...film.analysis, filmIrKey: key } }));
    const response = await downloadFilmIr(new Request(`http://console.test/api/admin/benchmarks/${id}/film-ir`), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="bmk_[a-z0-9]+\.json"; filename\*=UTF-8''Plasma-5-25-launch\.film-ir\.json$/);
    expect(await response.json()).toEqual({ schema: 'actone.film-ir' });
  });

  it('is not a door for a customer either', async () => {
    await person('ada');
    const { id } = (await (await send(MP4)).json()) as { id: string };
    await person('bob');
    const response = await downloadFilmIr(new Request(`http://console.test/api/admin/benchmarks/${id}/film-ir`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(404);
    void AppError;
  });
});
