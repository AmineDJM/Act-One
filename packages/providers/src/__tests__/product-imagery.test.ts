import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { PlaywrightSession, policyForPublicResearch } from '../index.ts';

/**
 * A real page in a real browser: the product imagery probe runs inside the
 * customer's page, and a unit test of its logic in Node would test a copy.
 *
 * The fixture is served on loopback, which the navigation policy refuses on
 * purpose. Rather than punch a hole in the guard for tests, Chromium is told
 * to resolve a made-up hostname to loopback, and the session goes through the
 * guard exactly as it does for a customer.
 */
const executablePath = [
  process.env.ACT_ONE_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  // Wherever `playwright-core install chromium` put it, which is what CI runs.
  chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
const HOST = 'fixture.acme.test';

// A 1400x900 SVG "screenshot" of an interface: toolbar, sidebar, rows.
const APP_SHOT = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">` +
    `<rect width="1400" height="900" fill="#ffffff"/>` +
    `<rect width="1400" height="48" fill="#1c1e24"/>` +
    `<rect width="220" y="48" height="852" fill="#f4f5f7"/>` +
    Array.from(
      { length: 16 },
      (_, i) => `<rect x="260" y="${90 + i * 48}" width="${300 + ((i * 97) % 600)}" height="12" fill="#2a2c32"/>`,
    ).join('') +
    `</svg>`,
);
const PLAIN = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#d0a080"/></svg>`,
);

const PAGE = `<!doctype html><html><head><title>Acme</title></head><body style="margin:0;font-family:sans-serif">
<header style="height:64px;background:#111"><img src="data:image/svg+xml,${PLAIN}" alt="Acme logo" width="120" height="32"></header>
<main>
  <section style="padding:40px">
    <h1>Close the books while you sleep</h1>
    <img id="hero" src="data:image/svg+xml,${APP_SHOT}" alt="The Acme reconciliation dashboard" style="width:1100px;height:707px;display:block">
  </section>
  <section style="padding:40px">
    <img src="data:image/svg+xml,${PLAIN}" alt="Portrait of our founder" style="width:900px;height:600px;display:block">
    <img src="data:image/svg+xml,${APP_SHOT}" alt="Small thumbnail" style="width:300px;height:193px;display:block">
  </section>
  <div style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#222;color:#fff">Sticky bar</div>
</main>
<footer><img src="data:image/svg+xml,${APP_SHOT}" alt="Footer decoration" style="width:1100px;height:707px"></footer>
</body></html>`;

let server: Server;
let origin = '';
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Not found</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
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

async function open(): Promise<PlaywrightSession> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  return new PlaywrightSession({
    browser,
    context,
    page,
    policy: policyForPublicResearch([origin], 4),
    ownsBrowser: false,
  });
}

describe.skipIf(!executablePath)('product imagery capture', () => {
  it('captures the product image on the page and nothing that is not the product', async () => {
    const session = await open();
    try {
      await session.goto(`${origin}/`);
      const capture = await session.capture({ hideChrome: true, productImages: 3 });

      expect(capture.statusCode).toBe(200);
      const images = capture.productImages ?? [];
      // The hero interface: yes. The portrait (by its own label), the
      // thumbnail (too small), the logo (in the header) and the footer image
      // (in the footer): no.
      expect(images.map((image) => image.alt)).toEqual(['The Acme reconciliation dashboard']);
      expect(images[0]!.width).toBe(1100);
      expect(images[0]!.bytes.byteLength).toBeGreaterThan(1000);
    } finally {
      await session.close();
    }
  }, 60_000);

  it('reports the real status of an error page', async () => {
    const session = await open();
    try {
      await session.goto(`${origin}/missing`);
      const capture = await session.capture({ hideChrome: true });
      expect(capture.statusCode).toBe(404);
    } finally {
      await session.close();
    }
  }, 60_000);
});
