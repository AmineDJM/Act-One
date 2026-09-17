import type { Browser, BrowserContext, Page } from 'playwright-core';
import { newId } from '@act-one/core';
import { CLEAN_CAPTURE_CSS, probeDocument } from './page-probe.ts';
import { checkInteraction, checkNavigation, PolicyViolation, type NavigationPolicy } from './policy.ts';
import type {
  BrowserSession,
  CaptureOptions,
  ElementBounds,
  InteractionStep,
  PageCapture,
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

  constructor(params: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    policy: NavigationPolicy;
    audit?: AuditHook;
    ownsBrowser?: boolean;
    id?: string;
  }) {
    this.browser = params.browser;
    this.context = params.context;
    this.page = params.page;
    this.policy = params.policy;
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

    await this.page.goto(url, {
      waitUntil: options.waitUntil ?? 'domcontentloaded',
      timeout: 45_000,
    });
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

    return {
      url: this.page.url(),
      title: fallback.title,
      text: fallback.text,
      html: html.slice(0, 400_000),
      screenshot,
      styleProfile: probed?.styleProfile ?? null,
      links: fallback.links,
      statusCode: 200,
      capturedAt: new Date().toISOString(),
    };
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
