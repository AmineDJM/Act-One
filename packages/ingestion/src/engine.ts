import { randomBytes } from 'node:crypto';
import type { Response } from 'playwright-core';
import { normalizeUrl } from '@act-one/core';
import {
  checkNavigation,
  policyForPublicResearch,
  ProviderError,
  supportsPageAccess,
  type BrowserAutomationProvider,
  type PageHandle,
} from '@act-one/providers';
import { AssetCollector, type IngestedAsset } from './assets.ts';
import { NetworkRecorder } from './browser/network-recorder.ts';
import { guardRequests, redirectChainReason, unsafeRequestReason, type BlockedRequest } from './browser/request-guard.ts';
import { settlePage } from './browser/settle.ts';
import { Deadline } from './deadline.ts';
import { errorMessage, IngestionError } from './errors.ts';
import { consoleLogger, type IngestionLogger } from './logger.ts';
import {
  BrandIngestion,
  INGESTION_SCHEMA_VERSION,
  IngestionRequest,
  type ComponentCapture,
  type IngestionRequestInput,
  type Logo,
  type Palette,
  type StageReport,
  type Typography,
} from './schema.ts';
import { extractComponents } from './stages/components.ts';
import type { StageContext } from './stages/context.ts';
import { extractLogo } from './stages/logo.ts';
import { extractPalette } from './stages/palette.ts';
import { extractTypography } from './stages/typography.ts';

export type IngestionDependencies = {
  browser: BrowserAutomationProvider;
  logger?: IngestionLogger;
  /** Cancels the run; the browser is still closed and the vendor session released. */
  signal?: AbortSignal;
  /** Total bytes of fonts and pictures one run may keep. */
  byteBudget?: number;
};

export type IngestionResult = { manifest: BrandIngestion; assets: IngestedAsset[] };

const DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024;

/**
 * Reads a brand off its own site: the palette it paints, the type it sets and
 * the files that type comes from, its mark as a vector, and its interface
 * lifted out as transparent pieces.
 *
 * One page, one isolated browser, one clock. Every stage after navigation is
 * allowed to fail on its own — a site whose fonts cannot be kept still has a
 * palette — and says so in the diagnostics; the run fails only when the page
 * cannot be read at all, or when nothing at all could be measured on it. The
 * browser is closed and the vendor session released on every path.
 */
