import { chromium } from 'playwright-core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { PlaywrightSession, type AuditHook } from './playwright-session.ts';
import type { BrowserAutomationProvider, BrowserSession, SessionOptions } from './types.ts';

export type KernelConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
  costPerMinuteUsd?: number;
  audit?: AuditHook;
};

/**
 * Kernel adapter.
 *
 * Prepared, not yet the default. It exists so switching managed browser vendors
 * is a config change rather than a refactor — the session semantics above are
 * vendor-neutral, and this class only has to produce a CDP endpoint.
 */
export class KernelProvider implements BrowserAutomationProvider {
  readonly name = 'kernel';
  readonly kind = 'browser' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly costPerMinuteUsd: number;
  private readonly audit: AuditHook | undefined;

  constructor(config: KernelConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.KERNEL_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.KERNEL_BASE_URL ?? 'https://api.onkernel.com')
      .replace(/\/$/, '');
    this.costSink = config.costSink;
    this.costPerMinuteUsd = config.costPerMinuteUsd ?? 0.02;
    this.audit = config.audit;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: 'browser',
      healthy: false,
      checkedAt: new Date().toISOString(),
      message: this.isConfigured()
        ? 'Kernel adapter is present but not enabled as a routing target.'
        : 'KERNEL_API_KEY not configured.',
    };
  }

  async createSession(
    options: SessionOptions,
    context: CallContext,
  ): Promise<BrowserSession> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'Kernel is not configured.', { retryable: false });
    }

    const startedAt = Date.now();
    const created = await httpRequest<{ session_id?: string; cdp_ws_url?: string }>(
      this.name,
      `${this.baseUrl}/browsers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
        body: {
          headless: true,
          stealth: false,
          timeout_seconds: Math.ceil((options.timeoutMs ?? 10 * 60_000) / 1000),
        },
        timeoutMs: 45_000,
        signal: context.signal,
      },
    );

    if (!created.cdp_ws_url) {
      throw new ProviderError(this.name, 'Kernel did not return a CDP endpoint.', {
        retryable: true,
      });
    }

    const browser = await chromium.connectOverCDP(created.cdp_ws_url, { timeout: 45_000 });
    const browserContext = browser.contexts()[0] ?? (await browser.newContext());
    const page = browserContext.pages()[0] ?? (await browserContext.newPage());

    const session = new PlaywrightSession({
      browser,
      context: browserContext,
      page,
      policy: options.policy,
      audit: this.audit,
      ownsBrowser: true,
      id: created.session_id ?? 'kernel-session',
    });

    const costSink = this.costSink;
    const costPerMinute = this.costPerMinuteUsd;
    const providerName = this.name;
    const originalClose = session.close.bind(session);
    session.close = async () => {
      await originalClose();
      const minutes = (Date.now() - startedAt) / 60_000;
      await costSink?.record({
        provider: providerName,
        operation: 'browser.session',
        estimatedCostUsd: costPerMinute * minutes,
        actualCostUsd: costPerMinute * minutes,
        quantity: minutes,
        unit: 'minute',
        metadata: { projectId: options.projectId },
      });
    };

    return session;
  }
}
