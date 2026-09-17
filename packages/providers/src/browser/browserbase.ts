import { chromium } from 'playwright-core';
import { z } from 'zod';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { PlaywrightSession, type AuditHook } from './playwright-session.ts';
import type { BrowserAutomationProvider, BrowserSession, SessionOptions } from './types.ts';

const SessionResponse = z.object({
  id: z.string(),
  connectUrl: z.string().optional(),
  status: z.string().optional(),
});

export type BrowserbaseConfig = {
  apiKey?: string;
  projectId?: string;
  baseUrl?: string;
  costSink?: CostSink;
  /** USD per browser-minute, for the ledger. Configurable in Super Admin. */
  costPerMinuteUsd?: number;
  audit?: AuditHook;
};

/**
 * Browserbase: managed, isolated browser infrastructure.
 *
 * Every session here is a fresh remote browser, which is precisely the isolation
 * property we need — one customer's authenticated session can never be handed to
 * another, because the container is destroyed with the session.
 */
export class BrowserbaseProvider implements BrowserAutomationProvider {
  readonly name = 'browserbase';
  readonly kind = 'browser' as const;

  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly costPerMinuteUsd: number;
  private readonly audit: AuditHook | undefined;

  constructor(config: BrowserbaseConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.BROWSERBASE_API_KEY ?? '';
    this.projectId = config.projectId ?? process.env.BROWSERBASE_PROJECT_ID ?? '';
    this.baseUrl = (config.baseUrl ?? 'https://api.browserbase.com').replace(/\/$/, '');
    this.costSink = config.costSink;
    this.costPerMinuteUsd = config.costPerMinuteUsd ?? 0.02;
    this.audit = config.audit;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.projectId.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        kind: 'browser',
        healthy: false,
        checkedAt,
        message: 'BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not configured.',
      };
    }
    const startedAt = Date.now();
    try {
      await httpRequest(this.name, `${this.baseUrl}/v1/projects/${this.projectId}`, {
        headers: this.headers(),
        timeoutMs: 10_000,
        attempts: 1,
      });
      return {
        provider: this.name,
        kind: 'browser',
        healthy: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'browser',
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSession(
    options: SessionOptions,
    context: CallContext,
  ): Promise<BrowserSession> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'Browserbase is not configured.', { retryable: false });
    }

    const startedAt = Date.now();
    const created = await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: {
        projectId: this.projectId,
        browserSettings: {
          viewport: {
            width: options.viewport?.width ?? 1920,
            height: options.viewport?.height ?? 1080,
          },
          blockAds: true,
          solveCaptchas: false,
        },
        // Sessions are scoped and short-lived by policy, not by convention.
        timeout: Math.ceil((options.timeoutMs ?? 10 * 60_000) / 1000),
        keepAlive: false,
      },
      timeoutMs: 45_000,
      signal: context.signal,
    });

    const session = SessionResponse.parse(created);
    const connectUrl =
      session.connectUrl ??
      `wss://connect.browserbase.com?apiKey=${encodeURIComponent(this.apiKey)}&sessionId=${session.id}`;

    const browser = await chromium.connectOverCDP(connectUrl, { timeout: 45_000 });
    const browserContext = browser.contexts()[0] ?? (await browser.newContext());
    const page = browserContext.pages()[0] ?? (await browserContext.newPage());
    await page.setViewportSize({
      width: options.viewport?.width ?? 1920,
      height: options.viewport?.height ?? 1080,
    });

    const costSink = this.costSink;
    const costPerMinute = this.costPerMinuteUsd;
    const providerName = this.name;

    const playwrightSession = new PlaywrightSession({
      browser,
      context: browserContext,
      page,
      policy: options.policy,
      audit: this.audit,
      ownsBrowser: true,
      id: session.id,
    });

    // Billing is by wall-clock minute, so the ledger entry is only correct once
    // the session actually ends.
    const originalClose = playwrightSession.close.bind(playwrightSession);
    playwrightSession.close = async () => {
      await originalClose();
      const minutes = (Date.now() - startedAt) / 60_000;
      await costSink?.record({
        provider: providerName,
        operation: 'browser.session',
        estimatedCostUsd: costPerMinute * minutes,
        actualCostUsd: costPerMinute * minutes,
        quantity: minutes,
        unit: 'minute',
        metadata: { sessionId: session.id, projectId: options.projectId },
      });
      await httpRequest(providerName, `${this.baseUrl}/v1/sessions/${session.id}`, {
        method: 'POST',
        headers: this.headers(),
        body: { projectId: this.projectId, status: 'REQUEST_RELEASE' },
        attempts: 1,
        timeoutMs: 10_000,
      }).catch(() => undefined);
    };

    return playwrightSession;
  }

  private headers(): Record<string, string> {
    return { 'x-bb-api-key': this.apiKey, accept: 'application/json' };
  }
}
