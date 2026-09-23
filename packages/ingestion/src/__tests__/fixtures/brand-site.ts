import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * A small brand site with the difficulties real ones have: its type from a
 * cross-origin CDN, its logo drawn from a sprite with a gradient defined
 * elsewhere and a fill set by a class, cards that only appear once scrolled
 * to, a floating widget over the content, a cookie banner, and two requests
 * aimed at addresses nothing may reach.
 *
 * Served on loopback under two made-up hostnames that Chromium is told
 * resolve there, so the run goes through every guard exactly as it would for
 * a customer.
 */
export const SITE_HOST = 'brand.acme.test';
export const CDN_HOST = 'cdn.acme.test';

const font = (weight: number) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`, import.meta.url)),
  );

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 L30 30 L2 30 Z" fill="#3981f6"/></svg>';

/**
 * `hiddenSprite` puts the sprite in a `display:none` svg, which is how a site
 * breaks its own logo: Chromium does not paint a gradient that lives inside
 * a display:none subtree, so the page shows a mark without its bar.
 */
function page(port: number, hiddenSprite = false): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Acme — Close the books while you sleep</title>
<meta property="og:site_name" content="Acme">
<meta name="theme-color" content="#3981f6">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="http://${CDN_HOST}:${port}/brand.css">
<link rel="stylesheet" href="http://169.254.169.254/latest/meta-data.css">
<style>
  body { margin: 0; font-family: "Acme Sans", system-ui, sans-serif; color: rgb(17, 17, 19); background: #ffffff; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 20px 48px; }
  .logo-mark { fill: var(--brand); }
  .hero { padding: 120px 48px; background: linear-gradient(180deg, #f6f7fb, #ffffff); min-height: 480px; }
  h1 { font-size: 72px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; margin: 0 0 24px; }
  .btn { display: inline-block; padding: 14px 24px; border-radius: 999px; font-weight: 600; font-size: 16px; text-decoration: none; }
  .btn-primary { background: var(--brand); color: #ffffff; }
  .btn-secondary { border: 1px solid rgba(0, 0, 0, 0.15); color: rgb(17, 17, 19); }
  .cards { display: grid; grid-template-columns: repeat(3, 320px); gap: 24px; padding: 80px 48px; }
  .card { background: #ffffff; border-radius: 16px; box-shadow: 0 0 0 1px rgba(17, 17, 19, 0.06), 0 12px 32px rgba(0, 0, 0, 0.18); padding: 28px; opacity: 0; transform: translateY(24px); transition: opacity 0.6s, transform 0.6s; }
  .card.visible { opacity: 1; transform: none; }
  .card h3 { margin: 0 0 8px; font-size: 20px; }
  .chat { position: fixed; left: 120px; top: 50%; width: 64px; height: 64px; border-radius: 50%; background: rgb(255, 0, 255); }
  .cookie-banner { position: fixed; left: 0; right: 0; bottom: 0; height: 90px; background: rgb(0, 255, 0); }
  code { font-family: Menlo, "SF Mono", monospace; }
  footer { padding: 40px 48px; }
</style></head>
<body>
<svg style="${hiddenSprite ? 'display:none' : 'position:absolute;width:0;height:0;overflow:hidden'}" aria-hidden="true">
  <symbol id="acme-glyph" viewBox="0 0 32 32"><path class="logo-mark" d="M16 2 L30 30 L2 30 Z"/></symbol>
  <linearGradient id="acme-shine" x1="0" x2="1"><stop offset="0" stop-color="#ff5a1f"/><stop offset="1" stop-color="#3981f6"/></linearGradient>
</svg>
<header>
  <a href="/" aria-label="Acme home" class="brand-link">
    <svg class="site-logo" width="132" height="32" viewBox="0 0 132 32" role="img" aria-label="Acme">
      <use href="#acme-glyph" width="32" height="32"/>
      <rect x="40" y="8" width="88" height="16" rx="4" fill="url(#acme-shine)"/>
    </svg>
  </a>
  <nav><a href="/pricing">Pricing</a> <a class="btn btn-primary" href="/signup">Start free</a></nav>
</header>
<main>
  <section class="hero">
    <h1>Close the books while you sleep.</h1>
    <p>Acme reconciles every transaction the moment it lands, so month-end is a formality.</p>
    <a class="btn btn-primary" href="/signup">Start free</a>
    <a class="btn btn-secondary" href="/demo">Book a demo</a>
    <iframe src="http://127.0.0.1:1/" width="10" height="10" title="blocked"></iframe>
  </section>
  <section class="cards">
    <article class="card"><h3>Reconcile</h3><p>Every payout matched to its invoices, automatically.</p></article>
    <article class="card"><h3>Close</h3><p>Month-end in minutes, with an audit trail for each entry.</p></article>
    <article class="card"><h3>Report</h3><p>Board-ready numbers the moment the books close.</p></article>
  </section>
  <p>Use <code>acme sync</code> to connect your ledger.</p>
</main>
<footer><a href="https://twitter.com/acme"><svg width="20" height="20"><circle cx="10" cy="10" r="9"/></svg></a></footer>
<div class="chat" aria-label="Chat"></div>
<div class="cookie-banner">We use cookies</div>
<script>
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add('visible');
  }, { threshold: 0.2 });
  document.querySelectorAll('.card').forEach((card) => io.observe(card));
</script>
</body></html>`;
}

const STYLESHEET = `
:root { --brand: oklch(0.62 0.19 259.8); --color-red-500: oklch(0.637 0.237 25.331); --radius: 16px; }
@font-face { font-family: "Acme Sans"; src: url(/fonts/acme-sans-400.woff2) format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: "Acme Sans"; src: url(/fonts/acme-sans-600.woff2) format("woff2"); font-weight: 600; font-display: block; }
@font-face { font-family: "Acme Sans"; src: url(/fonts/acme-sans-700.woff2) format("woff2"); font-weight: 700; font-display: block; }
`;

export type BrandSite = { origin: string; port: number; close: () => Promise<void> };

export async function startBrandSite(): Promise<BrandSite> {
  const fonts: Record<string, Buffer> = {
    '/fonts/acme-sans-400.woff2': font(400),
    '/fonts/acme-sans-600.woff2': font(600),
    '/fonts/acme-sans-700.woff2': font(700),
  };
  const hanging = new Set<import('node:http').ServerResponse>();
  let port = 0;
  const server: Server = createServer((request, response) => {
    const host = (request.headers.host ?? '').split(':')[0];
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
      response.end(body);
    };
    if (host === CDN_HOST) {
      if (path === '/brand.css') return send(200, 'text/css', STYLESHEET, { 'access-control-allow-origin': '*' });
      const file = fonts[path];
      if (file) return send(200, 'font/woff2', file, { 'access-control-allow-origin': '*' });
      return send(404, 'text/plain', 'not found');
    }
    switch (path) {
      case '/':
        return send(200, 'text/html; charset=utf-8', page(port));
      case '/hidden-sprite':
        return send(200, 'text/html; charset=utf-8', page(port, true));
      case '/favicon.svg':
        return send(200, 'image/svg+xml', FAVICON);
      case '/missing':
        return send(404, 'text/html', '<html><body><h1>Not found</h1></body></html>');
      case '/blank':
        return send(200, 'text/html', '<!doctype html><html><head><title>Blank</title></head><body></body></html>');
      case '/redirect-private':
        return send(302, 'text/plain', '', { location: 'http://127.0.0.1:1/' });
      case '/hang':
        hanging.add(response);
        return;
      default:
        return send(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    origin: `http://${SITE_HOST}:${port}`,
    port,
    close: async () => {
      for (const response of hanging) response.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
