import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { PlaywrightSession, policyForPublicResearch, type PageCapture } from '../index.ts';

/**
 * Which picture on a page is the brand's mark, read in a real browser.
 *
 * The probe runs inside the customer's page, so it is tested there. The pages
 * are the shapes that went wrong: kde.org paints its logo as a CSS background
 * on the link home and keeps a search glass in the same header as an <svg>
 * that only points at a sprite symbol — copied alone, that <svg> draws
 * nothing, and it was the film's "logo". Served on a made-up hostname that
 * Chromium resolves to loopback, so the session passes the navigation policy
 * exactly as it does for a customer.
 */
const executablePath = [
  process.env.ACT_ONE_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
const HOST = 'www.acme.test';

const svgUrl = (markup: string): string => `data:image/svg+xml,${encodeURIComponent(markup)}`;
const WORDMARK = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32"><rect width="32" height="32" rx="6" fill="#1d99f3"/><rect x="40" y="10" width="76" height="12" fill="#232629"/></svg>`,
);
const FLAG = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#c00"/></svg>`);
const SPRITE = `<svg style="display:none"><symbol id="search-icon" viewBox="0 0 16 16"><path d="M11.7 10.3a6.5 6.5 0 1 0-1.4 1.4l3.9 3.9 1.4-1.4z"/></symbol></svg>`;

const PAGES: Record<string, string> = {
  // kde.org's header, reduced to what matters.
  '/background': `<!doctype html><html><head><title>Plasma - Acme Community</title><style>
    body { margin: 0; font-family: sans-serif; }
    .acme-logo { display: block; width: 120px; height: 32px; background: url("${WORDMARK}") no-repeat; }
    nav { display: flex; align-items: center; gap: 24px; padding: 16px; }
  </style></head><body>
  <header><nav>
    <a class="acme-logo navbar-brand" href="/"><span style="position:absolute;left:-9999px">Home</span></a>
    <a href="/products/">Products</a>
    ${SPRITE}
    <a role="button" aria-label="Search" style="margin-left:auto"><svg class="bi theme-icon" width="20" height="20"><use href="#search-icon"/></svg></a>
    <a href="#"><img src="${FLAG}" alt="" width="24" height="24"></a>
    <svg width="40" height="40" class="decoration"><use href="#no-such-symbol"/></svg>
  </nav></header>
  <main><h1>One absolutely massive release</h1></main></body></html>`,

  // A mark drawn from a sprite symbol, filled with a gradient defined elsewhere in the page.
  '/sprite': `<!doctype html><html><head><title>Acme</title></head><body style="margin:0;font-family:sans-serif">
  <svg width="0" height="0" style="position:absolute">
    <defs><linearGradient id="acme-ink"><stop offset="0" stop-color="#ff3d00"/><stop offset="1" stop-color="#ffb300"/></linearGradient></defs>
    <symbol id="acme-mark" viewBox="0 0 140 32"><rect width="140" height="32" rx="8" fill="url(#acme-ink)"/></symbol>
  </svg>
  <header style="display:flex;justify-content:space-between;padding:16px">
    <a href="https://acme.test/en/" aria-label="Acme home"><svg width="140" height="32"><use href="#acme-mark"/></svg></a>
    <button class="menu-toggle" aria-label="Open menu"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
  </header>
  <main><h1>Ship it</h1></main></body></html>`,

  // An <img> logo, a broken picture and an account avatar in the same header.
  '/image': `<!doctype html><html><head><title>Acme</title></head><body style="margin:0;font-family:sans-serif">
  <header style="display:flex;justify-content:space-between;padding:16px">
    <img src="/missing.png" alt="Acme" width="120" height="32">
    <a href="/"><img src="${WORDMARK}" alt="Acme" width="120" height="32"></a>
    <img src="${FLAG}" class="user-avatar" alt="Your account" width="32" height="32">
  </header>
  <main><h1>Ship it</h1></main></body></html>`,
};

let server: Server;
let origin = '';
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const page = PAGES[req.url ?? ''];
    res.writeHead(page ? 200 : 404, { 'content-type': page ? 'text/html' : 'text/plain' });
    res.end(page ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  if (executablePath) {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOST} 127.0.0.1, MAP acme.test 127.0.0.1`],
    });
  }
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function capture(pathname: string): Promise<{ capture: PageCapture; inked: (src: string) => Promise<number> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const session = new PlaywrightSession({ browser, context, page, policy: policyForPublicResearch([origin], 4), ownsBrowser: false });
  await session.goto(`${origin}${pathname}`);
  const result = await session.capture({ hideChrome: false });
  // How many pixels a candidate paints once it is a file of its own, drawn by the browser.
  const inked = (src: string) =>
    page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || 140;
      canvas.height = image.naturalHeight || 32;
      const context2d = canvas.getContext('2d')!;
      context2d.drawImage(image, 0, 0, canvas.width, canvas.height);
      const { data } = context2d.getImageData(0, 0, canvas.width, canvas.height);
      let painted = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index]! > 16) painted += 1;
      return painted;
    }, src);
  return { capture: result, inked };
}

describe.skipIf(!executablePath)('logo candidates', () => {
  it('finds a mark painted as a background on the link home, and never the search glass', async () => {
    const { capture: page } = await capture('/background');
    const logos = page.styleProfile?.logoCandidates ?? [];
    expect(logos[0]?.src).toBe(WORDMARK);
    expect(logos[0]?.score).toBeGreaterThan(0);
    // The sprite glass, the flag of the language picker, and the <svg> whose symbol does not exist.
    expect(logos).toHaveLength(1);
  }, 60_000);

  it('carries a sprite symbol and its gradient with an inline mark, so the copy draws what the page shows', async () => {
    const { capture: page, inked } = await capture('/sprite');
    const logos = page.styleProfile?.logoCandidates ?? [];
    expect(logos).toHaveLength(1);
    const markup = decodeURIComponent(logos[0]!.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    expect(markup).toContain('id="acme-mark"');
    expect(markup).toContain('id="acme-ink"');
    expect(await inked(logos[0]!.src)).toBeGreaterThan(140 * 32 * 0.8);
  }, 60_000);

  it('passes over a broken picture and an avatar for the image that links home', async () => {
    const { capture: page } = await capture('/image');
    const logos = page.styleProfile?.logoCandidates ?? [];
    expect(logos.map((logo) => logo.src)).toEqual([WORDMARK]);
  }, 60_000);
});
