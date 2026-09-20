import {
  ASSET_DESCRIPTION_LIMIT,
  ASSET_NAME_LIMIT,
  fitLabel,
  newId,
  storageKeyFor,
  type Asset,
  type AssetKind,
  type AssetOrigin,
  type AssetRights,
  type AssetSource,
  type CategorySource,
  type JobEventInput,
  type LibraryCategory,
  type Project,
} from '@act-one/core';
import type { Store } from '@act-one/db';
import type { ProviderRegistry } from '@act-one/providers';

/**
 * What every pipeline stage is given.
 *
 * Bundled into one object rather than passed as six arguments so a new stage
 * cannot be written that quietly reaches for a global store or a differently
 * scoped registry. The organisation id lives here and nowhere else.
 */
export type StageContext = {
  store: Store;
  registry: ProviderRegistry;
  organizationId: string;
  project: Project;
  jobId: string;
  /** Reports progress back to the job so the customer's panel moves. */
  progress: (fraction: number, message: string) => Promise<void>;
  /**
   * Writes one curated line of activity — a page read, a step begun or
   * finished, a scene rendered — for the customer to watch. Never a log
   * line. Failures to write are swallowed: activity must never fail a job.
   */
  activity: (event: JobEventInput) => Promise<void>;
  signal?: AbortSignal;
};

export type StoredAsset = { asset: Asset; url: string };

/**
 * Writes bytes into our own storage and records the asset.
 *
 * Every captured, generated and rendered byte goes through here. Provider URLs
 * expire and vendor accounts get closed; a film we cannot re-render in six
 * months is not a deliverable.
 */
export async function storeAsset(
  context: StageContext,
  params: {
    data: Uint8Array;
    kind: AssetKind;
    origin: AssetOrigin;
    rights: AssetRights;
    extension: string;
    contentType: string;
    sceneId?: string | null;
    conceptId?: string | null;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    provider?: string | null;
    model?: string | null;
    sourceUrl?: string | null;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  } & LibraryParams,
): Promise<StoredAsset> {
  const assetId = newId('ast');
  const storageKey = storageKeyFor({
    organizationId: context.organizationId,
    projectId: context.project.id,
    conceptId: params.conceptId ?? null,
    sceneId: params.sceneId ?? null,
    assetId,
    extension: params.extension,
  });

  const storage = context.registry.storage();
  const stored = await storage.put(storageKey, params.data, {
    contentType: params.contentType,
    visibility: 'private',
  });

  const asset = await context.store.assets.create({
    id: assetId,
    organizationId: context.organizationId,
    projectId: context.project.id,
    conceptId: params.conceptId ?? null,
    sceneId: params.sceneId ?? null,
    kind: params.kind,
    origin: params.origin,
    rights: params.rights,
    storageKey,
    contentType: params.contentType,
    bytes: params.data.byteLength,
    width: params.width ?? null,
    height: params.height ?? null,
    durationSeconds: params.durationSeconds ?? null,
    checksum: stored.checksum,
    provider: params.provider ?? null,
    model: params.model ?? null,
    sourceUrl: params.sourceUrl ?? null,
    costUsd: params.costUsd ?? 0,
    metadata: params.metadata ?? {},
    createdAt: new Date().toISOString(),
    ...libraryFields(params),
  });
  await attachToLibrary(context, asset.id, params);

  return { asset, url: stored.url ?? (await storage.signedUrl(storageKey)) };
}

/**
 * What a stage may say about an asset's place in the library.
 *
 * Most of what the pipeline stores is production material and stays out of
 * it. A page the research read, a product image it found, a shot generated
 * from a still a person approved: those are named, categorised and attached
 * to the project here, at the moment they are made, so the library never
 * needs a second pass to find out what it holds.
 */
export type LibraryParams = {
  library?: boolean;
  name?: string;
  category?: LibraryCategory;
  categorySource?: CategorySource;
  description?: string;
  source?: AssetSource;
  /** The asset this one was made from — a generated shot's reference still. */
  parentAssetId?: string | null;
  /** Projects to attach the asset to. A library asset attached to none is shared with every project. */
  attachTo?: string[];
};

function libraryFields(params: LibraryParams): Partial<Asset> {
  return {
    library: params.library ?? false,
    name: fitLabel(params.name ?? '', ASSET_NAME_LIMIT),
    category: params.category ?? 'other',
    categorySource: params.categorySource ?? (params.category ? 'inferred' : 'none'),
    description: fitLabel(params.description ?? '', ASSET_DESCRIPTION_LIMIT),
    source: params.source ?? 'pipeline',
    parentAssetId: params.parentAssetId ?? null,
  };
}

async function attachToLibrary(context: StageContext, assetId: string, params: LibraryParams): Promise<void> {
  if (!params.attachTo || params.attachTo.length === 0) return;
  try {
    await context.store.assets.attachToProjects(context.organizationId, assetId, params.attachTo);
  } catch (error) {
    // The asset is stored and recorded; a missing project link is the
    // library's problem, not the film's.
    console.error('[assets] library link not written:', (error as Error).message.slice(0, 160));
  }
}

