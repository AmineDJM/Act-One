import {
  newId,
  storageKeyFor,
  type Asset,
  type AssetKind,
  type AssetOrigin,
  type AssetRights,
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
  },
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
  });

  return { asset, url: stored.url ?? (await storage.signedUrl(storageKey)) };
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
  },
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
  });

  return { asset, url: stored.url ?? (await storage.signedUrl(storageKey)) };
}

/** Resolves asset ids to URLs the renderer can read. */
export async function resolveAssetUrls(
  context: StageContext,
  assetIds: string[],
): Promise<Record<string, string>> {
  if (assetIds.length === 0) return {};
  const assets = await context.store.assets.getMany(context.organizationId, [...new Set(assetIds)]);
  const storage = context.registry.storage();

  const entries = await Promise.all(
    assets.map(async (asset) => {
      // Signed and short-lived. The renderer reads them within seconds, and a
      // long-lived URL for a customer's private product capture is a leak
      // waiting to be pasted into a bug report.
      const url = await storage.signedUrl(asset.storageKey, 3600);
      return [asset.id, url] as const;
    }),
  );

  return Object.fromEntries(entries);
}
