import { createHash } from 'node:crypto';
import type { AssetKind, AssetRef } from './schema.ts';

export type IngestedAsset = AssetRef & { data: Uint8Array };

const MIME_EXTENSION: Record<AssetRef['mime'], string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'image/svg+xml': 'svg',
  'image/png': 'png',
};

const KIND_PREFIX: Record<AssetKind, string> = {
  font: 'font',
  'logo-svg': 'svg',
  'logo-png': 'logo',
  'capture-png': 'cap',
};

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The run's binary output, addressed by content.
 *
 * An id is derived from the bytes, so the same font loaded twice or the same
 * button captured twice is one asset, and a re-run of an unchanged site yields
 * the same ids. The byte budget is enforced here, in one place: a site that
 * serves eighty weights of a variable font does not get to fill a worker's
 * memory.
 */
export class AssetCollector {
  private readonly assets = new Map<string, IngestedAsset>();
  private readonly limitBytes: number;
  private total = 0;

  constructor(limitBytes: number) {
    this.limitBytes = limitBytes;
  }

  /** The stored reference, or null when keeping it would pass the budget. */
  add(
    kind: AssetKind,
    mime: AssetRef['mime'],
    data: Uint8Array,
    dimensions: { width: number; height: number } | null = null,
  ): AssetRef | null {
    if (data.byteLength === 0) return null;
    const digest = sha256(data);
    const id = `ing_${KIND_PREFIX[kind]}_${digest.slice(0, 12)}`;
    const existing = this.assets.get(id);
    if (existing) return stripData(existing);
    if (this.total + data.byteLength > this.limitBytes) return null;

    const asset: IngestedAsset = {
      id,
      kind,
      mime,
      fileName: `${id}.${MIME_EXTENSION[mime]}`,
      bytes: data.byteLength,
      sha256: digest,
      width: dimensions ? Math.max(1, Math.round(dimensions.width)) : null,
      height: dimensions ? Math.max(1, Math.round(dimensions.height)) : null,
      data,
    };
    this.assets.set(id, asset);
    this.total += data.byteLength;
    return stripData(asset);
  }

  refs(): AssetRef[] {
    return [...this.assets.values()].map(stripData);
  }

  files(): IngestedAsset[] {
    return [...this.assets.values()];
  }

  get totalBytes(): number {
    return this.total;
  }
}

function stripData(asset: IngestedAsset): AssetRef {
  const { data: _data, ...ref } = asset;
  return ref;
}
