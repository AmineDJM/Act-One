import { z } from 'zod';
import {
  type BrandSystem,
  type CaptureKind,
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
import { extractCommunication } from './brand-communication.ts';
import { synthesiseUnderstanding, understandingConfidence } from './understanding.ts';
import { assessCapture, cropToFold, previewForModel } from './capture-quality.ts';
import { attachPublicCaptures, pageLabel, type CaptureCandidate } from './public-captures.ts';
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
  /** Called as each page is read, so the customer can watch the research happen. */
  onPage?: (page: VisitedPage) => void;
};

/** One page the crawl read, with what it gave and the capture of it. */
export type VisitedPage = {
  index: number;
  url: string;
  title: string;
  intent: PageIntent;
  reason: string;
  statusCode: number;
  capturedAt: string;
  /** The capture, when the page answered: full page for the homepage, the fold for the rest. */
  screenshot: Uint8Array | null;
  /** The visible text, trimmed to what a reader needs to recognise the page. */
  excerpt: string;
};

/** A public capture attached to a moment, with the bytes the caller stores. */
export type MomentCaptureBytes = {
  bytes: Uint8Array;
  kind: CaptureKind;
  pageUrl: string;
  label: string;
  width: number;
  height: number;
};

export type ResearchResult = {
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  /** Homepage screenshot bytes, used for the brand confirmation screen. */
  heroScreenshot: Uint8Array | null;
  /**
   * Public captures attached to the understanding's moments, keyed by moment
   * id. Bytes travel beside the understanding, not inside it: the moment holds
   * asset ids once the caller has stored these.
   */
  momentCaptures: Map<string, MomentCaptureBytes>;
  /**
   * What was considered and why it was refused, one line each, for the
   * operational log. A film with no product in it should be explainable
   * from the log, not a mystery to reproduce.
   */
  captureNotes: string[];
  pagesVisited: string[];
  /** Every page read, in the order it was read: the trail behind the brief. */
  pages: VisitedPage[];
  /** How many verbatim excerpts each page contributed, by URL. */
  evidenceByUrl: Record<string, number>;
  confidence: ReturnType<typeof understandingConfidence>;
};

/** How many product images to look for, per page and per crawl. */
const PRODUCT_IMAGES_PER_PAGE = 2;
const PRODUCT_IMAGES_PER_CRAWL = 8;
/** Pages whose imagery is likely to be the product rather than the company. */
const IMAGERY_INTENTS: readonly PageIntent[] = ['home', 'product', 'use_case', 'pricing', 'launch_profile'];

/**
 * What a model says a capture is. One schema for pages and product images so
 * both get a label the director can write against.
 */
