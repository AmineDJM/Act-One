import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '@act-one/core';
import { httpRequest } from '../http.ts';
import type { ProviderHealth } from '../types.ts';
import type { PutOptions, StorageProvider, StoredObject } from './types.ts';

/**
 * Filesystem storage. Used for local development, CI, and self-hosted
 * deployments; the render worker also uses it as scratch space before objects
 * are promoted to durable storage.
 */
export class LocalFsStorageProvider implements StorageProvider {
  readonly name = 'local-fs';
  readonly kind = 'storage' as const;

  private readonly root: string;
  private readonly publicBaseUrl: string | null;

  constructor(options: { root?: string; publicBaseUrl?: string } = {}) {
    this.root = path.resolve(
      options.root ?? process.env.ACT_ONE_STORAGE_DIR ?? '.act-one-storage',
    );
    this.publicBaseUrl = options.publicBaseUrl ?? process.env.ACT_ONE_STORAGE_URL ?? null;
  }

  async health(): Promise<ProviderHealth> {
    try {
      await mkdir(this.root, { recursive: true });
      return {
        provider: this.name,
        kind: 'storage',
        healthy: true,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'storage',
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async put(key: string, data: Uint8Array, options: PutOptions = {}): Promise<StoredObject> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return {
      key,
      bytes: data.byteLength,
      contentType: options.contentType ?? 'application/octet-stream',
      checksum: checksum(data),
      url: this.publicBaseUrl ? `${this.publicBaseUrl.replace(/\/$/, '')}/${key}` : null,
    };
  }

  async ingestFromUrl(key: string, url: string, options: PutOptions = {}): Promise<StoredObject> {
    const data = await httpRequest<Uint8Array>(this.name, url, {
      expect: 'buffer',
      timeoutMs: 300_000,
      attempts: 3,
    });
    return this.put(key, data, options);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async signedUrl(key: string): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    return `file://${this.resolve(key)}`;
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolve(prefix);
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        const info = await stat(full);
        if (info.isDirectory()) await walk(full);
        else results.push(path.relative(this.root, full));
      }
    };
    await walk(base);
    return results;
  }

  /**
   * Path traversal guard. Storage keys are built from tenant ids, so a key that
   * escapes the root would be a cross-tenant read.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (target !== this.root && !target.startsWith(rootWithSep)) {
      throw new AppError('unsafe_operation', `Storage key escapes the storage root: ${key}`);
    }
    return target;
  }
}

function checksum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