export async function ingestBrand(
  input: IngestionRequestInput,
  dependencies: IngestionDependencies,
): Promise<IngestionResult> {
  const startedAt = Date.now();
  const logger = dependencies.logger ?? consoleLogger;

  const parsed = IngestionRequest.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`);
    throw new IngestionError('invalid_request', `Invalid ingestion request: ${issues.join('; ')}`, {
      stage: 'request',
      details: issues,
    });
  }
  const request = parsed.data;
  const url = normalizeUrl(request.url);
  if (!url) throw new IngestionError('invalid_request', `Not a usable address: ${request.url.slice(0, 200)}`, { stage: 'request' });
  const unsafe = unsafeRequestReason(url);
  const verdict = checkNavigation(policyForPublicResearch([url], 1), url);
  if (unsafe || !verdict.allowed) {
    throw new IngestionError('blocked', `Refusing to read ${url}: ${unsafe ?? (verdict.allowed ? '' : verdict.reason)}`, {
      stage: 'request',
    });
  }
  const browser = dependencies.browser;
  if (!supportsPageAccess(browser)) {
    throw new IngestionError('browser_unavailable', `The ${browser.name} provider cannot hand over a page.`, {
      stage: 'open',
      retryable: false,
    });
  }

  const deadline = new Deadline(request.timeoutMs, dependencies.signal);
  const stages: StageReport[] = [];
  const warnings: string[] = [];
  const blocked: BlockedRequest[] = [];
  const assets = new AssetCollector(dependencies.byteBudget ?? DEFAULT_BYTE_BUDGET);
  const log = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
    logger.log(level, event, { url, projectId: request.projectId, ...fields });

  let handle: PageHandle | null = null;
  try {
    const opened = Date.now();
    try {
      handle = await deadline.within(
        browser.openPage(
          {
            projectId: request.projectId,
            organizationId: request.organizationId,
            viewport: request.viewport,
            // The vendor's own timeout is the backstop if this process dies mid-run.
            timeoutMs: request.timeoutMs + 60_000,
          },
          { organizationId: request.organizationId, projectId: request.projectId, signal: deadline.signal },
        ),
        60_000,
        'open',
      );
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError('browser_unavailable', `No browser: ${errorMessage(error)}`, {
        stage: 'open',
        retryable: error instanceof ProviderError ? error.retryable : true,
        cause: error,
      });
    }
    stages.push(report('open', opened, null));
    log('info', 'browser_open', { provider: handle.provider, sessionId: handle.id });

    const { page, context } = handle;
    const cdp = await deadline.within(context.newCDPSession(page), 10_000, 'open');
    // Our own probes and styles must work under the strictest page CSP, and the
    // bodies we keep must come from the network, not a cache or a service worker.
    for (const [method, params] of [
      ['Page.setBypassCSP', { enabled: true }],
      ['Network.enable', {}],
      ['Network.setCacheDisabled', { cacheDisabled: true }],
      ['Network.setBypassServiceWorker', { bypass: true }],
    ] as const) {
      await deadline
        .within(cdp.send(method, params as never), 10_000, 'open')
        .catch((error: unknown) => warnings.push(`${method} unavailable: ${errorMessage(error).slice(0, 120)}`));
    }
    await deadline.within(page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }), 10_000, 'open');
    await deadline.within(page.setViewportSize(request.viewport), 10_000, 'open');

    const unguard = await deadline.within(
      guardRequests(context, (entry) => {
        if (blocked.length < 200) blocked.push(entry);
      }),
      10_000,
      'open',
    );
    const recorder = new NetworkRecorder(page);
    let completed = false;
    try {
      const navigated = Date.now();
      const response = await navigate(page, url, deadline);
      const finalUrl = page.url();
      stages.push(report('navigate', navigated, null));
      log('info', 'navigated', { finalUrl, status: response?.status() ?? null });

      const settled = Date.now();
      warnings.push(...(await settlePage(page, deadline)));
      stages.push(report('settle', settled, null));

      const stageContext: StageContext = {
        page,
        cdp,
        deadline,
        recorder,
        assets,
        logger,
        request,
        pageUrl: finalUrl,
        warnings,
      };

      let expired = false;
      const optional = async <T>(name: string, work: () => Promise<T>, empty: T): Promise<T> => {
        if (expired) {
          stages.push({ name, ms: 0, ok: false, error: 'skipped: the run ran out of time' });
          return empty;
        }
        const began = Date.now();
        try {
          const value = await work();
          stages.push(report(name, began, null));
          return value;
        } catch (error) {
          if (dependencies.signal?.aborted) throw new IngestionError('cancelled', `Cancelled during ${name}.`, { stage: name });
          if (deadline.signal.aborted) expired = true;
          const message = errorMessage(error).slice(0, 500);
          stages.push(report(name, began, message));
          warnings.push(`${name} failed: ${message}`);
          log('warn', 'stage_failed', { stage: name, error: message });
          return empty;
        }
      };

      const palette = await optional<Palette | null>('palette', () => extractPalette(stageContext), null);
      const typography = await optional<Typography | null>('typography', () => extractTypography(stageContext), null);
      const siteName = await optional('site-name', () => readSiteName(stageContext, finalUrl), hostLabel(finalUrl));
      const logos = await optional<{ logo: Logo | null; alternates: Logo[] }>(
        'logo',
        () => extractLogo(stageContext, siteName),
        { logo: null, alternates: [] },
      );
      const captures = await optional<ComponentCapture[]>('components', () => extractComponents(stageContext), []);

      await recorder.flush(2_000);
      warnings.push(...recorder.warnings);

      if (!palette && !typography && !logos.logo && captures.length === 0) {
        if (expired) deadline.check('extraction');
        throw new IngestionError('nothing_extracted', `Nothing could be measured on ${finalUrl}.`, { stage: 'extraction' });
      }

      const manifest = BrandIngestion.parse({
        schemaVersion: INGESTION_SCHEMA_VERSION,
        id: `ing_${randomBytes(8).toString('hex')}`,
        organizationId: request.organizationId,
        projectId: request.projectId,
        sourceUrl: url,
        finalUrl,
        title: (await page.title().catch(() => '')).slice(0, 500),
        lang: await page.evaluate(() => document.documentElement.getAttribute('lang')).catch(() => null),
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        provider: handle.provider,
        sessionId: handle.id,
        viewport: request.viewport,
        palette,
        typography,
        logo: logos.logo,
        logoAlternates: logos.alternates,
        captures,
        assets: assets.refs(),
        diagnostics: {
          warnings: [...new Set(warnings)].map((warning) => warning.slice(0, 500)).slice(0, 200),
          blockedRequests: blocked,
          stages,
        },
      });
      log('info', 'ingested', {
        durationMs: manifest.durationMs,
        colors: palette?.colors.length ?? 0,
        faces: typography?.faces.length ?? 0,
        captures: captures.length,
        bytes: assets.totalBytes,
      });
      completed = true;
      return { manifest, assets: assets.files() };
    } finally {
      /*
       * Bounded, every one: a request still hanging in the browser keeps
       * Playwright's route teardown waiting on it, and a cleanup step that
       * never returns would hold the vendor session open past the run's
       * deadline. Closing the browser below ends whatever is left.
       */
      recorder.stop();
      // After a failure nothing is gained by tidying a browser about to be closed.
      if (completed) {
        await bounded(unguard(), CLEANUP_STEP_MS);
        await bounded(cdp.detach(), CLEANUP_STEP_MS);
      }
    }
  } finally {
    if (handle) {
      const closed = await bounded(
        handle.close().then(
          () => true,
          (error: unknown) => {
            log('warn', 'close_failed', { error: errorMessage(error) });
            return true;
          },
        ),
        CLOSE_MS,
      );
      if (closed !== true) log('error', 'close_timed_out', { sessionId: handle.id, afterMs: CLOSE_MS });
    }
    deadline.dispose();
  }
}

const CLEANUP_STEP_MS = 3_000;
const CLOSE_MS = 20_000;

/** The promise's value, or undefined once `ms` have passed; never throws, never waits longer. */
async function bounded<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work.catch(() => undefined), elapsed]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Loads the page and refuses it when the load went somewhere it must not or
 * came back as something other than a page.
 */
async function navigate(page: PageHandle['page'], url: string, deadline: Deadline): Promise<Response | null> {
  let response: Response | null;
  try {
    response = await deadline.within(
      page.goto(url, { waitUntil: 'load', timeout: Math.max(1_000, Math.min(45_000, deadline.remaining())) }),
      50_000,
      'navigate',
    );
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    const message = errorMessage(error);
    if (/ERR_BLOCKED_BY_CLIENT/i.test(message)) {
      throw new IngestionError('blocked', `The page led somewhere we do not go: ${message.slice(0, 200)}`, { stage: 'navigate' });
    }
    if (/Timeout/i.test(message)) {
      throw new IngestionError('timeout', `The page did not finish loading: ${message.slice(0, 200)}`, { stage: 'navigate' });
    }
    throw new IngestionError('unreachable', `Could not load ${url}: ${message.slice(0, 300)}`, { stage: 'navigate', cause: error });
  }

  if (response) {
    const unsafe = redirectChainReason(response.request());
    if (unsafe) throw new IngestionError('blocked', `The page redirected somewhere we do not go (${unsafe}).`, { stage: 'navigate' });
    const status = response.status();
    if (status >= 400) {
      throw new IngestionError('http_error', `${url} answered ${status}.`, { stage: 'navigate', retryable: status >= 500 || status === 429 });
    }
  }
  const finalReason = unsafeRequestReason(page.url());
  if (finalReason) throw new IngestionError('blocked', `The page ended somewhere we do not go (${finalReason}).`, { stage: 'navigate' });

  const hasContent = await page
    .evaluate(() => (document.body?.innerText ?? '').trim().length > 0 || document.images.length > 0 || document.querySelector('svg,canvas,video') !== null)
    .catch(() => false);
  if (!hasContent) throw new IngestionError('empty_page', `${url} rendered nothing to read.`, { stage: 'navigate' });
  return response;
}

async function readSiteName(context: StageContext, finalUrl: string): Promise<string> {
  const named = await context.deadline.within(
    context.page.evaluate(() => {
      const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
      return { site: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'), title: document.title };
    }),
    5_000,
    'site-name',
  );
  if (named.site && named.site.length <= 60) return named.site;
  const segments = named.title
    .split(/\s[|\-–—·:]\s/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2 && segment.length <= 40);
  const host = hostLabel(finalUrl);
  return segments.find((segment) => segment.toLowerCase().includes(host.toLowerCase())) ?? segments.sort((a, b) => a.length - b.length)[0] ?? host;
}

function hostLabel(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return parts.length > 1 ? parts[parts.length - 2]! : parts[0]!;
  } catch {
    return '';
  }
}

function report(name: string, began: number, error: string | null): StageReport {
  return { name, ms: Math.max(0, Date.now() - began), ok: error === null, error };
}
