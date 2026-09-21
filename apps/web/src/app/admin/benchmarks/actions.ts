'use server';

import { revalidatePath } from 'next/cache';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BenchmarkFilm, newId } from '@act-one/core';
import { analyseBenchmark } from '@act-one/qa';
import { requireSuperAdmin } from '@/server/auth.ts';
import { getStorage } from '@/server/assets.ts';
import { getStore } from '@/server/store.ts';
import { buildRegistry } from '@/server/platform.ts';
import { reportError } from '@/server/report.ts';
import type { ActionResult } from '../actions.ts';

/**
 * The reference corpus, for staff.
 *
 * Upload a film, keep the original forever, analyse it twice, and say plainly
 * what came back. The analysis runs inline rather than through the job queue:
 * it is a staff action on a handful of files, an operator watching the page
 * wants the answer now, and adding a queue hop would mean a second place where
 * a failure can be swallowed. If the corpus ever grows to the point where this
 * is the wrong trade, the analyser is already a pure function and moves.
 */

const MAX_BYTES = 512 * 1024 * 1024;
const ALLOWED = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);

/**
 * Runs both readings and writes the result, whatever it is.
 *
 * Shared by upload and re-analyse, because a re-analysis that behaved even
 * slightly differently from the first pass would make "press retry" an
 * unreliable answer to a partial film — which is the one thing retry is for.
 */
async function analyseInto(filmId: string): Promise<void> {
  const store = getStore();
  const film = await store.benchmarkFilms.get(filmId);
  if (!film) return;

  await store.benchmarkFilms.update(filmId, { status: 'analysing', note: '' });

  const storage = await getStorage();
  const dir = await mkdtemp(path.join(tmpdir(), 'act-one-bench-'));
  const local = path.join(dir, path.basename(film.storageKey));
  try {
    const bytes = await storage.get(film.storageKey);
    await writeFile(local, bytes as unknown as Uint8Array);
    const registry = await buildRegistry({ organizationId: 'org_platform' });
    /*
     * A missing analyst is not an error here. The film is still measured, and
     * the result says it was never watched — which an operator can fix by
     * configuring a provider and pressing re-analyse, rather than by
     * re-uploading a file that was fine.
     */
    const analyst = registry.videoAnalystOrNull();
    const result = await analyseBenchmark(local, analyst, { organizationId: 'org_platform' } as never);

    await store.benchmarkFilms.update(filmId, {
      status: result.status,
      note: result.note,
      measured: result.measured,
      reading: result.reading,
      mechanismCount: result.mechanismCount,
      durationSeconds: result.durationSeconds || film.durationSeconds,
      analysedAt: new Date().toISOString(),
      costUsd: film.costUsd + result.costUsd,
    });
  } catch (error) {
    await store.benchmarkFilms.update(filmId, {
      status: 'failed',
      note: (error as Error).message.slice(0, 500),
    });
    reportError('benchmarks.analyse', error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function uploadBenchmark(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const file = form.get('file');
  const title = String(form.get('title') ?? '').trim();

  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a film to upload.' };
  if (file.size > MAX_BYTES) return { ok: false, message: `That file is ${(file.size / 1e6).toFixed(0)} MB; the limit is ${MAX_BYTES / 1e6} MB.` };
  if (file.type && !ALLOWED.has(file.type)) return { ok: false, message: `${file.type} is not a video container this can read.` };
  if (!title) return { ok: false, message: 'Give it a title. A filename is not a title, and this list is read by people.' };

  try {
    const id = newId('bmf');
    const extension = path.extname(file.name) || '.mp4';
    const storageKey = `benchmarks/${id}${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const storage = await getStorage();
    await storage.put(storageKey, bytes, { contentType: file.type || 'video/mp4', visibility: 'private' });

    const now = new Date().toISOString();
    await getStore().benchmarkFilms.create(BenchmarkFilm.parse({
      id, title, storageKey,
      originalFilename: file.name,
      byteSize: bytes.byteLength,
      status: 'pending',
      uploadedBy: user.email,
      createdAt: now, updatedAt: now,
    }));

    await analyseInto(id);
    revalidatePath('/admin/benchmarks');
    return { ok: true, message: '' };
  } catch (error) {
    reportError('benchmarks.upload', error);
    return { ok: false, message: (error as Error).message };
  }
}

export async function reanalyseBenchmark(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = String(form.get('id') ?? '');
  try {
    await analyseInto(id);
    revalidatePath('/admin/benchmarks');
    return { ok: true, message: '' };
  } catch (error) {
    reportError('benchmarks.reanalyse', error);
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * Takes a film out of retrieval without destroying its analysis, or puts it
 * back. Distinct from delete on purpose: an operator who finds one reference
 * pulling the corpus toward a single look should be able to test that belief
 * and reverse it, which re-uploading and re-analysing does not allow.
 */
export async function setBenchmarkEnabled(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = String(form.get('id') ?? '');
  const enable = String(form.get('enable') ?? '') === '1';
  try {
    const film = await getStore().benchmarkFilms.get(id);
    if (!film) return { ok: false, message: 'No such reference film.' };
    if (enable) {
      // Back to what its analysis actually supports, not blindly to 'analysed'.
      const restored = film.reading && film.mechanismCount > 0 && film.measured && !film.note ? 'analysed' : film.measured || film.reading ? 'partial' : 'pending';
      await getStore().benchmarkFilms.update(id, { status: restored });
    } else {
      await getStore().benchmarkFilms.update(id, { status: 'disabled' });
    }
    revalidatePath('/admin/benchmarks');
    return { ok: true, message: '' };
  } catch (error) {
    reportError('benchmarks.enable', error);
    return { ok: false, message: (error as Error).message };
  }
}

export async function deleteBenchmark(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = String(form.get('id') ?? '');
  try {
    const store = getStore();
    const film = await store.benchmarkFilms.get(id);
    if (!film) return { ok: false, message: 'No such reference film.' };
    // The row goes first: a stored file with no row is invisible clutter, but a
    // row pointing at a file that is gone breaks every read of the corpus.
    await store.benchmarkFilms.remove(id);
    try {
      await (await getStorage()).delete(film.storageKey);
    } catch (error) {
      reportError('benchmarks.delete.storage', error);
    }
    revalidatePath('/admin/benchmarks');
    return { ok: true, message: '' };
  } catch (error) {
    reportError('benchmarks.delete', error);
    return { ok: false, message: (error as Error).message };
  }
}