const CaptureReading = z.object({
  kind: z.enum(['interface', 'web_page', 'photograph', 'illustration', 'other']),
  /** A dialog, cookie wall or overlay covering the content. */
  obstructed: z.boolean().default(false),
  /** What is on screen, in one plain sentence. */
  shows: z.string().max(240).default(''),
});

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

    const { captures, visited, pages } = await withFallback(
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
          onPage: input.onPage ?? (() => undefined),
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

    // How the brand speaks, read from the pages it wrote: the one part of the
    // DNA that cannot be measured, asked for as quotation rather than opinion.
    brand.communication = await extractCommunication(this.llm, { understanding, captures }, context);

    progress({ fraction: 0.9, message: 'Choosing what to show' });

    const { understanding: filmable, momentCaptures, captureNotes } = await this.attachCaptures(
      understanding,
      captures,
      root,
      context,
    );

    progress({ fraction: 0.98, message: 'Done' });

    const evidenceByUrl: Record<string, number> = {};
    for (const item of evidence) evidenceByUrl[item.sourceUrl] = (evidenceByUrl[item.sourceUrl] ?? 0) + 1;

    return {
      understanding: filmable,
      brand,
      heroScreenshot: homepage.screenshot,
      momentCaptures,
      captureNotes,
      pagesVisited: [...visited],
      pages,
      evidenceByUrl,
      confidence: understandingConfidence(filmable),
    };
  }

  /**
   * Gives the moments we could not observe something real to show.
   *
   * Candidates are the crawl's own page captures and the product imagery on
   * them. Each is measured (blank and photographic captures are dropped) and
   * then read by a model, which both confirms what it is and says what it
   * shows — the sentence the storyboard director writes copy against. The
   * assignment itself is pure and lives in `attachPublicCaptures`.
   */
  private async attachCaptures(
    understanding: ProductUnderstanding,
    captures: PageCapture[],
    root: string,
    context: CallContext,
  ): Promise<{
    understanding: ProductUnderstanding;
    momentCaptures: Map<string, MomentCaptureBytes>;
    captureNotes: string[];
  }> {
    const momentCaptures = new Map<string, MomentCaptureBytes>();
    const captureNotes: string[] = [];
    const unfilmed = understanding.productMoments.filter((moment) => moment.screenshots.length === 0);
    if (unfilmed.length === 0) {
      captureNotes.push('Every moment was observed in the product; no public capture needed.');
      return { understanding, momentCaptures, captureNotes };
    }

    const candidates: CaptureCandidate[] = [];
    let imagesTaken = 0;
    const where = (capture: PageCapture) => pageLabel(capture.url, '').replace(/ \(.*\)$/, '');

    for (const [pageIndex, capture] of captures.entries()) {
      for (const [imageIndex, image] of (capture.productImages ?? []).entries()) {
        if (imagesTaken >= PRODUCT_IMAGES_PER_CRAWL) break;
        const quality = await assessCapture(image.bytes, { expect: 'interface' }).catch(() => null);
        if (!quality || quality.verdict !== 'filmable') {
          captureNotes.push(
            `image ${imageIndex + 1} on ${where(capture)}: refused, ${quality?.verdict ?? 'unreadable'}`,
          );
          continue;
        }
        const reading = await this.readCapture(image.bytes, 'product image', context);
        if (reading && (reading.kind !== 'interface' || reading.obstructed)) {
          captureNotes.push(
            `image ${imageIndex + 1} on ${where(capture)}: refused, ` +
              `${reading.obstructed ? 'obstructed' : reading.kind}${reading.shows ? ` (${reading.shows})` : ''}`,
          );
          continue;
        }
        imagesTaken += 1;
        candidates.push({
          key: `${capture.url}#image${imageIndex}`,
          kind: 'product_image',
          pageUrl: capture.url,
          label: productImageLabel(capture, image.alt, reading?.shows ?? ''),
          bytes: image.bytes,
          width: quality.width,
          height: quality.height,
          rank: imageIndex,
        });
      }

      if (!capture.screenshot) {
        captureNotes.push(`${where(capture)}: no screenshot`);
        continue;
      }
      // The homepage was captured full-page for the brand; the film gets the fold.
      const fold = await cropToFold(capture.screenshot).catch(() => null);
      if (!fold) {
        captureNotes.push(`${where(capture)}: screenshot unreadable`);
        continue;
      }
      const quality = await assessCapture(fold.bytes, { expect: 'page' }).catch(() => null);
      if (!quality || quality.verdict !== 'filmable') {
        captureNotes.push(`${where(capture)}: page refused, ${quality?.verdict ?? 'unreadable'}`);
        continue;
      }
      const reading = await this.readCapture(fold.bytes, 'web page', context);
      if (reading?.obstructed) {
        captureNotes.push(`${where(capture)}: page refused, obstructed (${reading.shows})`);
        continue;
      }
      candidates.push({
        key: `${capture.url}#page`,
        kind: 'public_page',
        pageUrl: capture.url,
        label: reading?.shows
          ? `${pageLabel(capture.url, capture.title)} — ${reading.shows}`
          : pageLabel(capture.url, capture.title),
        bytes: fold.bytes,
        width: quality.width,
        height: quality.height,
        // The homepage first, then the crawl's own order, which is best-first.
        rank: 100 + pageIndex,
      });
    }

    const attached = attachPublicCaptures(understanding.productMoments, understanding.evidence, candidates, {
      homepageUrl: root,
    });
    for (const attachment of attached.attachments) {
      momentCaptures.set(attachment.momentId, {
        bytes: attachment.candidate.bytes,
        kind: attachment.candidate.kind,
        pageUrl: attachment.candidate.pageUrl,
        label: attachment.candidate.label,
        width: attachment.candidate.width,
        height: attachment.candidate.height,
      });
    }

    const images = attached.attachments.filter((a) => a.candidate.kind === 'product_image').length;
    const pages = attached.attachments.length - images;
    captureNotes.unshift(
      `${attached.attachments.length} of ${unfilmed.length} unobserved moments given a public capture ` +
        `(${images} product image${images === 1 ? '' : 's'}, ${pages} page${pages === 1 ? '' : 's'}) ` +
        `from ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}.`,
    );
    for (const moment of attached.moments) {
      if (moment.screenshots.length === 0 && !momentCaptures.has(moment.id)) {
        captureNotes.push(`"${moment.title}": nothing left to show it with; it will be typography.`);
      }
    }

    return {
      understanding: { ...understanding, productMoments: attached.moments },
      momentCaptures,
      captureNotes,
    };
  }

  /**
   * Asks a model what a capture is. Null when the call fails: the pixel
   * measurements already passed, and losing a label is not a reason to lose
   * the capture.
   */
  private async readCapture(
    bytes: Uint8Array,
    what: 'product image' | 'web page',
    context: CallContext,
  ): Promise<z.infer<typeof CaptureReading> | null> {
    try {
      const url = await previewForModel(bytes);
      const { value } = await this.llm.completeJson(
        [
          {
            role: 'system',
            content:
              'You classify captures for a film about a software product. ' +
              '"interface" means a screenshot of software: an application window, dashboard, editor, ' +
              'console or app screen, with or without a browser or device frame around it. ' +
              '"web_page" means a marketing or documentation page. A photograph of people, places or ' +
              'objects is "photograph"; drawn or abstract graphics are "illustration". ' +
              '"obstructed" is true when a dialog, cookie banner, sign-up wall or overlay covers the content. ' +
              '"shows" is one plain sentence naming what is on screen, in the product\'s own words where visible. ' +
              'Return JSON only.',
          },
          { role: 'user', content: `This capture is expected to be a ${what}. Classify it.` },
        ],
        {
          schema: CaptureReading,
          schemaName: 'CaptureReading',
          tier: 'fast',
          temperature: 0,
          maxOutputTokens: 200,
          images: [{ url, detail: 'low' }],
        },
        context,
      );
      return value;
    } catch {
      return null;
    }
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
      onPage: (page: VisitedPage) => void;
    },
  ): Promise<{ captures: PageCapture[]; visited: Set<string>; pages: VisitedPage[] }> {
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
    const pages: VisitedPage[] = [];

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
            // The product imagery the company published, where it is likely
            // to be the product: not on the blog, not on the about page.
            productImages: IMAGERY_INTENTS.includes(next.intent) ? PRODUCT_IMAGES_PER_PAGE : 0,
          });
          const page: VisitedPage = {
            index: pages.length,
            url: capture.url || next.url,
            title: capture.title,
            intent: next.intent,
            reason: next.reason,
            statusCode: capture.statusCode,
            capturedAt: capture.capturedAt,
            screenshot: capture.statusCode >= 400 ? null : capture.screenshot,
            excerpt: excerptOf(capture.text),
          };
          pages.push(page);
          params.onPage(page);
          // A 404 or a 500 has text, and that text is not evidence about the
          // product. The page stays visited so it is not planned again.
          if (capture.statusCode >= 400) continue;
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

    return { captures, visited, pages };
  }
}

/** The first few lines a reader would recognise the page by, without the navigation. */
function excerptOf(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24 && line.length <= 400);
  return lines.slice(0, 4).join(' ').slice(0, 600);
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

function productImageLabel(capture: PageCapture, alt: string, shows: string): string {
  const where = pageLabel(capture.url, '').replace(/ \(.*\)$/, '');
  const detail = shows || alt;
  return detail ? `product image on ${where} — ${detail.slice(0, 160)}` : `product image on ${where}`;
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
