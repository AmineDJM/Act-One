import type { Provider } from '../types.ts';

export type PutOptions = {
  contentType?: string;
  cacheControl?: string;
  /** Public assets are served to the customer's browser; masters are not. */
  visibility?: 'private' | 'public';
  metadata?: Record<string, string>;
};

export type StoredObject = {
  key: string;
  bytes: number;
  contentType: string;
  checksum: string;
  url: string | null;
};

/**
 * Every captured, generated or rendered byte lands here under our own control.
 * Provider URLs expire, get rotated, or disappear with an account; a film that
 * cannot be re-rendered in six months because a vendor garbage-collected its
 * CDN is not a deliverable.
 */
export interface StorageProvider extends Provider {
  readonly kind: 'storage';
  put(key: string, data: Uint8Array, options?: PutOptions): Promise<StoredObject>;
  /** Copies a provider-hosted URL into our storage. Returns our object. */
  ingestFromUrl(key: string, url: string, options?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Short-lived read URL for private objects. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  list(prefix: string): Promise<string[]>;
}
