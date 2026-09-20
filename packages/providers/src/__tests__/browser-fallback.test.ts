import { describe, it, expect } from 'vitest';
import { BrowserbaseProvider } from '../browser/browserbase.ts';
import { ProviderError, withFallback } from '../index.ts';
import type { SessionOptions } from '../browser/types.ts';

/**
 * A provider with no credentials is what a fallback is for.
 *
 * "Non-retryable failures are never retried on a second vendor — they will
 * fail identically and only cost more" is true of a bad key and false of no
 * key at all. A deployment with no Browserbase credentials and a working
 * Playwright fallback behind it got the throw instead of the fallback, so
 * research died at "Opening a browser" rather than crawling the public site
 * it had always been able to crawl.
 */
const session: SessionOptions = {
  policy: { allowedOrigins: ['https://example.com'], allowedPaths: [], deniedPaths: [], authenticated: false, maxPages: 1 },
  projectId: 'prj_1',
  organizationId: 'org_1',
};

describe('an unconfigured browser falls back rather than failing', () => {
  it('reports itself unconfigured, and says so retryably', async () => {
    const browserbase = new BrowserbaseProvider({ apiKey: '' });
    await expect(
      browserbase.createSession(session, { organizationId: 'org_1', projectId: 'prj_1' }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('reaches the fallback', async () => {
    const browserbase = new BrowserbaseProvider({ apiKey: '' });
    const ran = await withFallback(
      browserbase,
      { name: 'local-chromium' } as unknown as BrowserbaseProvider,
      async (provider) => {
        if (provider === browserbase) {
          await provider.createSession(session, { organizationId: 'org_1', projectId: 'prj_1' });
        }
        return provider.name;
      },
    );
    expect(ran).toBe('local-chromium');
  });

  it('still refuses to retry a real refusal on a second vendor', async () => {
    // The rule the flag was written for, which stays exactly as it was.
    await expect(
      withFallback(
        'primary',
        'fallback',
        async (provider) => {
          if (provider === 'primary') throw new ProviderError('x', 'Policy refusal.', { retryable: false });
          return provider;
        },
      ),
    ).rejects.toThrow('Policy refusal');
  });
});
