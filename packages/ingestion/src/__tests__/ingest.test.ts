import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BrowserAutomationProvider,
  BrowserSession,
  PageAccess,
  PageHandle,
  PageOptions,
  ProviderHealth,
} from '@act-one/providers';
import { ingestBrand, type IngestionResult } from '../engine.ts';
import { IngestionError } from '../errors.ts';
import { silentLogger } from '../logger.ts';
import { BrandIngestion } from '../schema.ts';
import { sanitizeSvg } from '../svg/sanitize-svg.ts';
import { CDN_HOST, SITE_HOST, startBrandSite, type BrandSite } from './fixtures/brand-site.ts';

/**
 * The whole engine, in a real browser, against a real page.
 *
 * The probes run inside the page and the captures come from the renderer, so
 * nothing short of this proves them. The browser is a local Chromium told that
 * the fixture's made-up hostnames resolve to loopback: every request still
 * goes through the request guard and the navigation policy as a customer's
 * would.
 */
const executablePath = [process.env.ACT_ONE_CHROMIUM_PATH, '/opt/pw-browsers/chromium', chromium.executablePath()].find(
  (candidate): candidate is string => Boolean(candidate) && existsSync(candidate!),
);

class FixtureBrowser implements BrowserAutomationProvider, PageAccess {
  readonly name = 'fixture-chromium';
  readonly kind = 'browser' as const;
  opened = 0;
  closed = 0;

  async health(): Promise<ProviderHealth> {
    return { provider: this.name, kind: 'browser', healthy: true, checkedAt: new Date().toISOString() };
  }

  async createSession(): Promise<BrowserSession> {
    throw new Error('The engine asks for pages, not sessions.');
  }

  async openPage(options: PageOptions): Promise<PageHandle> {
    const browser = await chromium.launch({
      executablePath: executablePath!,
      headless: true,
      args: ['--disable-dev-shm-usage', `--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1, MAP ${CDN_HOST} 127.0.0.1`],
    });
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    this.opened += 1;
    let closing: Promise<void> | null = null;
    return {
      id: `fixture-${this.opened}`,
      provider: this.name,
      browser,
      context,
      page,
      close: () =>
        (closing ??= (async () => {
          this.closed += 1;
          await browser.close();
        })()),
    };
  }
}

