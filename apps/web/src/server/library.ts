import 'server-only';
import { z } from 'zod';
import {
  AppError,
  ASSET_SOURCE_LABELS,
  LIBRARY_CATEGORY_LABELS,
  LibraryCategory,
  can,
  categoryFromFilename,
  imageInfo,
  libraryStorageKeyFor,
  nameFromFilename,
  newId,
  svgIsSafe,
  type Asset,
  type AssetSource,
  type CategorySource,
} from '@act-one/core';
import type { LibraryFilter } from '@act-one/db';
import type { StorageProvider } from '@act-one/providers';
import type { Session } from './auth.ts';
import { getStore } from './store.ts';
import { getStorage } from './assets.ts';
import { buildRegistry } from './platform.ts';
import { reportError } from './report.ts';

/**
 * The library.
 *
 * Every picture a workspace owns, in one place: what people upload, what
 * the research kept, what a film was made from. One file however many
 * projects use it; a project's own assets are a view over this. Nothing here
 * is demanded of the person at upload — the name is the filename, the
 * category is inferred, and both can be corrected at any time.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const THUMBNAIL_EDGE = 640;

export type UploadInput = {
  bytes: Uint8Array;
  filename: string;
  /** Projects to use it in. None means every project. */
  projectIds: string[];
  /** When this is a new version of an asset already in the library. */
  parentAssetId?: string | null;
};

export async function uploadLibraryAsset(session: Session, input: UploadInput): Promise<Asset> {
  if (!can(session.actor, 'asset:upload')) throw new AppError('forbidden', 'Your role cannot add to the library.');
  if (input.bytes.byteLength === 0) throw new AppError('validation_failed', 'The file is empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new AppError('validation_failed', `Files are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB for now.`);
  }

  // The bytes decide what it is. The name and the browser's content type are
  // opinions, and a `.png` full of HTML is not a picture.
  const info = imageInfo(input.bytes);
  if (!info) throw new AppError('validation_failed', 'Only PNG, JPG, WebP and SVG pictures can be added for now.');
  if (info.format === 'svg' && !svgIsSafe(input.bytes)) {
    throw new AppError('validation_failed', 'This SVG contains script or reaches out to other places, so it cannot be used.');
  }

  const store = getStore();
  const organizationId = session.organizationId;

  for (const projectId of new Set(input.projectIds)) {
    if (!(await store.projects.get(organizationId, projectId))) throw new AppError('not_found', 'Project not found.');
  }
  const parent = input.parentAssetId ? await store.assets.get(organizationId, input.parentAssetId) : null;
  if (input.parentAssetId && !parent) throw new AppError('not_found', 'The original asset was not found.');

  const assetId = newId('ast');
  const storageKey = libraryStorageKeyFor({ organizationId, assetId, extension: info.extension });
  const storage = await getStorage();
  const stored = await storage.put(storageKey, input.bytes, { contentType: info.contentType, visibility: 'private' });
  const thumbnailKey = await writeThumbnail(storage, storageKey, input.bytes, info.format);

  const guess = parent ? parent.category : categoryFromFilename(input.filename, info.contentType);
  const asset = await store.assets.create({
    id: assetId,
    organizationId,
    projectId: null,
    kind: 'user_upload',
    origin: 'uploaded',
    rights: 'customer_owned',
    storageKey,
    contentType: info.contentType,
    bytes: input.bytes.byteLength,
    width: info.width,
    height: info.height,
    checksum: stored.checksum,
    sourceUrl: null,
    metadata: {
      filename: input.filename.split(/[\\/]/).pop()?.slice(0, 200) ?? '',
      ...(thumbnailKey ? { thumbnailKey } : {}),
    },
    createdAt: new Date().toISOString(),
    library: true,
    // A version keeps its original's name, category, tags and projects: it
    // is the same picture, later.
    name: parent ? parent.name : nameFromFilename(input.filename),
    category: guess,
    categorySource: parent ? parent.categorySource : guess === 'other' ? 'none' : 'inferred',
    description: parent ? parent.description : '',
    tags: parent ? parent.tags : [],
    parentAssetId: parent?.id ?? null,
    uploadedByUserId: session.user.id,
    source: parent ? 'edited' : 'upload',
  });

  const projects =
    parent && input.projectIds.length === 0
      ? (await store.assets.listProjectLinks(organizationId, [parent.id])).map((link) => link.projectId)
      : input.projectIds;
  if (projects.length > 0) await store.assets.attachToProjects(organizationId, asset.id, projects);

  return asset;
}

