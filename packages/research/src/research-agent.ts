import {
  type BrandSystem,
  type Evidence,
  type LaunchContext,
  type ProductMoment,
  type ProductUnderstanding,
} from '@act-one/core';
import type {
  BrowserAutomationProvider,
  BrowserSession,
  CallContext,
  LlmProvider,
  PageCapture,
} from '@act-one/providers';
import { PolicyViolation, policyForPublicResearch, withFallback } from '@act-one/providers';
import { expandPlan, initialPlan, type PageIntent, type PlannedPage } from './crawl-plan.ts';
import { dedupeEvidence, extractEvidence, extractMeta } from './evidence.ts';
import { extractBrandSystem } from './brand-extractor.ts';
import { synthesiseUnderstanding, understandingConfidence } from './understanding.ts';
import { normalizeUrl } from './url.ts';

export type ResearchInput = {
  organizationId: string;
  projectId: string;
  websiteUrl: string;
  supplementalUrls?: string[];
  brandName?: string;
  hints?: {
    targetAudience?: string | null;
    goal?: LaunchContext | null;
    keyMessage?: string | null;
  };
  /** Real moments from authenticated exploration, if the customer gave access. */
  capturedMoments?: ProductMoment[];
  maxPages?: number;
  onProgress?: (progress: { fraction: number; message: string }) => void;
};

export type ResearchResult = {
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  /** Homepage screenshot bytes, used for the brand confirmation screen. */
  heroScreenshot: Uint8Array | null;
  pagesVisited: string[];
  confidence: ReturnType<typeof understandingConfidence>;
};

/**
 * The Product Research Agent.
 *
 * Reads a company the way a strategist would before a pitch: homepage first,
 * then pricing and product, then whatever the site itself signals is important,
 * stopping when the questions a film needs are answered rather than when the
 * site runs out of pages.
 *
 * Two outputs, produced very differently on purpose. The brand system is
 * *measured* from the rendered pages and involves no model at all. The product
 * understanding is *synthesised* by a model, but only from verbatim excerpts,
 * with every claim required to cite the excerpt that supports it.
 */
export class ProductResearchAgent {
  private readonly browser: BrowserAutomationProvider;
  private readonly llm: LlmProvider;
  private readonly browserFallback: BrowserAutomationProvider | null;

  constructor(
    browser: BrowserAutomationProvider,
    llm: LlmProvider,
    browserFallback: BrowserAutomationProvider | null = null,
  ) {
    this.browser = browser;
    this.llm = llm;
    this.browserFallback = browserFallback;
  }

  async research(input: ResearchInput, context: CallContext): Promise<ResearchResult> {
    const root = normalizeUrl(input.websiteUrl);
    if (!root) {
      throw new PolicyViolation(`That does not look like a website we can read: ${input.websiteUrl}`);
    }

    const maxPages = input.maxPages ?? 14;
    const seeds = (input.supplementalUrls ?? []).map(normalizeUrl).filter((u): u is string => u !== null);
    const policy = policyForPublicResearch([root, ...seeds], maxPages + 4);

    const progress = input.onProgress ?? (() => undefined);
    progress({ fraction: 0.02, message: 'Opening a browser' });

    const { captures, visited } = await withFallback(
      this.browser,
      this.browserFallback,
      (provider) =>
        this.crawl(provider, {
          root,
          seeds,
          policy,
          maxPages,
          organizationId: input.organizationId,
          projectId: input.projectId,
          context,
          progress,
        }),
    );

    if (captures.length === 0) {
      throw new PolicyViolation(`We could not read anything at ${root}.`);
    }

    progress({ fraction: 0.62, message: 'Reading the brand' });

    const homepage = captures[0]!;
    const brand = extractBrandSystem({
      organizationId: input.organizationId,
      name: input.brandName ?? hostLabel(root),
      captures,
      themeColor: extractMeta(homepage.html).themeColor,
    });

    progress({ fraction: 0.7, message: 'Gathering evidence' });

    const evidence: Evidence[] = dedupeEvidence(
      captures.flatMap((capture, index) =>
        extractEvidence(capture, {
          intent: index === 0 ? 'home' : 'other',
          maxSegments: index === 0 ? 50 : 24,
        }),
      ),
    );

    progress({ fraction: 0.78, message: 'Understanding the product' });

    const understanding = await synthesiseUnderstanding(
      this.llm,
      {
        projectId: input.projectId,
        websiteUrl: root,
        evidence,
        capturedMoments: input.capturedMoments ?? [],
        hints: input.hints ?? {},
      },
      context,
    );

    progress({ fraction: 0.98, message: 'Done' });

    return {
      understanding,
      brand,
      heroScreenshot: homepage.screenshot,
      pagesVisited: [...visited],
      confidence: understandingConfidence(understanding),
    };
  }

  private async crawl(
    provider: BrowserAutomationProvider,
    params: {
      root: string;
      seeds: string[];
      policy: ReturnType<typeof policyForPublicResearch>;
      maxPages: number;
      organizationId: string;
      projectId: string;
      context: CallContext;
      progress: (p: { fraction: number; message: string }) => void;
    },
  ): Promise<{ captures: PageCapture[]; visited: Set<string> }> {
    const session: BrowserSession = await provider.createSession(
      {
        projectId: params.projectId,
        organizationId: params.organizationId,
        policy: params.policy,
        viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
      },
      params.context,
    );

    const captures: PageCapture[] = [];
    const visited = new Set<string>();

    try {
      let plan: PlannedPage[] = initialPlan(params.root, {
        seeds: params.seeds,
        maxPages: params.maxPages,
      });
      const visitedIntents = new Map<PageIntent, number>();

      while (plan.length > 0 && captures.length < params.maxPages) {
        const next = plan.shift()!;
        if (visited.has(next.url)) continue;
        visited.add(next.url);

        try {
          await session.goto(next.url);
          const capture = await session.capture({
            hideChrome: true,
            freezeAnimations: true,
            // Only the homepage needs a full-page capture; for the rest the
            // fold is where the positioning lives and full-page captures of
            // long marketing pages are slow and mostly footer.
            fullPage: captures.length === 0,
          });
          captures.push(capture);
          visitedIntents.set(next.intent, (visitedIntents.get(next.intent) ?? 0) + 1);

          params.progress({
            fraction: 0.05 + (captures.length / params.maxPages) * 0.55,
            message: `Read ${labelFor(next)}`,
          });

          plan = expandPlan(
            plan,
            visited,
            capture.links,
            params.root,
            params.maxPages,
            visitedIntents,
          );
        } catch (error) {
          if (error instanceof PolicyViolation) continue;
          // A single dead page is normal on a marketing site; the crawl
          // continues and the brief simply cites less.
          continue;
        }
      }
    } finally {
      await session.close();
    }

    return { captures, visited };
  }
}

function labelFor(page: PlannedPage): string {
  const path = (() => {
    try {
      const p = new URL(page.url).pathname.replace(/\/$/, '');
      return p.length > 1 ? p : '';
    } catch {
      return '';
    }
  })();
  const labels: Record<string, string> = {
    home: 'the homepage',
    pricing: 'pricing',
    product: 'the product pages',
    use_case: 'use cases',
    customers: 'customer stories',
    docs: 'the docs',
    changelog: 'the changelog',
    about: 'the about page',
    blog: 'the blog',
    launch_profile: 'their public profile',
    other: 'another page',
  };
  const label = labels[page.intent] ?? 'a page';
  // Two pages can share an intent, and "Read pricing" twice in the progress
  // panel reads like the system is stuck.
  return path ? `${label} (${path})` : label;
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.')[0] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Product';
  }
}
