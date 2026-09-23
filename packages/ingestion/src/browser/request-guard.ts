import type { BrowserContext, Request, Route } from 'playwright-core';
import { isPrivateAddress } from '@act-one/providers';

export type BlockedRequest = { url: string; reason: string };

/**
 * Why a request must not leave the browser, or null when it may.
 *
 * The navigation policy judges the page we were asked to read; this judges
 * every request that page makes, because a stylesheet, a font or a frame
 * pointed at the cloud metadata service is the same attack as a link to it,
 * and its body is exactly what the recorder would otherwise keep.
 */
export function unsafeRequestReason(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'unparseable address';
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `scheme ${url.protocol}`;
  if (url.username || url.password) return 'credentials in the address';
  if (isPrivateAddress(url.hostname)) return `private host ${url.hostname}`;
  return null;
}

/** Whether any hop of a redirect chain went somewhere it must not. */
export function redirectChainReason(request: Request): string | null {
  let current: Request | null = request;
  let hops = 0;
  while (current && hops < 25) {
    const reason = unsafeRequestReason(current.url());
    if (reason) return reason;
    current = current.redirectedFrom();
    hops += 1;
  }
  return hops >= 25 ? 'redirect chain too long' : null;
}

/**
 * Refuses private and non-web destinations for every request in the context.
 *
 * Routed through Playwright rather than a raw DevTools interception so that
 * out-of-process frames are covered too: a cross-site iframe runs in its own
 * renderer, and an interception on the page's own target never sees it.
 */
export async function guardRequests(
  context: BrowserContext,
  onBlocked: (blocked: BlockedRequest) => void,
): Promise<() => Promise<void>> {
  const handler = async (route: Route): Promise<void> => {
    const url = route.request().url();
    const reason = unsafeRequestReason(url);
    if (reason) {
      onBlocked({ url: url.slice(0, 500), reason });
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  };
  await context.route('**/*', handler);
  return async () => {
    await context.unroute('**/*', handler).catch(() => undefined);
  };
}