/**
 * A small version for the grid, made once at upload.
 *
 * A hundred cards each loading a twenty-megabyte photograph is the kind of
 * slowness a person blames on the product. Vector files are already small,
 * and are served as they are.
 */
async function writeThumbnail(storage: StorageProvider, storageKey: string, bytes: Uint8Array, format: string): Promise<string | null> {
  if (format === 'svg') return null;
  try {
    const sharp = (await import('sharp')).default;
    const small = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const key = `${storageKey}.thumb.webp`;
    await storage.put(key, new Uint8Array(small), { contentType: 'image/webp', visibility: 'private' });
    return key;
  } catch (error) {
    // The original is stored and served; the grid is slower for this one.
    console.error('[library] thumbnail not made:', (error as Error).message.slice(0, 160));
    return null;
  }
}

// --- classification --------------------------------------------------------

const Classification = z.object({
  category: LibraryCategory,
  /** One sentence: what is in the picture. Searchable. */
  description: z.string().max(400),
  tags: z.array(z.string().max(40)).max(8).default([]),
});

const CLASSIFY_PROMPT = `You catalogue pictures for a film studio's asset library. Look at the picture and say what it is.

Categories:
- product: a physical product, packaging, hardware, a packshot
- founder: one person who is clearly the founder or an executive, a portrait or headshot
- people: customers, users, a crowd, people at work who are not the team
- team: the company's own people together
- office: a workplace, a building, a desk, an interior
- ui: the software's own interface, a dashboard, an app screen (not a whole web page)
- screenshot: a whole web page or a page of a site as a browser shows it
- logo: a logo, a wordmark, an icon, a mark on its own
- brand: a pattern, a texture, a colour study, a type specimen, a brand element
- illustration: a drawing, a vector scene, an icon set, 3D art
- reference: a moodboard, a still from another film, an example of a style
- other: anything else

Write one plain sentence describing what is in the picture — the subject, the setting, the light — so a person searching for it by what it shows would find it. Never guess names. Give up to eight lower-case tags.

Return JSON only.`;

/**
 * Looks at a new picture and writes down what it is.
 *
 * Runs after the upload has been answered, so the card is on the page
 * before the model has seen it. A person's own choice of category is never
 * overwritten; the classifier only speaks where nobody has. Without a
 * vision model — a fresh install, a key not yet entered — the filename's
 * guess stands and the card says nothing it does not know.
 */
