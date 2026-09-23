import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BrowserbaseProvider, NullCostSink, policyForPublicResearch } from '../index.ts';

/**
 * Browserbase's documented surface, on loopback.
 *
 * The vendor's API is small: a key in `X-BB-API-Key`, the projects it can
 * see, a session created with a project and returned with a CDP address, and
 * a release. This is that surface as documented, and the provider is driven
 * against it — including a real browser behind the CDP address, so the
 * session it hands back is proved to browse, not just to have been created.
 */
const executablePath = [
  process.env.ACT_ONE_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
const HOST = 'product.acme.test';
const KEY = 'bb_live_test_key';

type Project = { id: string; name: string; concurrency: number; defaultTimeout: number };
type Call = { method: string; path: string; headers: IncomingMessage['headers']; body: unknown };

class FakeBrowserbase {
  calls: Call[] = [];
  projects: Project[] = [];
  /** Where a created session says its browser is. */
  connectUrl: string | null = null;
  /** False stands in for an egress proxy that adds the key on the way out. */
  requireKey = true;
  url = '';
  private server: Server | null = null;
  private counter = 0;

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** The same server, by the name Chromium is told resolves to loopback. */
  get origin(): string {
    return this.url.replace('127.0.0.1', HOST);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  reset(): void {
    this.calls = [];
    this.projects = [
      { id: 'proj_a', name: 'Act One research', concurrency: 3, defaultTimeout: 600 },
    ];
    this.connectUrl = null;
    this.requireKey = true;
    this.counter = 0;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const requestPath = new URL(request.url ?? '/', this.url).pathname;
    const method = request.method ?? 'GET';

    // The customer's site, for the session to browse.
    if (requestPath === '/page') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>',
      );
      return;
    }

    const body: unknown = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
    this.calls.push({ method, path: requestPath, headers: request.headers, body });
    if (this.requireKey && request.headers['x-bb-api-key'] !== KEY) {
      return json(response, 401, {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Unauthorized',
      });
    }

    if (method === 'GET' && requestPath === '/v1/projects')
      return json(response, 200, this.projects);
    const project = requestPath.match(/^\/v1\/projects\/([^/]+)$/);
    if (method === 'GET' && project?.[1]) {
      const found = this.projects.find((candidate) => candidate.id === project[1]);
      return found
        ? json(response, 200, found)
        : json(response, 404, {
            statusCode: 404,
            error: 'Not Found',
            message: 'Project not found',
          });
    }
    if (method === 'POST' && requestPath === '/v1/sessions') {
      const id = `sess_${++this.counter}`;
      return json(response, 201, {
        id,
        status: 'RUNNING',
        projectId: (body as { projectId?: string }).projectId,
        createdAt: new Date().toISOString(),
        ...(this.connectUrl ? { connectUrl: this.connectUrl } : {}),
      });
    }
    const session = requestPath.match(/^\/v1\/sessions\/([^/]+)$/);
    if (method === 'POST' && session?.[1]) {
      return json(response, 200, { id: session[1], status: 'COMPLETED' });
    }
    return json(response, 404, { statusCode: 404, error: 'Not Found', message: 'Not found' });
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/**
 * A Chromium with a DevTools endpoint, standing in for the vendor's browser:
 * the provider connects to whatever CDP address the session names.
 */
async function launchCdpChromium(): Promise<{
  child: ChildProcess;
  wsUrl: string;
  profile: string;
}> {
  const profile = mkdtempSync(path.join(tmpdir(), 'act-one-cdp-'));
  const child = spawn(
    executablePath!,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(
      () => reject(new Error(`Chromium gave no DevTools endpoint:\n${log}`)),
      20_000,
    );
    child.stderr!.on('data', (chunk: Buffer) => {
      log += chunk.toString();
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited with ${code}:\n${log}`));
    });
  });
  return { child, wsUrl, profile };
}

const ENV = ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'] as const;
const fake = new FakeBrowserbase();
const call = { organizationId: 'org_1', projectId: 'prj_1' };
let saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

function provider(
  overrides: ConstructorParameters<typeof BrowserbaseProvider>[0] = {},
): BrowserbaseProvider {
  return new BrowserbaseProvider({ apiKey: KEY, baseUrl: fake.url, ...overrides });
}

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  await fake.start();
});

afterAll(async () => {
  await fake.stop();
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

beforeEach(() => fake.reset());

describe('Browserbase', () => {
  it('finds the project from the key alone, and says which', async () => {
    const health = await provider().health();
    expect(health.healthy).toBe(true);
    expect(health.message).toBe('Project Act One research, 3 concurrent sessions.');
    expect(fake.calls).toEqual([expect.objectContaining({ method: 'GET', path: '/v1/projects' })]);
    expect(fake.calls[0]?.headers['x-bb-api-key']).toBe(KEY);
  });

  it('asks for the project ID only when the key reaches several', async () => {
    fake.projects.push({ id: 'proj_b', name: 'Marketing', concurrency: 1, defaultTimeout: 300 });

    const undecided = await provider().health();
    expect(undecided.healthy).toBe(false);
    expect(undecided.message).toMatch(/2 projects \(Act One research, Marketing\)/);
    expect(undecided.message).toMatch(/Project ID/);

    const chosen = await provider({ projectId: 'proj_b' }).health();
    expect(chosen.healthy).toBe(true);
    expect(chosen.message).toBe('Project Marketing, 1 concurrent session.');
    expect(fake.calls.at(-1)?.path).toBe('/v1/projects/proj_b');

    const wrong = await provider({ projectId: 'proj_nope' }).health();
    expect(wrong.healthy).toBe(false);
    expect(wrong.message).toMatch(/no such project/);
  });

  it('rejects a wrong key in words that do not contain it', async () => {
    const health = await provider({ apiKey: 'bb_live_wrong_key' }).health();
    expect(health.healthy).toBe(false);
    expect(health.message).toBe('[browserbase] Browserbase rejected the API key.');
    expect(health.message).not.toContain('wrong_key');
  });

  it('is unconfigured without a key', async () => {
    const media = new BrowserbaseProvider({ baseUrl: fake.url });
    expect(media.isConfigured()).toBe(false);
    expect((await media.health()).healthy).toBe(false);
    await expect(
      media.createSession(
        {
          policy: policyForPublicResearch([fake.origin]),
          projectId: 'prj_1',
          organizationId: 'org_1',
        },
        call,
      ),
    ).rejects.toThrow(/not configured/);
  });

  it('releases a session it cannot reach, records it as failed, and says so retryably', async () => {
    // A connect address nothing listens on: the vendor made the session, the
    // DevTools connection fails, and the session must not be left running.
    fake.connectUrl = 'ws://127.0.0.1:9/devtools/browser/gone';
    const sink = new NullCostSink();
    await expect(
      provider({ costSink: sink }).openPage({ projectId: 'prj_1', organizationId: 'org_1' }, call),
    ).rejects.toMatchObject({ retryable: true, message: expect.stringMatching(/Could not reach/) });

    const released = fake.calls.find((entry) => entry.method === 'POST' && entry.path === '/v1/sessions/sess_1');
    expect(released?.body).toEqual({ projectId: 'proj_a', status: 'REQUEST_RELEASE' });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ operation: 'browser.session', succeeded: false });
  });

  it('never creates a second session behind one that failed', async () => {
    fake.connectUrl = 'ws://127.0.0.1:9/devtools/browser/gone';
    await provider().openPage({ projectId: 'prj_1', organizationId: 'org_1' }, call).catch(() => undefined);
    expect(fake.calls.filter((entry) => entry.method === 'POST' && entry.path === '/v1/sessions')).toHaveLength(1);
  });

  describe('with the key added by the egress proxy', () => {
    it('is configured, and sends no key of its own', async () => {
      fake.requireKey = false;
      const proxied = new BrowserbaseProvider({ baseUrl: fake.url, keyFromProxy: true });
      expect(proxied.isConfigured()).toBe(true);
      expect((await proxied.health()).healthy).toBe(true);
      expect(fake.calls[0]?.headers['x-bb-api-key']).toBeUndefined();
    });

    it('refuses to guess a connect address it would need the key to build, and releases the session', async () => {
      fake.requireKey = false;
      const proxied = new BrowserbaseProvider({ baseUrl: fake.url, keyFromProxy: true });
      await expect(proxied.openPage({ projectId: 'prj_1', organizationId: 'org_1' }, call)).rejects.toMatchObject({
        retryable: false,
        message: expect.stringMatching(/no connect address/),
      });
      expect(fake.calls.some((entry) => entry.path === '/v1/sessions/sess_1')).toBe(true);
    });
  });

  describe.skipIf(!executablePath)('a session on the vendor browser', () => {
    let chrome: { child: ChildProcess; wsUrl: string; profile: string } | null = null;

    afterAll(() => {
      chrome?.child.kill('SIGKILL');
      if (chrome) rmSync(chrome.profile, { recursive: true, force: true });
    });

    it('hands over the page itself, and closes it exactly once', async () => {
      chrome ??= await launchCdpChromium();
      fake.connectUrl = chrome.wsUrl;
      const sink = new NullCostSink();
      const handle = await provider({ costSink: sink }).openPage(
        { projectId: 'prj_1', organizationId: 'org_1', viewport: { width: 1024, height: 700 } },
        call,
      );
      expect(handle.provider).toBe('browserbase');
      await handle.page.goto(`${fake.origin}/page`);
      expect(await handle.page.title()).toBe('Acme');
      expect(handle.page.viewportSize()).toEqual({ width: 1024, height: 700 });

      await Promise.all([handle.close(), handle.close()]);
      await handle.close();
      expect(fake.calls.filter((entry) => entry.path === `/v1/sessions/${handle.id}`)).toHaveLength(1);
      expect(sink.records).toHaveLength(1);
      // The vendor browser outlives our disconnect; only the release ends it.
      chrome.child.kill('SIGKILL');
      rmSync(chrome.profile, { recursive: true, force: true });
      chrome = null;
    }, 60_000);

    it('is created in the project, browses, is released early, and is billed by the minute', async () => {
      chrome = await launchCdpChromium();
      fake.connectUrl = chrome.wsUrl;
      const sink = new NullCostSink();
      const browserbase = provider({ costSink: sink, costPerMinuteUsd: 0.6 });

      const session = await browserbase.createSession(
        {
          policy: policyForPublicResearch([fake.origin], 4),
          projectId: 'prj_1',
          organizationId: 'org_1',
          viewport: { width: 1280, height: 800 },
          // Below the vendor's floor: asked for as the floor, not refused.
          timeoutMs: 5_000,
        },
        call,
      );

      const created = fake.calls.find(
        (entry) => entry.method === 'POST' && entry.path === '/v1/sessions',
      );
      expect(created?.body).toEqual({
        projectId: 'proj_a',
        browserSettings: {
          viewport: { width: 1280, height: 800 },
          blockAds: true,
          solveCaptchas: false,
        },
        timeout: 60,
        keepAlive: false,
      });

      await session.goto(`${fake.origin}/page`);
      expect(await session.currentUrl()).toBe(`${fake.origin}/page`);
      await session.close();

      const released = fake.calls.find(
        (entry) => entry.method === 'POST' && entry.path === `/v1/sessions/${session.id}`,
      );
      expect(released?.body).toEqual({ projectId: 'proj_a', status: 'REQUEST_RELEASE' });
      expect(sink.records).toHaveLength(1);
      expect(sink.records[0]).toMatchObject({
        provider: 'browserbase',
        operation: 'browser.session',
        unit: 'minute',
        metadata: { sessionId: session.id, projectId: 'prj_1' },
      });
      expect(sink.records[0]?.actualCostUsd).toBeGreaterThan(0);
    }, 60_000);
  });
});
