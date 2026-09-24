import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from '@act-one/providers';
import type { FilmTokens } from './tokens.ts';
import type { AuthoredSceneStore, ScenePacket } from './types.ts';
import { ENGINE_VERSION, SCENE_CONTRACT_VERSION } from './version.ts';

/**
 * The key a written scene is kept under.
 *
 * Everything the agent was told, and nothing it was not: the packet (words,
 * recipe, camera, timing, files by path and size), the tokens, the contract
 * and engine versions, and the tier of model asked. Two renders that would
 * brief the agent identically share the scene; any change to the brief —
 * a reworded line, a new capture, a revised brand colour — writes a new one.
 */
export function sceneKey(packet: ScenePacket, tokens: FilmTokens, tier: string): string {
  const material = stableJson({
    contract: SCENE_CONTRACT_VERSION,
    engine: ENGINE_VERSION,
    tier,
    packet: { ...packet, assets: packet.assets.map(fingerprint), clip: packet.clip ? fingerprint(packet.clip) : null, brand: { ...packet.brand, logo: packet.brand.logo ? fingerprint(packet.brand.logo) : null } },
    tokens,
  });
  return createHash('sha256').update(material).digest('hex');
}

/** A file as the brief sees it: where it is and what shape it has. */
function fingerprint(asset: { path: string; kind: string; width: number | null; height: number | null; durationSeconds: number | null; bytes: number }) {
  return { path: asset.path, kind: asset.kind, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds, bytes: asset.bytes };
}

/** JSON with keys sorted at every level, so equal briefs hash equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** Scenes in memory, for tests and one-off renders. */
export class MemorySceneStore implements AuthoredSceneStore {
  readonly scenes = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.scenes.get(key) ?? null;
  }
  async put(key: string, html: string): Promise<void> {
    this.scenes.set(key, html);
  }
}

/** Scenes in a directory, for a worker's local runs and the demo scripts. */
export class DirectorySceneStore implements AuthoredSceneStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.fileFor(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(key: string, html: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.fileFor(key);
    const temporary = `${target}.${process.pid}.tmp`;
    // Written aside and renamed, so a reader never sees half a scene.
    await writeFile(temporary, html, 'utf8');
    await rename(temporary, target);
  }

  private fileFor(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('A scene key is a sha-256 in hex.');
    return path.join(this.dir, `${key}.html`);
  }
}

/**
 * Scenes in the platform's own storage, under the organisation that paid for them.
 *
 * What makes the animatic's scenes the master's: the preview and the film are
 * different jobs, possibly on different workers, and only storage both can
 * reach carries a scene from one to the other.
 */
export class StorageSceneStore implements AuthoredSceneStore {
  private readonly storage: StorageProvider;
  private readonly prefix: string;

  constructor(storage: StorageProvider, prefix: string) {
    if (!/^[A-Za-z0-9_/-]+$/.test(prefix)) throw new Error('A scene store prefix is a plain storage path.');
    this.storage = storage;
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | null> {
    const objectKey = this.keyFor(key);
    if (!(await this.storage.exists(objectKey))) return null;
    return Buffer.from(await this.storage.get(objectKey)).toString('utf8');
  }

  async put(key: string, html: string): Promise<void> {
    await this.storage.put(this.keyFor(key), new TextEncoder().encode(html), {
      contentType: 'text/html; charset=utf-8',
      visibility: 'private',
    });
  }

  private keyFor(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('A scene key is a sha-256 in hex.');
    return `${this.prefix.replace(/\/$/, '')}/${key}.html`;
  }
}