/** Copies a provider-hosted result into our storage before its URL expires. */
export async function ingestAsset(
  context: StageContext,
  params: {
    url: string;
    kind: AssetKind;
    origin: AssetOrigin;
    rights: AssetRights;
    extension: string;
    contentType: string;
    sceneId?: string | null;
    provider?: string | null;
    model?: string | null;
    costUsd?: number;
    durationSeconds?: number | null;
  } & LibraryParams,
): Promise<StoredAsset> {
  const assetId = newId('ast');
  const storageKey = storageKeyFor({
    organizationId: context.organizationId,
    projectId: context.project.id,
    sceneId: params.sceneId ?? null,
    assetId,
    extension: params.extension,
  });

  const storage = context.registry.storage();
  const stored = await storage.ingestFromUrl(storageKey, params.url, {
    contentType: params.contentType,
    visibility: 'private',
  });

  const asset = await context.store.assets.create({
    id: assetId,
    organizationId: context.organizationId,
    projectId: context.project.id,
    conceptId: null,
    sceneId: params.sceneId ?? null,
    kind: params.kind,
    origin: params.origin,
    rights: params.rights,
    storageKey,
    contentType: params.contentType,
    bytes: stored.bytes,
    width: null,
    height: null,
    durationSeconds: params.durationSeconds ?? null,
    checksum: stored.checksum,
    provider: params.provider ?? null,
    model: params.model ?? null,
    sourceUrl: params.url,
    costUsd: params.costUsd ?? 0,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...libraryFields(params),
  });
  await attachToLibrary(context, asset.id, params);

  return { asset, url: stored.url ?? (await storage.signedUrl(storageKey)) };
}

/**
 * Which of these assets move.
 *
 * The renderer is handed signed URLs, which carry no type: a clip and a still
 * look identical to it, and getting it wrong produces an empty frame either
 * way. Asked here, from what the asset actually is.
 */
export async function footageAmong(context: StageContext, assetIds: string[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const assets = await context.store.assets.getMany(context.organizationId, [...new Set(assetIds)]);
  return assets.filter((asset) => asset.contentType.startsWith('video/')).map((asset) => asset.id);
}

/** An asset that was asked for and cannot be put on the screen, and why. */
export type UnresolvedAsset = {
  id: string;
  reason: 'no_such_asset' | 'object_missing';
  /** Where the bytes were supposed to be. Empty when there is no row at all. */
  storageKey: string;
};

/**
 * Asset ids to URLs the renderer can actually read.
 *
 * The important word is *actually*. This used to sign a URL for every asset
 * row it found and hand the lot to the renderer, which is a check of the
 * database and not of the film. A production ran with the web service and the
 * worker each holding their own local disk: every capture was ingested by one
 * of them, every row was written to the database both of them share, and the
 * bytes existed on exactly one machine. The worker then signed a URL for every
 * one of those rows, the renderer fetched them, every fetch was an ENOENT, and
 * each shot quietly drew its line of copy on a black frame instead. Thirty
 * seconds of title cards went out as a finished master, and nothing anywhere
 * in the system had asked the only question that mattered: is the picture
 * there.
 *
 * So existence is checked, once, here — the one place that holds both the id
 * and the storage it is supposed to be in. Everything downstream can then
 * treat a url in this map as a promise that something is behind it, and read
 * `missing` for the shots that have nothing.
 */
export async function resolveAssetUrls(
  context: StageContext,
  assetIds: string[],
): Promise<{ urls: Record<string, string>; missing: UnresolvedAsset[] }> {
  const wanted = [...new Set(assetIds)];
  if (wanted.length === 0) return { urls: {}, missing: [] };
  const assets = await context.store.assets.getMany(context.organizationId, wanted);
  const storage = context.registry.storage();
  const byId = new Map(assets.map((asset) => [asset.id, asset] as const));

  const missing: UnresolvedAsset[] = wanted
    .filter((id) => !byId.has(id))
    .map((id) => ({ id, reason: 'no_such_asset' as const, storageKey: '' }));

  const entries = await Promise.all(
    assets.map(async (asset) => {
      /*
       * A storage provider that cannot answer is treated as not holding the
       * object. The alternative is to assume it does, which is precisely the
       * assumption that produced the silent film: when this check is wrong it
       * should be wrong in the direction of stopping.
       */
      const held = await storage.exists(asset.storageKey).catch(() => false);
      if (!held) return null;
      // Signed and short-lived. The renderer reads them within seconds, and a
      // long-lived URL for a customer's private product capture is a leak
      // waiting to be pasted into a bug report.
      const url = await storage.signedUrl(asset.storageKey, 3600);
      return [asset.id, url] as const;
    }),
  );

  for (const [index, entry] of entries.entries()) {
    if (entry) continue;
    const asset = assets[index]!;
    missing.push({ id: asset.id, reason: 'object_missing', storageKey: asset.storageKey });
  }

  return {
    urls: Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null)),
    missing,
  };
}
