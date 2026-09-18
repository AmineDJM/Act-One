import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
  private server: Server | null = null;
  private origin: Promise<string> | null = null;
  /** Token -> what it may read, and until when. */
  private readonly grants = new Map<string, { key: string; expiresAt: number }>();

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

  /**
   * A URL a browser on this machine can load, for as long as it is valid.
   *
   * This returned `file://` paths, and the first film with a real product
   * capture in it failed to render: the renderer's page is served over HTTP,
   * and a page served over HTTP is not allowed to load a local file, so the
   * browser refused the image. Nothing had ever noticed because no film had
   * ever carried an asset. The provider now serves its own directory on a
   * loopback port, with a random token per grant that expires with the URL —
   * the same contract the object-storage provider gives the renderer.
   */
  async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    const origin = await this.serve();
    const token = randomBytes(18).toString('base64url');
    this.grants.set(token, { key, expiresAt: Date.now() + expiresInSeconds * 1000 });
    if (this.grants.size > 2000) this.sweepGrants();
    return `${origin}/${token}/${encodeURIComponent(path.basename(key))}`;
  }

  /** Stops serving. Grants already issued stop working; nothing else changes. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.origin = null;
    this.grants.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private serve(): Promise<string> {
    if (this.origin) return this.origin;
    this.origin = new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => this.handle(request, response));
      // Never the reason the process stays up: a worker draining its last job
      // should exit, and a test should not hang on an idle listener.
      server.unref();
      server.once('error', (error) => {
        this.origin = null;
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Local storage server did not bind to a port.'));
          return;
        }
        this.server = server;
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return this.origin;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const token = (request.url ?? '').split('/')[1] ?? '';
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt < Date.now() || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404).end();
      return;
    }
    const file = this.resolve(grant.key);
    stat(file).then(
      (info) => {
        response.writeHead(200, {
          'content-type': contentTypeFor(file),
          'content-length': String(info.size),
          'cache-control': 'private, max-age=0',
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(file).on('error', () => response.destroy()).pipe(response);
      },
      () => response.writeHead(404).end(),
    );
  }

  private sweepGrants(): void {
    const now = Date.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt < now) this.grants.delete(token);
    }
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

function contentTypeFor(file: string): string {
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
  };
  return types[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
