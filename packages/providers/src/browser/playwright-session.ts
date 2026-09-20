import type { Browser, BrowserContext, Page } from 'playwright-core';
import { newId } from '@act-one/core';
import {
  CLEAN_CAPTURE_CSS,
  findProductImagery,
  probeDocument,
  shieldCapture,
  unshieldCapture,
} from './page-probe.ts';
import { checkInteraction, checkNavigation, PolicyViolation, type NavigationPolicy } from './policy.ts';
import type {
  BrowserSession,
  CaptureOptions,
  ElementBounds,
  InteractionStep,
  PageCapture,
  ProductImageCapture,
  RecordingResult,
} from './types.ts';

export type AuditHook = (event: {
  action: 'session_open' | 'navigate' | 'capture' | 'session_close' | 'blocked';
  detail: string;
}) => void;

/**
 * Playwright-backed session shared by every browser provider.
 *
 * Browserbase and a local Chromium differ only in how the Browser handle is
 * obtained; everything that matters — policy enforcement, capture quality,
 * state hygiene — is identical and lives here so it cannot drift between
 * providers.
 */
/**
 * Past this the file is large and the detail is invented by the scaler.
 * Three device pixels per CSS pixel is what a retina screenshot already is.
 */
const MAX_CAPTURE_SCALE = 4;

export class PlaywrightSession implements BrowserSession {
  readonly id: string;

  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly policy: NavigationPolicy;
  private readonly audit: AuditHook | undefined;
  private readonly ownsBrowser: boolean;
  private pagesVisited = 0;
  private closed = false;
  /** HTTP status of the last navigation. A capture of a 404 page is not evidence. */
  private lastStatus = 200;
  /**
   * Device pixels per CSS pixel this context normally draws with, so the
   * imagery pass can raise it and put it back exactly where it was.
   */
  private readonly deviceScale: number;
  /** Held open while a scale override is in force; an override dies with its session. */
  private emulation: Awaited<ReturnType<BrowserContext['newCDPSession']>> | null = null;

