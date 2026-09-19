import { describe, it, expect, afterEach } from 'vitest';
import { proxyConfigured, proxyEnabledInNode, proxyMisconfiguration } from '../http.ts';

/**
 * Egress through a proxy.
 *
 * Node's `fetch` ignores `HTTPS_PROXY` unless the process was started with
 * `NODE_USE_ENV_PROXY=1`. A deployment behind an egress proxy without it
 * reaches its database and its own health check and cannot reach a single
 * provider — curl works, the app does not, and from inside the app the only
 * evidence is a 401 or a timeout two minutes into a customer's film.
 *
 * Handing the global `fetch` a dispatcher of our own instead was tried twice
 * and is why this is a check rather than a fix: a `ProxyAgent` from the
 * installed undici fails inside Node's bundled copy, and routing through the
 * installed undici's own `fetch` turns every multipart upload — a voice clone,
 * a transcription — into the string "[object FormData]".
 */
const KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY'] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function clear() {
  for (const key of KEYS) delete process.env[key];
}

describe('whether a proxy is in play', () => {
  it('says no when the environment names none', () => {
    clear();
    expect(proxyConfigured()).toBe(false);
    expect(proxyMisconfiguration()).toBeNull();
  });

  it('reads either case of either variable, as every other tool does', () => {
    clear();
    process.env['https_proxy'] = 'http://127.0.0.1:3128';
    expect(proxyConfigured()).toBe(true);

    delete process.env['https_proxy'];
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:3128';
    expect(proxyConfigured()).toBe(true);
  });
});

describe('the mismatch that looks like a broken provider', () => {
  it('complains when a proxy is configured and Node was not told to use it', () => {
    clear();
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:3128';
    expect(proxyEnabledInNode()).toBe(false);
    expect(proxyMisconfiguration()).toMatch(/NODE_USE_ENV_PROXY=1/);
  });

  it('is quiet once the process is started correctly', () => {
    clear();
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:3128';
    process.env['NODE_USE_ENV_PROXY'] = '1';
    expect(proxyEnabledInNode()).toBe(true);
    expect(proxyMisconfiguration()).toBeNull();
  });

  it('is quiet when there is no proxy at all, whatever the flag says', () => {
    clear();
    process.env['NODE_USE_ENV_PROXY'] = '1';
    expect(proxyMisconfiguration()).toBeNull();
  });
});