describe.skipIf(!executablePath)('ingestBrand against a real page', () => {
  let site: BrandSite;
  let result: IngestionResult;
  const browser = new FixtureBrowser();

  beforeAll(async () => {
    site = await startBrandSite();
    result = await ingestBrand(
      { url: `${site.origin}/`, organizationId: 'org_1', projectId: 'prj_1', captures: { hero: true, buttons: 4, cards: 4 } },
      { browser, logger: silentLogger },
    );
  }, 120_000);

  afterAll(async () => {
    await site?.close();
  });

  const asset = (id: string | null | undefined) => result.assets.find((entry) => entry.id === id);

  it('returns a manifest the contract accepts, and closes the browser', () => {
    expect(() => BrandIngestion.parse(result.manifest)).not.toThrow();
    expect(result.manifest.finalUrl).toBe(`${site.origin}/`);
    expect(result.manifest.title).toBe('Acme — Close the books while you sleep');
    expect(browser.closed).toBe(browser.opened);
    for (const stage of ['open', 'navigate', 'settle', 'palette', 'typography', 'logo', 'components']) {
      expect(result.manifest.diagnostics.stages.find((entry) => entry.name === stage), stage).toMatchObject({ ok: true });
    }
  });

  it('blocks every request aimed at a private address, and says so', () => {
    const blocked = result.manifest.diagnostics.blockedRequests.map((entry) => entry.url);
    expect(blocked.some((url) => url.startsWith('http://169.254.169.254/'))).toBe(true);
    expect(blocked.some((url) => url.startsWith('http://127.0.0.1:1/'))).toBe(true);
  });

  it('measures the palette, finding the brand on its buttons, as the stylesheet wrote it', () => {
    const palette = result.manifest.palette!;
    const primary = palette.colors.find((color) => color.hex8 === palette.roles.primary)!;
    expect(primary.css).toBe('oklch(0.62 0.19 259.8)');
    expect(primary.tokens).toContain('--brand');
    expect(palette.roles.primaryForeground).toBe('#ffffffff');
    expect(palette.roles.background).toBe('#ffffffff');
    expect(palette.roles.foreground).toBe('#111113ff');
    expect(palette.tokens.find((token) => token.name === '--color-red-500')?.usedOnPage).toBe(false);
    expect(palette.themeColor).toBe('#3981f6ff');
    // A zero-blur ring is how design systems draw hairlines; it is a border, not a shadow.
    expect(palette.colors.find((color) => color.hex8 === '#1111130f')?.usages).toContain('border');
    // The cookie banner is hidden before anything is measured.
    expect(palette.colors.some((color) => color.hex === '#00ff00')).toBe(false);
  });

  it('reads the type, which file drew it, and keeps those files with their licence', () => {
    const typography = result.manifest.typography!;
    const display = typography.roles.find((role) => role.role === 'display')!;
    expect(display.stack[0]).toBe('Acme Sans');
    expect(display).toMatchObject({ weight: 700, sizePx: 72, lineHeight: 1, letterSpacingEm: -0.03 });
    expect(display.rendered).toMatchObject({ family: 'Inter', isWebFont: true });
    expect(typography.roles.find((role) => role.role === 'ui')).toMatchObject({ weight: 600 });

    const weights = typography.faces.map((face) => face.weight).sort();
    expect(weights).toEqual(['400', '600', '700']);
    for (const face of typography.faces) {
      expect(face.family).toBe('Acme Sans');
      expect(face.sourceUrl.startsWith(`http://${CDN_HOST}:${site.port}/fonts/`)).toBe(true);
      expect(face.licence).toMatchObject({ kind: 'open', requiresAttestation: false });
      expect(asset(face.assetId)?.mime).toBe('font/woff2');
    }
    expect(typography.missing).toEqual(expect.arrayContaining([expect.objectContaining({ family: 'Menlo' })]));
  });

  it('lifts the logo as a clean, standalone vector that looks like the page', () => {
    const logo = result.manifest.logo!;
    expect(logo.source).toBe('inline-svg');
    expect(logo.reasons).toEqual(expect.arrayContaining(['links to the home page', 'in the page header']));
    expect(logo.cssWidth).toBe(132);
    expect(logo.cssHeight).toBe(32);
    expect(logo.vectorFidelity).toBeGreaterThanOrEqual(0.9);

    const svg = asset(logo.svgAssetId)!.data.toString();
    // The sprite and the gradient came with it; the page's CSS was baked in.
    expect(svg).toContain('id="acme-glyph"');
    expect(svg).toContain('id="acme-shine"');
    expect(svg).toMatch(/fill="oklch\(0\.62 0\.19 259\.8\)"/);
    expect(svg).not.toMatch(/class=|style=|<script/);
    expect(sanitizeSvg(svg).svg).toBe(svg);
    expect(asset(logo.pngAssetId)?.mime).toBe('image/png');
  });

  it('captures the hero, each distinct button and one of the identical cards', () => {
    const kinds = result.manifest.captures.map((capture) => capture.kind);
    expect(kinds.filter((kind) => kind === 'hero')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'button')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'card')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'viewport')).toHaveLength(1);
    const labels = result.manifest.captures.filter((capture) => capture.kind === 'button').map((capture) => capture.label);
    expect(labels.sort()).toEqual(['Book a demo', 'Start free']);
  });

  it('captures a card revealed, transparent around its corners, without what floats over it', async () => {
    const card = result.manifest.captures.find((capture) => capture.kind === 'card')!;
    expect(card.transparent).toBe(true);
    expect(card.opaqueCoverage).toBeGreaterThan(0.5);
    expect(card.opaqueCoverage).toBeLessThan(1);
    expect(card.scale).toBe(3);
    expect(card.style).toMatchObject({ background: '#ffffffff', borderRadiusPx: 16 });

    const png = asset(card.assetId)!.data;
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    // Fully shown: the middle of the card is its opaque white, not a faded reveal.
    expect(pixel(Math.floor(info.width / 2), Math.floor(info.height / 2))).toEqual([255, 255, 255, 255]);
    // The corner outside the radius and the shadow's far edge carry alpha.
    expect(pixel(0, 0)[3]).toBeLessThan(255);
    // The floating widget over the card was hidden for the capture.
    let magenta = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset]! > 240 && data[offset + 1]! < 30 && data[offset + 2]! > 240 && data[offset + 3]! > 200) magenta += 1;
    }
    expect(magenta).toBe(0);
  });

  it('keeps every byte it references, and nothing it does not', () => {
    const referenced = new Set(result.manifest.assets.map((ref) => ref.id));
    expect(result.assets.map((entry) => entry.id).sort()).toEqual([...referenced].sort());
    for (const capture of result.manifest.captures) expect(referenced.has(capture.assetId)).toBe(true);
  });
});