  constructor(params: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    policy: NavigationPolicy;
    audit?: AuditHook;
    ownsBrowser?: boolean;
    id?: string;
    /** What the context was created with, so it can be restored after a raise. */
    deviceScaleFactor?: number;
  }) {
    this.browser = params.browser;
    this.context = params.context;
    this.page = params.page;
    this.policy = params.policy;
    this.deviceScale = params.deviceScaleFactor ?? 2;
    this.audit = params.audit;
    this.ownsBrowser = params.ownsBrowser ?? true;
    this.id = params.id ?? newId('sec');
    this.audit?.({ action: 'session_open', detail: this.id });
  }

  async goto(
    url: string,
    options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {},
  ): Promise<void> {
    const verdict = checkNavigation(this.policy, url);
    if (!verdict.allowed) {
      this.audit?.({ action: 'blocked', detail: `${url}: ${verdict.reason}` });
      throw new PolicyViolation(verdict.reason);
    }
    if (this.pagesVisited >= this.policy.maxPages) {
      throw new PolicyViolation(`Page budget of ${this.policy.maxPages} exhausted for this session.`);
    }
    this.pagesVisited += 1;
    this.audit?.({ action: 'navigate', detail: url });

    const response = await this.page.goto(url, {
      waitUntil: options.waitUntil ?? 'domcontentloaded',
      timeout: 45_000,
    });
    // Null for same-document navigations and about:blank, neither of which is
    // an error.
    this.lastStatus = response?.status() ?? 200;
    // networkidle is unreliable on sites with long-polling; a bounded settle is
    // more predictable and much faster.
    await this.page.waitForTimeout(600);
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async capture(options: CaptureOptions = {}): Promise<PageCapture> {
    await this.prepareForCapture(options);

    // The probe runs inside the customer's page, where a strict CSP, an exotic
    // DOM or one thrown getter can take it down. Losing the style profile is
    // survivable — losing the page text means the whole crawl produced nothing,
    // so the text path degrades independently.
    let probed: Awaited<ReturnType<typeof probeDocument>> | null = null;
    try {
      probed = await this.page.evaluate(probeDocument);
    } catch (error) {
      this.audit?.({
        action: 'blocked',
        detail: `Style probe failed on ${this.page.url()}: ${(error as Error).message.slice(0, 200)}`,
      });
    }

    const fallback = probed ?? (await this.captureTextOnly());
    const html = await this.page.content();
    let screenshot: Uint8Array | null = null;
    try {
      screenshot = await this.screenshot(options);
    } catch {
      // A failed screenshot must not lose the text evidence we already have.
      screenshot = null;
    }

    this.audit?.({ action: 'capture', detail: this.page.url() });

    const productImages =
      options.productImages && options.productImages > 0
        ? await this.captureProductImages(options.productImages)
        : undefined;

    return {
      url: this.page.url(),
      title: fallback.title,
      text: fallback.text,
      html: html.slice(0, 400_000),
      screenshot,
      styleProfile: probed?.styleProfile ?? null,
      links: fallback.links,
      statusCode: this.lastStatus,
      capturedAt: new Date().toISOString(),
      ...(productImages ? { productImages } : {}),
    };
  }

  /**
   * Element screenshots of the product imagery the page displays.
   *
   * Each candidate is scrolled into view (so a lazy image has loaded), shielded
   * from anything fixed over it, and captured at device scale. One failing
   * candidate is skipped, not fatal: the page capture already succeeded.
   */
  private async captureProductImages(max: number): Promise<ProductImageCapture[]> {
    let found: ReturnType<typeof findProductImagery> = [];
    try {
      found = await this.page.evaluate(findProductImagery, max);
    } catch (error) {
      this.audit?.({
        action: 'blocked',
        detail: `Product imagery probe failed on ${this.page.url()}: ${(error as Error).message.slice(0, 200)}`,
      });
      return [];
    }

    const captured: ProductImageCapture[] = [];
    for (const candidate of found) {
      try {
        const locator = this.page.locator(candidate.selector).first();
        await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
        await this.page.waitForTimeout(250);
        await this.page.evaluate(shieldCapture, candidate.selector).catch(() => 0);

        /*
         * Captured at the resolution the source actually has.
         *
         * A marketing page draws a 4096-pixel screenshot into a 582-pixel
         * slot, and an element screenshot at the page's own scale keeps 1164
         * of them. That is enough to put the whole picture on screen as a
         * slide and nothing else \u2014 at 1164 the capture is already a 1.65\u00d7
         * upscale to fill a 1920 frame, so there is no room to frame anything
         * inside it, and "show the part that matters, big" is unavailable
         * before anybody considers it. Which is one reason product shots end
         * up as whole screenshots centred on a field.
         *
         * The debugger's own clip takes a scale, so this asks for the extra
         * pixels directly rather than emulating a denser screen: Playwright
         * sets its own device metrics while screenshotting, and an override
         * around that call is silently undone.
         */
        const bytes = await this.captureElement(candidate.selector, candidate.naturalWidth, candidate.width);
        if (!bytes) continue;
        captured.push({
          bytes,
          alt: candidate.alt,
          width: candidate.width,
          height: candidate.height,
          top: candidate.top,
          src: candidate.src,
        });
      } catch {
        continue;
      } finally {
        await this.page.evaluate(unshieldCapture).catch(() => undefined);
      }
    }
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    return captured;
  }

  /**
   * One element, at up to the resolution its source holds.
   *
   * `Page.captureScreenshot` takes a clip with its own scale, which is the
   * only way to ask for more device pixels than the page is drawn with
   * without moving the layout: setting a width or a transform on the element
   * reflows the page, and an ancestor with `overflow: hidden` then clips the
   * very thing being captured.
   */
  private async captureElement(
    selector: string,
    naturalWidth: number,
    renderedWidth: number,
  ): Promise<Buffer | null> {
    const rect = await this.page
      .evaluate((css) => {
        const node = document.querySelector(css);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {
          x: box.left + window.scrollX,
          y: box.top + window.scrollY,
          width: box.width,
          height: box.height,
        };
      }, selector)
      .catch(() => null);
    if (!rect || rect.width < 1 || rect.height < 1) return null;

    // Never past what the source itself holds: beyond that the extra pixels
    // are invented by the scaler and the file is larger for nothing.
    const available = naturalWidth > 0 ? naturalWidth / Math.max(1, renderedWidth) : 1;
    const scale = Math.max(1, Math.min(MAX_CAPTURE_SCALE, Math.floor(available * 10) / 10));

    try {
      const session = (this.emulation ??= await this.page.context().newCDPSession(this.page));
      const shot = (await session.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale },
      })) as { data: string };
      return Buffer.from(shot.data, 'base64');
    } catch {
      // A browser that will not do this still gives us the ordinary capture.
      return this.page
        .locator(selector)
        .first()
        .screenshot({ type: 'png', animations: 'disabled', timeout: 10_000 })
        .catch(() => null);
    }
  }

  /** Minimal, maximally-robust extraction for when the full probe fails. */
  private async captureTextOnly(): Promise<{
    title: string;
    text: string;
    links: { href: string; text: string }[];
  }> {
    try {
      return await this.page.evaluate(() => ({
        title: document.title ?? '',
        text: (document.body?.innerText ?? '').slice(0, 60_000),
        links: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .slice(0, 400)
          .map((a) => ({ href: a.href, text: (a.textContent ?? '').trim().slice(0, 140) }))
          .filter((l) => l.href.startsWith('http')),
      }));
    } catch {
      return { title: '', text: '', links: [] };
    }
  }

  async screenshot(options: CaptureOptions = {}): Promise<Uint8Array> {
    await this.prepareForCapture(options);
    if (options.selector) {
      const locator = this.page.locator(options.selector).first();
      await locator.waitFor({ state: 'visible', timeout: 8000 });
      return await locator.screenshot({ type: 'png' });
    }
    return await this.page.screenshot({
      type: 'png',
      fullPage: options.fullPage ?? false,
      animations: 'disabled',
      scale: 'device',
    });
  }

  async boundsOf(selector: string): Promise<ElementBounds | null> {
    const locator = this.page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    const box = await locator.boundingBox();
    if (!box) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  async perform(steps: InteractionStep[]): Promise<void> {
    for (const step of steps) {
      const verdict = checkInteraction(this.policy, step);
      if (!verdict.allowed) {
        this.audit?.({ action: 'blocked', detail: verdict.reason });
        throw new PolicyViolation(verdict.reason);
      }
      await this.performOne(step);
    }
  }

  /**
   * Captures a frame sequence while replaying an interaction. We deliberately
   * return frames rather than a video file: the motion engine re-times and
   * re-eases these, and a fixed-rate video would lock us into the browser's
   * own timing, which is never the timing the edit wants.
   */
  async record(steps: InteractionStep[], seconds: number): Promise<RecordingResult> {
    const fps = 12;
    const totalFrames = Math.min(180, Math.max(4, Math.round(seconds * fps)));
    const frames: Uint8Array[] = [];
    const startedAt = Date.now();

    await this.prepareForCapture({ hideChrome: true, freezeAnimations: false });

    let stepIndex = 0;
    const framesPerStep = Math.max(1, Math.floor(totalFrames / Math.max(1, steps.length)));

    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (frame > 0 && frame % framesPerStep === 0 && stepIndex < steps.length) {
        const step = steps[stepIndex]!;
        const verdict = checkInteraction(this.policy, step);
        if (!verdict.allowed) {
          this.audit?.({ action: 'blocked', detail: verdict.reason });
          throw new PolicyViolation(verdict.reason);
        }
        await this.performOne(step);
        stepIndex += 1;
      }
      frames.push(await this.page.screenshot({ type: 'png', animations: 'allow' }));
      await this.page.waitForTimeout(Math.round(1000 / fps));
    }

    return {
      video: null,
      frames,
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
  }

  async clearState(): Promise<void> {
    await this.context.clearCookies();
    try {
      await this.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      // Storage access throws on about:blank and on cross-origin frames; the
      // cookie clear above is the part that matters.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.audit?.({ action: 'session_close', detail: this.id });
    // Always wipe before release. A persisted authenticated session that
    // outlives its project is the worst bug this system could have.
    await this.clearState().catch(() => undefined);
    await this.context.close().catch(() => undefined);
    if (this.ownsBrowser) await this.browser.close().catch(() => undefined);
  }

  private async performOne(step: InteractionStep): Promise<void> {
    switch (step.type) {
      case 'click':
        await this.page.locator(step.selector).first().click({ timeout: 10_000 });
        break;
      case 'type':
        await this.page.locator(step.selector).first().fill(step.text, { timeout: 10_000 });
        break;
      case 'hover':
        await this.page.locator(step.selector).first().hover({ timeout: 10_000 });
        break;
      case 'scroll':
        await this.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'auto' }), step.y);
        break;
      case 'wait':
        await this.page.waitForTimeout(Math.min(10_000, step.ms));
        break;
      case 'press':
        await this.page.keyboard.press(step.key);
        break;
    }
    await this.page.waitForTimeout(250);
  }

  private async prepareForCapture(options: CaptureOptions): Promise<void> {
    if (options.hideChrome !== false) {
      await this.page.addStyleTag({ content: CLEAN_CAPTURE_CSS }).catch(() => undefined);
    }
    if (options.freezeAnimations !== false) {
      await this.page.evaluate(() => {
        document.querySelectorAll('video').forEach((video) => {
          video.pause();
          video.currentTime = 0;
        });
      }).catch(() => undefined);
    }
    // Lazy-loaded imagery is extremely common and captures the hero section as
    // a grey box unless we walk the page first.
    await this.page
      .evaluate(async () => {
        const height = document.body.scrollHeight;
        for (let y = 0; y < Math.min(height, 6000); y += 600) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        window.scrollTo(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 120));
      })
      .catch(() => undefined);
    await this.page.waitForTimeout(options.settleMs ?? 400);
  }
}
