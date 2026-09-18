import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { createProject } from '../projects.ts';
import {
  CONSENT_STATEMENT,
  decideEntry,
  editEntry,
  getPublicFilm,
  listPublicFilms,
  loadSubmission,
  publishManually,
  reorderEntries,
  submitForSelection,
  withdrawFromSelection,
} from '../collections.ts';
import { GET as publicAsset } from '../../app/api/collections/[slug]/[part]/route.ts';

/**
 * The two doors into Collections, and the one way out.
 *
 * A customer's film enters only with their consent, and only once it is a
 * clean master; staff publish only with attested consent; a person decides
 * what is shown; withdrawing takes it off the site at once; and the public
 * route serves the bytes of a published film and nothing else.
 */
let store: MemoryStore;

async function person(name: string): Promise<Session> {
  resetRequest();
  request().headers.set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  const session = await signUp({ email: `${name}-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name });
  // Room for several films: the free plan allows two projects a month.
  await store.organizations.update(session.organizationId, { planId: 'studio' });
  return session;
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

/** A project with a finished, clean master and a poster, as the pipeline leaves it. */
async function finishedFilm(session: Session, options: { watermarked?: boolean } = {}) {
  const project = await createProject(session, { websiteUrl: 'https://acme.example/' });
  const now = new Date().toISOString();
  const bytes = async (key: string, body: string) => {
    const file = path.join(process.env.ACT_ONE_STORAGE_DIR!, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  };
  const master = await store.assets.create({
    id: newId('ast'),
    organizationId: session.organizationId,
    projectId: project.id,
    kind: 'master_video',
    origin: 'rendered',
    rights: 'customer_owned',
    storageKey: `org/${session.organizationId}/masters/${project.id}.mp4`,
    contentType: 'video/mp4',
    bytes: 12,
    width: 1920,
    height: 1080,
    durationSeconds: 19,
    createdAt: now,
  });
  await bytes(master.storageKey, 'MASTER-BYTES');
  const poster = await store.assets.create({
    id: newId('ast'),
    organizationId: session.organizationId,
    projectId: project.id,
    kind: 'poster_frame',
    origin: 'rendered',
    rights: 'customer_owned',
    storageKey: `org/${session.organizationId}/posters/${project.id}.png`,
    contentType: 'image/png',
    bytes: 6,
    width: 1920,
    height: 1080,
    createdAt: now,
  });
  await bytes(poster.storageKey, 'POSTER');
  const render = await store.renders.create({
    id: newId('rnd'),
    projectId: project.id,
    storyboardId: newId('sbd'),
    organizationId: session.organizationId,
    kind: 'film',
    version: 1,
    aspect: '16:9',
    quality: 'hd',
    fps: 30,
    status: 'completed',
    masterAssetId: master.id,
    posterAssetId: poster.id,
    captionsAssetId: null,
    watermarked: options.watermarked ?? false,
    durationSeconds: 19,
    costUsd: 1,
    qaReportId: null,
    error: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  });
  await store.projects.update(session.organizationId, project.id, { latestRenderId: render.id, stage: 'film_ready' });
  return { project: { ...project, latestRenderId: render.id, stage: 'film_ready' as const }, render, master, poster };
}

async function staff(): Promise<Session> {
  // The first account on a fresh store is staff.
  return person('staff');
}

function get(slug: string, part: string, headers: Record<string, string> = {}) {
  return publicAsset(new Request(`http://localhost/api/collections/${slug}/${part}`, { headers }), { params: Promise.resolve({ slug, part }) });
}

beforeAll(async () => {
  process.env.ACT_ONE_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), 'act-one-collections-'));
});

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('submitting for selection', () => {
  it('needs a clean master and the consent, in so many words', async () => {
    const admin = await staff();
    const founder = await person('ada');
    const bare = await createProject(founder, { websiteUrl: 'https://acme.example/' });
    const before = await loadSubmission(founder, bare);
    expect(before).toMatchObject({ entry: null, next: 'submit', eligible: false, canSubmit: true });
    expect(before.reason).toContain('Render the master first');
    expect((await failure(submitForSelection(founder, bare.id, { consent: true }))).code).toBe('conflict');

    const preview = await finishedFilm(founder, { watermarked: true });
    expect((await failure(submitForSelection(founder, preview.project.id, { consent: true }))).publicMessage).toContain('watermarked');

    const film = await finishedFilm(founder);
    expect((await failure(submitForSelection(founder, film.project.id, { consent: false }))).code).toBe('validation_failed');

    const entry = await submitForSelection(founder, film.project.id, { consent: true, category: 'ai', launchDate: '2026-09-01', tagline: 'One run.' });
    expect(entry).toMatchObject({
      status: 'pending',
      organizationId: founder.organizationId,
      projectId: film.project.id,
      masterAssetId: film.master.id,
      posterAssetId: film.poster.id,
      productUrl: 'https://acme.example/',
      category: 'ai',
      launchDate: '2026-09-01',
      tagline: 'One run.',
      durationSeconds: 19,
      consent: { grantedByUserId: founder.user.id, statement: CONSENT_STATEMENT, byStaff: false },
      submittedByUserId: founder.user.id,
    });
    expect(entry.slug).toBe('acme');
    // Submitting again while under consideration changes nothing.
    expect((await submitForSelection(founder, film.project.id, { consent: true })).id).toBe(entry.id);
    expect(await loadSubmission(founder, film.project)).toMatchObject({ next: 'wait', label: 'Under consideration', publicPath: null });
    // Nothing is public yet.
    expect(await listPublicFilms()).toEqual([]);
    expect(await getPublicFilm('acme')).toBeNull();
    expect((await get('acme', 'film')).status).toBe(404);
    void admin;
  });

  it('is decided by a person, shown while selected, and gone the moment it is withdrawn', async () => {
    const admin = await staff();
    const founder = await person('ada');
    const film = await finishedFilm(founder);
    const entry = await submitForSelection(founder, film.project.id, { consent: true });

    const published = await decideEntry(entry.id, 'publish', admin.user.id);
    expect(published).toMatchObject({ status: 'published', decidedByUserId: admin.user.id });
    expect(published.publishedAt).not.toBeNull();
    expect(await loadSubmission(founder, film.project)).toMatchObject({ next: 'withdraw', label: 'Selected for Collections', publicPath: '/collections/acme' });

    const films = await listPublicFilms();
    expect(films.map((item) => item.slug)).toEqual(['acme']);
    expect(films[0]).toMatchObject({ credit: 'An Act One Production', videoPath: '/api/collections/acme/film', posterPath: '/api/collections/acme/poster', productHost: 'acme.example' });

    const whole = await get('acme', 'film');
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('cache-control')).toContain('public');
    expect(await whole.text()).toBe('MASTER-BYTES');
    const part = await get('acme', 'film', { range: 'bytes=0-5' });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('MASTER');
    expect((await get('acme', 'poster')).headers.get('content-type')).toBe('image/png');
    expect((await get('acme', 'still-1')).status).toBe(404);
    expect((await get('acme', film.master.id)).status).toBe(404);

    // Declining is only for a film under consideration; unpublishing takes it down.
    expect((await failure(decideEntry(entry.id, 'reject', admin.user.id))).code).toBe('conflict');
    await decideEntry(entry.id, 'unpublish', admin.user.id);
    expect((await get('acme', 'film')).status).toBe(404);
    expect(await getPublicFilm('acme')).toBeNull();
    await decideEntry(entry.id, 'publish', admin.user.id);
    expect((await get('acme', 'film')).status).toBe(200);

    // The customer withdraws: off the site at once, and staff cannot put it back.
    const withdrawn = await withdrawFromSelection(founder, film.project.id);
    expect(withdrawn.status).toBe('withdrawn');
    expect((await get('acme', 'film')).status).toBe(404);
    expect((await failure(decideEntry(entry.id, 'publish', admin.user.id))).publicMessage).toContain('withdrew');
    expect((await failure(publishManually({ organizationId: founder.organizationId, projectId: film.project.id, consentStatement: 'Written consent by email, 1 May.', original: false, staffUserId: admin.user.id }))).publicMessage).toContain('withdrew');
    // Only they can submit it again, under the same address.
    const again = await submitForSelection(founder, film.project.id, { consent: true });
    expect(again).toMatchObject({ id: entry.id, slug: 'acme', status: 'pending' });
  });

  it('is the customer\'s to do: a viewer cannot submit, and another workspace cannot see the entry', async () => {
    const founder = await person('ada');
    const film = await finishedFilm(founder);
    const viewer: Session = { ...founder, actor: { ...founder.actor, role: 'reviewer' } };
    expect((await failure(submitForSelection(viewer, film.project.id, { consent: true }))).code).toBe('forbidden');
    const stranger = await person('mallory');
    expect((await failure(submitForSelection(stranger, film.project.id, { consent: true }))).code).toBe('not_found');
    await submitForSelection(founder, film.project.id, { consent: true });
    expect((await failure(withdrawFromSelection(stranger, film.project.id))).code).toBe('not_found');
  });
});