export async function classifyLibraryAsset(organizationId: string, assetId: string): Promise<void> {
  const store = getStore();
  const asset = await store.assets.get(organizationId, assetId);
  if (!asset || !asset.library || asset.categorySource === 'user') return;
  if (!asset.contentType.startsWith('image/') || asset.contentType.includes('svg')) return;

  try {
    const registry = await buildRegistry({ organizationId });
    const llm = registry.llm();
    const storage = await getStorage();
    const thumbnailKey = typeof asset.metadata['thumbnailKey'] === 'string' ? asset.metadata['thumbnailKey'] : null;
    const bytes = await storage.get(thumbnailKey ?? asset.storageKey);
    const dataUrl = `data:${thumbnailKey ? 'image/webp' : asset.contentType};base64,${Buffer.from(bytes).toString('base64')}`;
    const filename = typeof asset.metadata['filename'] === 'string' ? asset.metadata['filename'] : asset.name;

    const { value } = await llm.completeJson(
      [
        { role: 'system', content: CLASSIFY_PROMPT },
        {
          role: 'user',
          content: `Filename: ${filename || '(none)'}\nFirst guess from the filename: ${asset.category}\n${asset.width && asset.height ? `Size: ${asset.width}×${asset.height}` : ''}`,
        },
      ],
      {
        schema: Classification,
        schemaName: 'LibraryClassification',
        tier: 'fast',
        temperature: 0,
        maxOutputTokens: 300,
        images: [{ url: dataUrl, detail: 'low' }],
      },
      { organizationId },
    );

    const fresh = await store.assets.get(organizationId, assetId);
    if (!fresh || fresh.categorySource === 'user') return;
    await store.assets.update(organizationId, assetId, {
      category: value.category,
      categorySource: 'inferred',
      description: value.description.trim().slice(0, 400),
      tags: [...new Set(value.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
    });
  } catch (error) {
    reportError('classifyLibraryAsset', error, { organizationId });
  }
}

// --- editing ---------------------------------------------------------------

export type LibraryPatch = {
  name?: string;
  category?: LibraryCategory;
  favorite?: boolean;
  approved?: boolean;
  tags?: string[];
};

export async function updateLibraryAsset(session: Session, assetId: string, patch: LibraryPatch): Promise<Asset> {
  if (!can(session.actor, 'asset:upload')) throw new AppError('forbidden', 'Your role cannot edit the library.');
  const store = getStore();
  const asset = await store.assets.get(session.organizationId, assetId);
  if (!asset || !asset.library) throw new AppError('not_found', 'Asset not found.');

  const next: Partial<Asset> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 200);
    if (!name) throw new AppError('validation_failed', 'A name cannot be empty.');
    next.name = name;
  }
  if (patch.category !== undefined) {
    next.category = patch.category;
    // A person's word outlasts every later inference.
    next.categorySource = 'user';
  }
  if (patch.favorite !== undefined) next.favorite = patch.favorite;
  if (patch.approved !== undefined) next.approved = patch.approved;
  if (patch.tags !== undefined) next.tags = [...new Set(patch.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  return store.assets.update(session.organizationId, assetId, next);
}

/** Which projects use it. An empty list means every project, now and later. */
export async function setLibraryAssetProjects(session: Session, assetId: string, projectIds: string[]): Promise<void> {
  if (!can(session.actor, 'asset:upload')) throw new AppError('forbidden', 'Your role cannot edit the library.');
  const store = getStore();
  const asset = await store.assets.get(session.organizationId, assetId);
  if (!asset || !asset.library) throw new AppError('not_found', 'Asset not found.');
  await store.assets.setProjects(session.organizationId, assetId, [...new Set(projectIds)]);
}

/** Removes the picture and its small version. Versions made from it stand on their own. */
export async function deleteLibraryAsset(session: Session, assetId: string): Promise<void> {
  if (!can(session.actor, 'asset:upload')) throw new AppError('forbidden', 'Your role cannot edit the library.');
  const store = getStore();
  const asset = await store.assets.get(session.organizationId, assetId);
  if (!asset || !asset.library) throw new AppError('not_found', 'Asset not found.');

  // A research capture is the trail's evidence too: it leaves the library
  // but stays with the project's sources. An upload is gone for good.
  if (asset.source === 'browser_research') {
    await store.assets.update(session.organizationId, assetId, { library: false });
    return;
  }
  const storage = await getStorage();
  const thumbnailKey = typeof asset.metadata['thumbnailKey'] === 'string' ? asset.metadata['thumbnailKey'] : null;
  await store.assets.delete(session.organizationId, assetId);
  for (const key of [asset.storageKey, thumbnailKey]) {
    if (!key) continue;
    try {
      await storage.delete(key);
    } catch (error) {
      console.error('[library] object not deleted:', (error as Error).message.slice(0, 160));
    }
  }
}

// --- reading ---------------------------------------------------------------

export type LibraryCard = {
  id: string;
  name: string;
  category: LibraryCategory;
  categoryLabel: string;
  categorySource: CategorySource;
  source: AssetSource;
  sourceLabel: string;
  description: string;
  tags: string[];
  favorite: boolean;
  approved: boolean;
  parentAssetId: string | null;
  /** Projects it is used in. Empty means every project. */
  projects: { id: string; name: string }[];
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  createdAt: string;
  sourceUrl: string | null;
  url: string;
  thumbUrl: string;
  /** Whether the picture may stand for the product on screen. */
  isProduct: boolean;
};

export function cardOf(asset: Asset, projects: { id: string; name: string }[]): LibraryCard {
  return {
    id: asset.id,
    name: asset.name || (typeof asset.metadata['filename'] === 'string' ? asset.metadata['filename'] : asset.id),
    category: asset.category,
    categoryLabel: LIBRARY_CATEGORY_LABELS[asset.category],
    categorySource: asset.categorySource,
    source: asset.source,
    sourceLabel: ASSET_SOURCE_LABELS[asset.source],
    description: asset.description,
    tags: asset.tags,
    favorite: asset.favorite,
    approved: asset.approved,
    parentAssetId: asset.parentAssetId,
    projects,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    contentType: asset.contentType,
    createdAt: asset.createdAt,
    sourceUrl: asset.sourceUrl,
    url: `/api/assets/${asset.id}`,
    thumbUrl: typeof asset.metadata['thumbnailKey'] === 'string' ? `/api/assets/${asset.id}?thumb` : `/api/assets/${asset.id}`,
    isProduct:
      (asset.origin === 'captured' || asset.origin === 'uploaded') &&
      (asset.kind === 'screenshot' || asset.category === 'ui' || asset.category === 'screenshot'),
  };
}

export type LibraryView = {
  cards: LibraryCard[];
  projects: { id: string; name: string }[];
  /** Everything in the library, before the filter. */
  total: number;
};

export async function loadLibrary(session: Session, filter: LibraryFilter): Promise<LibraryView> {
  const store = getStore();
  const [assets, all, projects] = await Promise.all([
    store.assets.listLibrary(session.organizationId, { ...filter, limit: filter.limit ?? 400 }),
    store.assets.listLibrary(session.organizationId, { limit: 2000 }),
    store.projects.list(session.organizationId),
  ]);
  const names = new Map(projects.map((project) => [project.id, project.name] as const));
  const links = await store.assets.listProjectLinks(
    session.organizationId,
    assets.map((asset) => asset.id),
  );
  const byAsset = new Map<string, { id: string; name: string }[]>();
  for (const link of links) {
    const name = names.get(link.projectId);
    if (!name) continue;
    byAsset.set(link.assetId, [...(byAsset.get(link.assetId) ?? []), { id: link.projectId, name }]);
  }
  return {
    cards: assets.map((asset) => cardOf(asset, byAsset.get(asset.id) ?? [])),
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    total: all.length,
  };
}

/** The pictures a project can use, newest first, as the project page shows them. */
export async function loadProjectAssets(session: Session, projectId: string, limit = 12): Promise<{ cards: LibraryCard[]; total: number }> {
  const store = getStore();
  const assets = await store.assets.listLibraryForProject(session.organizationId, projectId);
  const shown = assets.slice(0, limit);
  const project = await store.projects.get(session.organizationId, projectId);
  const links = await store.assets.listProjectLinks(session.organizationId, shown.map((asset) => asset.id));
  const attached = new Set(links.filter((link) => link.projectId === projectId).map((link) => link.assetId));
  return {
    cards: shown.map((asset) => cardOf(asset, attached.has(asset.id) && project ? [{ id: project.id, name: project.name }] : [])),
    total: assets.length,
  };
}
