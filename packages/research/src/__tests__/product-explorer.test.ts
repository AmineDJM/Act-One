import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { newId } from '@act-one/core';
import {
  PlaywrightSession,
  ScriptedLlmProvider,
  type BrowserAutomationProvider,
  type BrowserSession,
  type ProviderHealth,
  type SessionOptions,
} from '@act-one/providers';
import { ProductExplorer } from '../index.ts';

/**
 * The authenticated tour, on a real product with a real login.
 *
 * Nothing had ever run this path: no customer had handed over a login, so the
 * code that signs in as a guest in somebody's production account, looks for
 * moments and refuses to touch anything destructive had never executed. This
 * is a small product of our own — a sign-in form, an issue board with a
 * harmless action and a destructive one — served on loopback and reached
 * through the same navigation policy a customer's would be.
 */
const executablePath = [
  process.env.ACT_ONE_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
const HOST = 'app.acme.test';

const LOGIN = `<!doctype html><html><head><title>Sign in – Acme</title></head><body>
<h1>Sign in</h1>
<form method="post" action="/login">
  <label>Email <input type="email" name="email"></label>
  <label>Password <input type="password" name="password"></label>
  <button type="submit">Sign in</button>
</form></body></html>`;

const HOME = `<!doctype html><html><head><title>Acme</title></head><body>
<nav><a href="/app/issues">Issues</a> <a href="/app/billing">Billing</a> <a href="/app/settings">Settings</a></nav>
<main><h1>Welcome back</h1><p>12 issues need triage.</p></main></body></html>`;

const ISSUES = `<!doctype html><html><head><title>Issues – Acme</title></head><body style="font-family:sans-serif">
<main id="board" style="width:1200px;height:700px;background:#fff;padding:24px">
  <h1>Triage</h1>
  <button id="run">Run triage</button>
  <button id="delete-workspace">Delete workspace</button>
  <ul id="queue">
    <li>Login page times out</li><li>Export is empty</li><li>Wrong total on invoice</li>
  </ul>
  <p id="status">3 issues waiting</p>
</main>
<script>
  document.getElementById('run').addEventListener('click', () => {
    document.getElementById('queue').innerHTML = '';
    document.getElementById('status').textContent = '0 issues waiting — routed to owners';
    document.getElementById('board').style.background = '#eef6ff';
  });
  document.getElementById('delete-workspace').addEventListener('click', () => {
    document.body.innerHTML = '<h1>WORKSPACE DELETED</h1>';
  });
</script></body></html>`;

let server: Server;
let origin = '';
let browser: Browser;
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const signedIn = /session=ok/.test(req.headers.cookie ?? '');
    if (req.url === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('password') === 'correct horse battery staple') {
          res.writeHead(303, { 'set-cookie': 'session=ok; Path=/', location: '/app' });
        } else {
          res.writeHead(303, { location: '/login?error=1' });
        }
        res.end();
      });
      return;
    }
    if (req.url?.startsWith('/login')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(LOGIN);
      return;
    }
    if (!signedIn) {
      res.writeHead(303, { location: '/login' });
      res.end();
      return;
    }
    if (req.url === '/app') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HOME);
      return;
    }
    if (req.url === '/app/issues') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(ISSUES);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body><h1>${req.url}</h1><p>A page that should not be visited.</p></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  if (executablePath) {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
    });
  }
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A provider over the shared browser, with the fixture's DNS rule. */
class FixtureBrowser implements BrowserAutomationProvider {
  readonly name = 'fixture-chromium';
  readonly kind = 'browser' as const;
  readonly audit: { action: string; detail: string }[] = [];
  async health(): Promise<ProviderHealth> {
    return { provider: this.name, kind: 'browser', healthy: true, checkedAt: new Date().toISOString() };
  }
  async createSession(options: SessionOptions): Promise<BrowserSession> {
    const context = await browser.newContext({
      viewport: options.viewport ? { width: options.viewport.width, height: options.viewport.height } : undefined,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    return new PlaywrightSession({
      browser,
      context,
      page,
      policy: options.policy,
      audit: (event) => this.audit.push(event),
      ownsBrowser: false,
      id: newId('sec'),
    });
  }
}

describe.skipIf(!executablePath)('authenticated exploration', () => {
  it('signs in, films a real moment, and refuses the destructive one', async () => {
    const provider = new FixtureBrowser();
    const llm = new ScriptedLlmProvider([
      {
        when: /choosing which screens to visit/,
        respond: {
          targets: [
            { path: '/app/issues', why: 'Where the work happens', expectedMoment: 'Triage runs' },
            // Off-limits by the default policy: never planned, never visited.
            { path: '/app/billing', why: 'Curiosity', expectedMoment: 'Plans' },
          ],
        },
      },
      {
        when: /identifying filmable moments/,
        respond: {
          moments: [
            {
              title: 'Triage runs',
              description: 'Three waiting issues are routed to their owners.',
              startState: '3 issues waiting',
              endState: '0 issues waiting',
              focusSelector: '#board',
              steps: [{ action: 'click', selector: '#run', description: 'Run triage' }],
              wowScore: 0.8,
              relevanceScore: 0.9,
            },
            {
              title: 'Workspace removed',
              description: 'The whole workspace disappears.',
              startState: 'A workspace',
              endState: 'No workspace',
              focusSelector: '#board',
              steps: [{ action: 'click', selector: '#delete-workspace', description: 'Delete workspace' }],
              wowScore: 0.9,
              relevanceScore: 0.2,
            },
          ],
        },
      },
    ]);

    const audit: { action: string; detail: string }[] = [];
    const result = await new ProductExplorer(provider, llm).explore(
      {
        organizationId: 'org_1',
        projectId: 'prj_1',
        credentials: {
          loginUrl: `${origin}/login`,
          username: 'founder@acme.test',
          secret: 'correct horse battery staple',
          allowedPaths: ['/app'],
          deniedPaths: [],
        },
        productName: 'Acme',
        maxMoments: 5,
        onAudit: (event) => audit.push(event),
      },
      { organizationId: 'org_1', projectId: 'prj_1' },
    );

    // Signed in through the form, and the tour stayed inside what it was given.
    expect(audit.some((e) => e.action === 'session_open' && e.detail === 'Signed in.')).toBe(true);
    expect(requests.some((r) => r === 'GET /app/billing')).toBe(false);

    // The harmless moment was filmed with a before and an after that differ.
    const triage = result.moments.find((m) => m.title === 'Triage runs');
    expect(triage).toBeDefined();
    expect(triage!.captureKind).toBe('in_app');
    expect(triage!.interactionSteps).toEqual(['Run triage']);
    expect(triage!.endState).toBe('0 issues waiting');
    const capture = result.captures.get(triage!.id);
    expect(capture?.before.byteLength).toBeGreaterThan(1000);
    expect(capture?.after?.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(capture!.before).equals(Buffer.from(capture!.after!))).toBe(false);

    // The destructive one was refused in code, before the click, and said so.
    const removal = result.moments.find((m) => m.title === 'Workspace removed');
    expect(removal?.endState).toBe('A workspace');
    expect(result.captures.get(removal!.id)?.after).toBeNull();
    expect(audit.some((e) => e.action === 'blocked' && /delete/i.test(e.detail))).toBe(true);
    expect(requests.filter((r) => r.includes('/app/issues')).length).toBeGreaterThan(0);

    // And the session left nothing behind.
    expect(provider.audit.some((e) => e.action === 'session_close')).toBe(true);
  }, 120_000);
});