describe('the editorial side', () => {
  it('lets staff publish with attested consent, and keeps the words, pictures, flags and order', async () => {
    const admin = await staff();
    const founder = await person('ada');
    const first = await finishedFilm(founder);
    const second = await finishedFilm(founder);

    expect((await failure(publishManually({ organizationId: founder.organizationId, projectId: first.project.id, consentStatement: 'ok', original: false, staffUserId: admin.user.id }))).code).toBe('validation_failed');
    const original = await publishManually({
      organizationId: founder.organizationId,
      projectId: first.project.id,
      consentStatement: 'Commissioned by Act One; written agreement with Acme on file.',
      original: true,
      category: 'saas',
      staffUserId: admin.user.id,
    });
    expect(original).toMatchObject({ status: 'published', original: true, category: 'saas', slug: 'acme', consent: { byStaff: true, grantedByUserId: admin.user.id } });
    expect((await getPublicFilm('acme'))?.credit).toBe('Act One Original');

    // The second film from the same company gets the next address.
    const entry = await submitForSelection(founder, second.project.id, { consent: true });
    expect(entry.slug).toBe('acme-2');
    await decideEntry(entry.id, 'publish', admin.user.id, 'Strong opening.');
    expect((await store.collections.get(entry.id))?.editorialNote).toBe('Strong opening.');

    // Words and pictures. A picture must be the film's own.
    const stranger = await person('mallory');
    const theirs = await finishedFilm(stranger);
    expect((await failure(editEntry(entry.id, { posterAssetId: theirs.poster.id }, admin.user.id))).code).toBe('validation_failed');
    expect((await failure(editEntry(entry.id, { slug: 'acme' }, admin.user.id))).code).toBe('conflict');
    const edited = await editEntry(entry.id, { title: 'Stop asking', tagline: 'Answered while you type.', slug: 'acme-stop-asking', stillAssetIds: [second.poster.id], seoTitle: 'Acme: Stop asking', launchOfTheWeek: true }, admin.user.id);
    expect(edited).toMatchObject({ title: 'Stop asking', slug: 'acme-stop-asking', stillAssetIds: [second.poster.id], launchOfTheWeek: true });
    expect(await getPublicFilm('acme-2')).toBeNull();
    const page = await getPublicFilm('acme-stop-asking');
    expect(page).toMatchObject({ seoTitle: 'Acme: Stop asking', stillPaths: ['/api/collections/acme-stop-asking/still-1'] });
    expect(await (await get('acme-stop-asking', 'still-1')).text()).toBe('POSTER');

    // One launch of the week: the flag moves.
    await editEntry(original.id, { launchOfTheWeek: true }, admin.user.id);
    expect((await store.collections.get(entry.id))?.launchOfTheWeek).toBe(false);
    expect((await listPublicFilms()).map((film) => film.slug)).toEqual(['acme', 'acme-stop-asking']);

    // Order among equals.
    await editEntry(original.id, { launchOfTheWeek: false }, admin.user.id);
    await reorderEntries([entry.id, original.id], admin.user.id);
    expect((await listPublicFilms()).map((film) => film.slug)).toEqual(['acme-stop-asking', 'acme']);
    expect((await listPublicFilms({ category: 'saas' })).map((film) => film.slug)).toEqual(['acme']);
  });
});