describe.skipIf(!executablePath)('ingestBrand refusing what it should', () => {
  let site: BrandSite;
  const browser = new FixtureBrowser();

  beforeAll(async () => {
    site = await startBrandSite();
  });

  afterAll(async () => {
    await site?.close();
  });

  const run = (path: string, timeoutMs = 60_000) =>
    ingestBrand({ url: `${site.origin}${path}`, organizationId: 'org_1', projectId: 'prj_1', timeoutMs }, { browser, logger: silentLogger });

  it('refuses a private address before opening a browser', async () => {
    const before = browser.opened;
    await expect(
      ingestBrand({ url: 'http://169.254.169.254/latest/', organizationId: 'org_1', projectId: 'prj_1' }, { browser, logger: silentLogger }),
    ).rejects.toMatchObject({ failure: 'blocked', retryable: false });
    expect(browser.opened).toBe(before);
  });

  it('refuses a malformed request with every problem named', async () => {
    const error = await ingestBrand({ url: '', organizationId: '', projectId: 'prj_1' }, { browser, logger: silentLogger }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IngestionError);
    expect((error as IngestionError).failure).toBe('invalid_request');
    expect((error as IngestionError).message).toMatch(/url/);
    expect((error as IngestionError).message).toMatch(/organizationId/);
  });

  it('reports a missing page as an error that will not change on retry, and still closes the browser', async () => {
    await expect(run('/missing')).rejects.toMatchObject({ failure: 'http_error', retryable: false });
    expect(browser.closed).toBe(browser.opened);
  }, 60_000);

  it('notices when the vector it lifted does not look like what the page drew', async () => {
    // The site hides its sprite with display:none, so the page paints the
    // logo without its gradient bar; the lifted vector paints it. The
    // comparison must say so rather than hand over the wrong logo as the truth.
    const result = await run('/hidden-sprite');
    const logo = result.manifest.logo!;
    expect(logo.svgAssetId).not.toBeNull();
    expect(logo.pngAssetId).not.toBeNull();
    expect(logo.vectorFidelity).toBeLessThan(0.9);
    expect(result.manifest.diagnostics.warnings.join(' ')).toMatch(/capture is the reliable version/);
  }, 60_000);

  it('refuses a page with nothing on it', async () => {
    await expect(run('/blank')).rejects.toMatchObject({ failure: 'empty_page' });
    expect(browser.closed).toBe(browser.opened);
  }, 60_000);

  it('never follows a redirect into a private address', async () => {
    const error = (await run('/redirect-private').catch((caught: unknown) => caught)) as IngestionError;
    expect(error).toBeInstanceOf(IngestionError);
    expect(['blocked', 'unreachable']).toContain(error.failure);
    expect(browser.closed).toBe(browser.opened);
  }, 60_000);

  it('gives up on a page that never answers, within the run’s time, and closes the browser', async () => {
    const started = Date.now();
    await expect(run('/hang', 15_000)).rejects.toMatchObject({ failure: 'timeout', retryable: true });
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(browser.closed).toBe(browser.opened);
  }, 40_000);
});
