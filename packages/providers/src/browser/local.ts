import { chromium } from 'playwright-core';
import { newId } from '@act-one/core';
import type { CallContext, CostSink, ProviderHealth } from '../types.ts';
import { PlaywrightSession, type AuditHook } from './playwright-session.ts';
import type { BrowserAutomationProvider, BrowserSession, SessionOptions } from './types.ts';

export type LocalBrowserConfig = {
  executablePath?: string;
  headless?: boolean;
  costSink?: CostSink;
  audit?: AuditHook;
  /** Upstream HTTP(S) proxy, for self-hosted deployments behind egress control. */
  proxyServer?: string;
  /**
   * Base64 SHA-256 SPKI fingerprints of CAs Chromium should additionally trust.
   *
   * Corporate and sandboxed environments terminate TLS at an inspecting proxy,
   * whose CA is not in Chromium's bundled roots. Pinning that CA's public key
   * is narrow and auditable; `--ignore-certificate-errors` is not, and would
   * silently accept any certificate on any site we research. Never do that.
   */
  trustedCaSpkiFingerprints?: string[];
};

/**
 * Local Chromium.
 *
 * Not a fallback of convenience: it is what development, CI and self-hosted
 * deployments run on, and it exercises exactly the same session code as the
 * managed provider. Isolation is per-context rather than per-container, so it
 * is not used for authenticated customer products in production.
 */
export class LocalChromiumProvider implements BrowserAutomationProvider {
  readonly name = 'local-chromium';
  readonly kind = 'browser' as const;

  private readonly executablePath: string | undefined;
  private readonly headless: boolean;
  private readonly costSink: CostSink | undefined;
  private readonly audit: AuditHook | undefined;
  private readonly proxyServer: string | undefined;
  private readonly trustedCaSpkiFingerprints: string[];

  constructor(config: LocalBrowserConfig = {}) {
    this.executablePath =
      config.executablePath ??
      process.env.ACT_ONE_CHROMIUM_PATH ??
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      undefined;
    this.headless = config.headless ?? true;
    this.costSink = config.costSink;
    this.audit = config.audit;
    this.proxyServer = config.proxyServer ?? process.env.ACT_ONE_BROWSER_PROXY ?? undefined;
    this.trustedCaSpkiFingerprints =
      config.trustedCaSpkiFingerprints ??
      (process.env.ACT_ONE_BROWSER_TRUSTED_CA_SPKI ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
  }

  private launchArgs(): string[] {
    const args = ['--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'];
    if (this.trustedCaSpkiFingerprints.length > 0) {
      args.push(
        `--ignore-certificate-errors-spki-list=${this.trustedCaSpkiFingerprints.join(',')}`,
      );
    }
    return args;
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const browser = await chromium.launch({
        headless: true,
        ...(this.executablePath ? { executablePath: this.executablePath } : {}),
        ...(this.proxyServer ? { proxy: { server: this.proxyServer } } : {}),
        args: this.launchArgs(),
      });
      await browser.close();
      return {
        provider: this.name,
        kind: 'browser',
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'browser',
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSession(
    options: SessionOptions,
    _context: CallContext,
  ): Promise<BrowserSession> {
    const startedAt = Date.now();
    const browser = await chromium.launch({
      headless: this.headless,
      ...(this.executablePath ? { executablePath: this.executablePath } : {}),
      ...(this.proxyServer ? { proxy: { server: this.proxyServer } } : {}),
      args: this.launchArgs(),
    });

    const context = await browser.newContext({
      viewport: {
        width: options.viewport?.width ?? 1920,
        height: options.viewport?.height ?? 1080,
      },
      deviceScaleFactor: options.viewport?.deviceScaleFactor ?? 2,
      userAgent:
        options.userAgent ??
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      // Deterministic rendering: the same page must screenshot identically for
      // capture and for re-capture during repair.
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    context.setDefaultTimeout(options.timeoutMs ?? 45_000);
    const page = await context.newPage();

    const session = new PlaywrightSession({
      browser,
      context,
      page,
      policy: options.policy,
      audit: this.audit,
      ownsBrowser: true,
      id: newId('sec'),
    });

    const costSink = this.costSink;
    const providerName = this.name;
    const originalClose = session.close.bind(session);
    session.close = async () => {
      await originalClose();
      await costSink?.record({
        provider: providerName,
        operation: 'browser.session',
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        quantity: (Date.now() - startedAt) / 60_000,
        unit: 'minute',
        metadata: { projectId: options.projectId },
      });
    };

    return session;
  }
}
