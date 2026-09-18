import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { createProject } from '../projects.ts';
import { deleteLibraryAsset, loadLibrary, loadProjectAssets, setLibraryAssetProjects, updateLibraryAsset, uploadLibraryAsset } from '../library.ts';
import { POST as upload } from '../../app/api/library/upload/route.ts';
import { GET as getAsset } from '../../app/api/assets/[id]/route.ts';

/**
 * The library's doors and its promises, at the layer that keeps them.
 *
 * A picture is what its bytes say; a role decides who may add one; a
 * project of another workspace cannot be attached to; a correction outlives
 * the classifier; a version knows its original; and what comes back to the
 * browser is the small version the upload made, never a document that runs.
 */
vi.mock('../platform.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform.ts')>()),
  // No providers under test: classification is asked and quietly declines.
  buildRegistry: async () => {
    throw new AppError('conflict', 'No providers under test.');
  },
}));

let store: MemoryStore;

async function founder(name: string): Promise<Session> {
  resetRequest();
  request().headers.set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  return signUp({ email: `${name}-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name });
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

let png: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  process.env.ACT_ONE_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), 'act-one-library-'));
  const sharp = (await import('sharp')).default;
  png = new Uint8Array(await sharp({ create: { width: 96, height: 64, channels: 3, background: '#5b6cff' } }).png().toBuffer());
});

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('adding to the library', () => {
  it('stores a picture under the workspace, named from its file, with a first guess at what it is', async () => {
    const session = await founder('Ada');
    const asset = await uploadLibraryAsset(session, { bytes: png, filename: 'founder_portrait.png', projectIds: [] });
    expect(asset).toMatchObject({
      library: true,
      kind: 'user_upload',
      origin: 'uploaded',
      rights: 'customer_owned',
      contentType: 'image/png',
      width: 96,
      height: 64,
      name: 'founder portrait',
      category: 'founder',
      categorySource: 'inferred',
      source: 'upload',
      projectId: null,
      uploadedByUserId: session.user.id,
    });
    expect(asset.storageKey).toBe(`org/${session.organizationId}/library/${asset.id}.png`);
    expect(asset.metadata['thumbnailKey']).toBe(`${asset.storageKey}.thumb.webp`);

    const { cards, total } = await loadLibrary(session, {});
    expect(total).toBe(1);
    expect(cards[0]).toMatchObject({ id: asset.id, projects: [], thumbUrl: `/api/assets/${asset.id}?thumb`, categoryLabel: 'Founder' });
  });

  it('reads the bytes, not the name, and refuses what is not a picture', async () => {
    const session = await founder('Ada');
    const html = new TextEncoder().encode('<html><body>not a picture</body></html>');
    expect((await failure(uploadLibraryAsset(session, { bytes: html, filename: 'innocent.png', projectIds: [] }))).code).toBe('validation_failed');
    const scripted = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await failure(uploadLibraryAsset(session, { bytes: scripted, filename: 'logo.svg', projectIds: [] }))).code).toBe('validation_failed');
    expect((await failure(uploadLibraryAsset(session, { bytes: new Uint8Array(0), filename: 'empty.png', projectIds: [] }))).code).toBe('validation_failed');
    expect((await loadLibrary(session, {})).total).toBe(0);
  });

  it('is a door only editors and up may use', async () => {
    const owner = await founder('Ada');
    const reviewer: Session = { ...owner, role: 'reviewer', actor: { ...owner.actor, role: 'reviewer' } };
    expect((await failure(uploadLibraryAsset(reviewer, { bytes: png, filename: 'a.png', projectIds: [] }))).code).toBe('forbidden');
    const asset = await uploadLibraryAsset(owner, { bytes: png, filename: 'a.png', projectIds: [] });
    expect((await failure(updateLibraryAsset(reviewer, asset.id, { favorite: true }))).code).toBe('forbidden');
    expect((await failure(deleteLibraryAsset(reviewer, asset.id))).code).toBe('forbidden');
  });

  it('attaches only to the workspace’s own projects, and a project sees what it may use', async () => {
    const ada = await founder('Ada');
    const launch = await createProject(ada, { websiteUrl: 'https://acme.example' });
    const grace = await founder('Grace');
    const theirs = await createProject(grace, { websiteUrl: 'https://rival.example' });

    expect((await failure(uploadLibraryAsset(ada, { bytes: png, filename: 'a.png', projectIds: [theirs.id] }))).code).toBe('not_found');
    const only = await uploadLibraryAsset(ada, { bytes: png, filename: 'launch-hero.png', projectIds: [launch.id] });
    const shared = await uploadLibraryAsset(ada, { bytes: png, filename: 'logo.png', projectIds: [] });
    expect((await failure(setLibraryAssetProjects(ada, only.id, [theirs.id]))).code).toBe('not_found');
    expect((await failure(setLibraryAssetProjects(grace, only.id, [theirs.id]))).code).toBe('not_found');

    const forLaunch = await loadProjectAssets(ada, launch.id);
    expect(forLaunch.cards.map((card) => card.id).sort()).toEqual([only.id, shared.id].sort());
    expect(forLaunch.cards.find((card) => card.id === only.id)!.projects).toEqual([{ id: launch.id, name: launch.name }]);
    expect(forLaunch.cards.find((card) => card.id === shared.id)!.projects).toEqual([]);
    expect((await loadProjectAssets(grace, theirs.id)).total).toBe(0);
  });

  it('keeps a person’s correction, and a version knows its original', async () => {
    const ada = await founder('Ada');
    const launch = await createProject(ada, { websiteUrl: 'https://acme.example' });
    const original = await uploadLibraryAsset(ada, { bytes: png, filename: 'IMG_2041.png', projectIds: [launch.id] });
    expect(original.category).toBe('other');

    const corrected = await updateLibraryAsset(ada, original.id, { category: 'office', name: 'The studio' });
    expect(corrected).toMatchObject({ category: 'office', categorySource: 'user', name: 'The studio' });
    expect((await failure(updateLibraryAsset(ada, original.id, { name: '   ' }))).code).toBe('validation_failed');

    const version = await uploadLibraryAsset(ada, { bytes: png, filename: 'IMG_2041-retouched.png', projectIds: [], parentAssetId: original.id });
    expect(version).toMatchObject({ parentAssetId: original.id, name: 'The studio', category: 'office', categorySource: 'user', source: 'edited' });
    expect((await loadProjectAssets(ada, launch.id)).cards.map((card) => card.id)).toContain(version.id);
  });

  it('removes an upload for good, but only lifts a research capture out of the library', async () => {
    const ada = await founder('Ada');
    const upload = await uploadLibraryAsset(ada, { bytes: png, filename: 'a.png', projectIds: [] });
    await deleteLibraryAsset(ada, upload.id);
    expect(await store.assets.get(ada.organizationId, upload.id)).toBeNull();

    const capture = await store.assets.create({
      id: newId('ast'), organizationId: ada.organizationId, kind: 'screenshot', origin: 'captured', rights: 'customer_owned',
      storageKey: `org/${ada.organizationId}/x.png`, contentType: 'image/png', createdAt: new Date().toISOString(),
      library: true, name: 'Pricing', category: 'screenshot', source: 'browser_research',
    });
    await deleteLibraryAsset(ada, capture.id);
    expect((await store.assets.get(ada.organizationId, capture.id))?.library).toBe(false);
  });
});

describe('the upload route', () => {
  function post(file: File | null, fields: Record<string, string> = {}): Request {
    const body = new FormData();
    if (file) body.set('file', file, file.name);
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return new Request('http://localhost/api/library/upload', { method: 'POST', body });
  }

  it('answers a signed-in editor with the card, and nobody else at all', async () => {
    await founder('Ada');
    const response = await upload(post(new File([png], 'team-offsite.png', { type: 'image/png' })));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { asset: { id: string; name: string; category: string } };
    expect(payload.asset).toMatchObject({ name: 'team-offsite', category: 'team' });

    resetRequest();
    expect((await upload(post(new File([png], 'a.png')))).status).toBe(401);
  });

  it('refuses a missing file, a fake picture, and a declared size past the limit', async () => {
    await founder('Ada');
    expect((await upload(post(null))).status).toBe(400);
    expect((await upload(post(new File([new TextEncoder().encode('%PDF-1.7')], 'brochure.png')))).status).toBe(422);
    const huge = new Request('http://localhost/api/library/upload', { method: 'POST', headers: { 'content-length': String(60 * 1024 * 1024) }, body: 'x' });
    expect((await upload(huge)).status).toBe(413);
  });

  it('serves the small version to the grid, and an SVG as a picture that cannot run', async () => {
    const ada = await founder('Ada');
    const raster = await uploadLibraryAsset(ada, { bytes: png, filename: 'a.png', projectIds: [] });
    const thumb = await getAsset(new Request(`http://localhost/api/assets/${raster.id}?thumb`), { params: Promise.resolve({ id: raster.id }) });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    const full = await getAsset(new Request(`http://localhost/api/assets/${raster.id}`), { params: Promise.resolve({ id: raster.id }) });
    expect(full.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(png);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const vector = await uploadLibraryAsset(ada, { bytes: svg, filename: 'mark.svg', projectIds: [] });
    expect(vector.category).toBe('logo');
    const served = await getAsset(new Request(`http://localhost/api/assets/${vector.id}?thumb`), { params: Promise.resolve({ id: vector.id }) });
    expect(served.headers.get('content-type')).toBe('image/svg+xml');
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});
