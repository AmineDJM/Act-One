import { describe, it, expect, afterEach, vi } from 'vitest';
import { PgStore } from '@act-one/db';
import { GET } from '../../app/api/health/route.ts';

/**
 * The health check a deploy is judged by.
 *
 * The first production deploy answered every page and could not create an
 * account: nothing had run the migrations, and the host's health check only
 * asked whether the process answered HTTP. This is the check that would have
 * failed that deploy, so it is proved against the three states a database can
 * be in — current, present but without the schema, and unreachable — and
 * against the one thing it must never do, which is print how the database is
 * reached.
 */
const url = process.env.ACT_ONE_TEST_DATABASE_URL;

function useDatabase(connectionString: string | undefined): void {
  globalThis.__actOneStore = undefined;
  globalThis.__actOneDb = undefined;
  if (connectionString) process.env.DATABASE_URL = connectionString;
  else delete process.env.DATABASE_URL;
}

async function check(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /api/health', () => {
  const original = process.env.DATABASE_URL;
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(async () => {
    const store = globalThis.__actOneStore;
    if (store instanceof PgStore) await store.close();
    useDatabase(original);
    restoreEgress();
    logged.mockClear();
  });

  /** Sets the egress environment for one test, and remembers how to put it back. */
  const EGRESS_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY'] as const;
  let savedEgress: Record<string, string | undefined> | null = null;

  function withEgressConfigured(apply: () => void): void {
    savedEgress ??= Object.fromEntries(EGRESS_KEYS.map((key) => [key, process.env[key]]));
    for (const key of EGRESS_KEYS) delete process.env[key];
    apply();
  }

  function restoreEgress(): void {
    if (!savedEgress) return;
    for (const key of EGRESS_KEYS) {
      const value = savedEgress[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEgress = null;
  }

  it('reports the in-memory store as development only', async () => {
    useDatabase(undefined);
    const { status, body } = await check();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, store: 'memory' });
  });

  it.skipIf(!url)('passes a database whose schema matches the code', async () => {
    useDatabase(url);
    // This machine may well be behind a proxy; the egress check below is what
    // that case is for, and it must not decide this one.
    withEgressConfigured(() => undefined);
    const { status, body } = await check();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, store: 'postgres' });
  });

  it.skipIf(!url)('fails a service that cannot reach its providers, and says why', async () => {
    /*
     * The quietest deployment failure there is: a proxy configured for the
     * machine that Node was not told to use. The database works, the health
     * check works, and the first provider call two minutes into a customer's
     * film comes back 401. Healthy has to mean "can make a film".
     */
    useDatabase(url);
    withEgressConfigured(() => {
      process.env['HTTPS_PROXY'] = 'http://127.0.0.1:3128';
      delete process.env['NODE_USE_ENV_PROXY'];
    });
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(body.reason).toMatch(/NODE_USE_ENV_PROXY=1/);
  });

  it.skipIf(!url)('passes once the process is started to use the proxy', async () => {
    useDatabase(url);
    withEgressConfigured(() => {
      process.env['HTTPS_PROXY'] = 'http://127.0.0.1:3128';
      process.env['NODE_USE_ENV_PROXY'] = '1';
    });
    const { status } = await check();
    expect(status).toBe(200);
  });

  it.skipIf(!url)('fails a database that has no schema, and says what to run', async () => {
    // The same server, with no tables visible: what a fresh database looks
    // like to the code before anything has migrated it.
    useDatabase(`${url}${url!.includes('?') ? '&' : '?'}options=-c%20search_path%3Dnowhere`);
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/no schema/);
    expect(body.reason).toMatch(/npm run migrate/);
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^\[health\] The database has no schema/));
  });

  it('fails a database it cannot reach, without printing how it tried', async () => {
    const secret = 'postgresql://nobody:hunter2@127.0.0.1:1/nothing';
    useDatabase(secret);
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(body).toEqual({
      ok: false,
      store: 'postgres',
      reason: 'The database cannot be reached with the configured DATABASE_URL.',
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    for (const call of logged.mock.calls) {
      expect(String(call[0])).not.toContain('hunter2');
    }
  });
});
