import { createHash } from 'node:crypto';
import { httpRequest } from '../http.ts';
import { ProviderError, type ProviderHealth } from '../types.ts';
import type { PutOptions, StorageProvider, StoredObject } from './types.ts';

export type SupabaseStorageConfig = {
  url?: string;
  serviceKey?: string;
  bucket?: string;
};

/**
 * Supabase Storage over its REST API.
 *
 * Deliberately not the supabase-js SDK: this is four endpoints, and going
 * direct keeps the dependency surface (and the bundle the worker ships) small
 * while reusing our own retry/redaction client.
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = 'supabase-storage';
  readonly kind = 'storage' as const;

  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly bucket: string;

  constructor(config: SupabaseStorageConfig = {}) {
    this.baseUrl = (config.url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    this.serviceKey = config.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    this.bucket = config.bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? 'act-one';
  }

  /** An object store both services reach over the network. */
  readonly shared = true;

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.serviceKey.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        kind: 'storage',
        healthy: false,
        checkedAt,
        message: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.',
      };
    }
    try {
      await httpRequest(this.name, `${this.baseUrl}/storage/v1/bucket/${this.bucket}`, {
        headers: this.headers(),
        timeoutMs: 10_000,
        attempts: 1,
      });
      return { provider: this.name, kind: 'storage', healthy: true, checkedAt };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'storage',
        healthy: false,
        checkedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async put(key: string, data: Uint8Array, options: PutOptions = {}): Promise<StoredObject> {
    this.assertConfigured();
    await httpRequest(this.name, `${this.objectUrl(key)}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'content-type': options.contentType ?? 'application/octet-stream',
        'cache-control': options.cacheControl ?? 'max-age=31536000',
        'x-upsert': 'true',
      },
      body: data,
      timeoutMs: 300_000,
      attempts: 3,
    });

    return {
      key,
      bytes: data.byteLength,
      contentType: options.contentType ?? 'application/octet-stream',
      checksum: createHash('sha256').update(data).digest('hex'),
      url:
        options.visibility === 'public'
          ? `${this.baseUrl}/storage/v1/object/public/${this.bucket}/${key}`
          : null,
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
    this.assertConfigured();
    return httpRequest<Uint8Array>(this.name, this.objectUrl(key), {
      headers: this.headers(),
      expect: 'buffer',
      timeoutMs: 120_000,
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await httpRequest(this.name, this.objectUrl(key), {
        method: 'HEAD',
        headers: this.headers(),
        attempts: 1,
        timeoutMs: 15_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    this.assertConfigured();
    await httpRequest(this.name, this.objectUrl(key), {
      method: 'DELETE',
      headers: this.headers(),
      timeoutMs: 30_000,
    });
  }

  async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    this.assertConfigured();
    const response = await httpRequest<{ signedURL?: string; signedUrl?: string }>(
      this.name,
      `${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${encodeKey(key)}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: { expiresIn: expiresInSeconds },
        timeoutMs: 20_000,
      },
    );
    const signed = response.signedURL ?? response.signedUrl;
    if (!signed) throw new ProviderError(this.name, 'No signed URL returned.');
    return signed.startsWith('http') ? signed : `${this.baseUrl}/storage/v1${signed}`;
  }

  async list(prefix: string): Promise<string[]> {
    this.assertConfigured();
    const response = await httpRequest<{ name: string }[]>(
      this.name,
      `${this.baseUrl}/storage/v1/object/list/${this.bucket}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: { prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } },
        timeoutMs: 30_000,
      },
    );
    return response.map((item) => `${prefix.replace(/\/$/, '')}/${item.name}`);
  }

  private objectUrl(key: string): string {
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${encodeKey(key)}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'Supabase storage is not configured.', {
        retryable: false,
      });
    }
  }
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
