import 'server-only';
import type { StorageProvider } from '@act-one/providers';
import { readProviderCredentials } from './platform.ts';

let cached: StorageProvider | null = null;

/**
 * The storage the app reads customer assets back out of.
 *
 * Deliberately separate from buildRegistry, which constructs an LLM, a browser
 * and a media provider for a rendering job. Serving one finished film back to
 * the person it belongs to should not stand up half the pipeline.
 */
export async function getStorage(): Promise<StorageProvider> {
  if (cached) return cached;

  const supabase = await readProviderCredentials('supabase');
  const { SupabaseStorageProvider, LocalFsStorageProvider } = await import('@act-one/providers');

  cached =
    supabase['url'] && supabase['serviceKey']
      ? new SupabaseStorageProvider({
          url: supabase['url'],
          serviceKey: supabase['serviceKey'],
          bucket: supabase['bucket'],
        })
      : new LocalFsStorageProvider();

  return cached;
}
