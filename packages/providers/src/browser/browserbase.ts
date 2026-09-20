import { chromium } from 'playwright-core';
import { z } from 'zod';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { PlaywrightSession, type AuditHook } from './playwright-session.ts';
import type { BrowserAutomationProvider, BrowserSession, SessionOptions } from './types.ts';

const Project = z.object({
  id: z.string(),
  name: z.string().optional(),
  concurrency: z.number().optional(),
  defaultTimeout: z.number().optional(),
});
type Project = z.infer<typeof Project>;

const SessionResponse = z.object({
  id: z.string(),
  connectUrl: z.string().optional(),
  status: z.string().optional(),
});

/** Seconds. The vendor's bounds on how long a session may live. */
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 21_600;

export type BrowserbaseConfig = {
  apiKey?: string;
  /**
   * Only needed when the key can reach more than one project. A Browserbase
   * key belongs to a project, so it is usually found from the key alone.
   */
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
  private resolved: Promise<Project> | null = null;

  constructor(config: BrowserbaseConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env.BROWSERBASE_API_KEY ?? '').trim();
    this.projectId = (config.projectId ?? process.env.BROWSERBASE_PROJECT_ID ?? '').trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.browserbase.com').replace(/\/$/, '');
    this.costSink = config.costSink;
    this.costPerMinuteUsd = config.costPerMinuteUsd ?? 0.02;
    this.audit = config.audit;
  }

  isConfigured(): boolean {
    return canAuthenticate('browserbase', this.apiKey);
  }

  /**
   * Finds the project the key works in. That proves the key, and it is what
   * the console shows: the project's name and how many sessions it may run.
   */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'browser' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'Browserbase API key not configured.' };
    }
    const startedAt = Date.now();
    try {
      const project = await this.project();
      const concurrency = project.concurrency
        ? `, ${project.concurrency} concurrent session${project.concurrency === 1 ? '' : 's'}`
        : '';
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: `Project ${project.name ?? project.id}${concurrency}.`,
      };
    } catch (error) {
      return {
        ...base,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSession(options: SessionOptions, context: CallContext): Promise<BrowserSession> {
    if (!this.isConfigured()) {
      /*
       * Retryable, because a fallback is exactly what this case is for.
       *
       * It was marked non-retryable — "a bad key will fail identically on a
       * second vendor and only cost more" — which is true of a bad key and
       * false of no key at all. A deployment with no Browserbase credentials
       * and a perfectly good Playwright fallback configured behind it got the
       * throw instead of the fallback, so research died at "Opening a browser"
       * rather than crawling the public site it was always able to crawl.
       */
      throw new ProviderError(this.name, 'Browserbase is not configured.', { retryable: true });
    }
    const project = await this.project();

    const startedAt = Date.now();
    let created: unknown;
    try {
      created = await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          projectId: project.id,
          browserSettings: {
            viewport: {
              width: options.viewport?.width ?? 1920,
              height: options.viewport?.height ?? 1080,
            },
            blockAds: true,
            solveCaptchas: false,
          },
          // Sessions are scoped and short-lived by policy, not by convention.
          // The vendor bounds a session's life; ours is asked for within them.
          timeout: Math.min(
            MAX_SESSION_SECONDS,
            Math.max(MIN_SESSION_SECONDS, Math.ceil((options.timeoutMs ?? 10 * 60_000) / 1000)),
          ),
          keepAlive: false,
        },
        timeoutMs: 45_000,
        signal: context.signal,
      });
    } catch (error) {
      throw this.describe(error);
    }

    const session = SessionResponse.parse(created);
    /*
     * The vendor hands back a connect URL that carries its own authorisation.
     * The hand-built fallback exists for older responses that did not, and it
     * is the one place the key travels in a URL rather than a header — so a
     * process that does not hold the key cannot build it. Better to say that
     * than to open a socket with `apiKey=` and read the refusal as the vendor
     * being down.
     */
    if (!session.connectUrl && !this.apiKey) {
      throw new ProviderError(
        this.name,
        'The session gave no connect URL and this process holds no key to build one with.',
        { retryable: false },
      );
    }
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
      // Released early, so the vendor stops the meter before its own timeout.
      await httpRequest(providerName, `${this.baseUrl}/v1/sessions/${session.id}`, {
        method: 'POST',
        headers: this.headers(),
        body: { projectId: project.id, status: 'REQUEST_RELEASE' },
        attempts: 1,
        timeoutMs: 10_000,
      }).catch(() => undefined);
    };

    return playwrightSession;
  }

  /**
   * The project this key works in, found once. A Browserbase key belongs to a
   * project, so one key usually reaches exactly one and nothing needs to be
   * typed; a key that reaches several has to be told which.
   */
  private project(): Promise<Project> {
    if (!this.resolved) {
      this.resolved = this.resolveProject().catch((error: unknown) => {
        this.resolved = null;
        throw error;
      });
    }
    return this.resolved;
  }

  private async resolveProject(): Promise<Project> {
    if (this.projectId) {
      return this.api(Project, `/v1/projects/${encodeURIComponent(this.projectId)}`);
    }
    const projects = await this.api(z.array(Project), '/v1/projects');
    if (projects.length === 1) return projects[0]!;
    if (projects.length === 0) {
      throw new ProviderError(this.name, 'The Browserbase key reaches no project.', {
        retryable: false,
      });
    }
    const names = projects.map((project) => project.name ?? project.id).join(', ');
    throw new ProviderError(
      this.name,
      `The Browserbase key reaches ${projects.length} projects (${names}). Set the Project ID to choose one.`,
      { retryable: false },
    );
  }

  private async api<T>(schema: z.ZodType<T>, path: string): Promise<T> {
    let raw: unknown;
    try {
      raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${path}`, {
        headers: this.headers(),
        timeoutMs: 10_000,
        attempts: 1,
      });
    } catch (error) {
      throw this.describe(error);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, `Unexpected answer from ${path}.`, { retryable: true });
    }
    return parsed.data;
  }

  /** The vendor's status codes in words, with nothing of the key in them. */
  private describe(error: unknown): ProviderError {
    if (!(error instanceof ProviderError)) {
      return new ProviderError(this.name, String(error), { retryable: true, cause: error });
    }
    if (error.status === 401 || error.status === 403) {
      return new ProviderError(this.name, 'Browserbase rejected the API key.', {
        retryable: false,
        status: error.status,
      });
    }
    if (error.status === 404) {
      return new ProviderError(this.name, 'Browserbase has no such project for this key.', {
        retryable: false,
        status: 404,
      });
    }
    return error;
  }

  private headers(): Record<string, string> {
    /*
     * Nothing to send when a gateway in front of this process holds the key
     * and writes the header itself. A placeholder here would be a wrong key
     * anywhere the gateway is not there, which fails less legibly than none.
     */
    if (!this.apiKey && credentialIsManaged('browserbase')) return { accept: 'application/json' };
    return { 'x-bb-api-key': this.apiKey, accept: 'application/json' };
  }
}
