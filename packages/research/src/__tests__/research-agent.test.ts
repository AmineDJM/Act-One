import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ScriptedLlmProvider } from '@act-one/providers';
import type {
  BrowserAutomationProvider,
  BrowserSession,
  CaptureOptions,
  LlmMessage,
  PageCapture,
  ProviderHealth,
} from '@act-one/providers';
import { ProductResearchAgent } from '../index.ts';

/**
 * The whole research pass with a canned site and a scripted model, asserting
 * the one thing that matters at the end: the moments the brief hands to the
 * storyboard engine have something real to show.
 */
async function interfacePng(width: number, height: number): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const dark = y < 40 || (x > 240 && (y % 36) > 12 && (y % 36) < 22 && x < 240 + ((y * 7) % 500));
      const side = x < 200 && y >= 40;
      const [r, g, b] = dark ? [30, 32, 38] : side ? [244, 245, 247] : [255, 255, 255];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

type Site = Record<string, { title: string; text: string; links: string[]; productImages?: { alt: string }[] }>;

class FakeBrowser implements BrowserAutomationProvider {
  readonly name = 'fake';
  readonly kind = 'browser' as const;
  readonly requested: CaptureOptions[] = [];
  constructor(
    private readonly site: Site,
    private readonly pageShot: Uint8Array,
    private readonly imageShot: Uint8Array,
  ) {}
  async health(): Promise<ProviderHealth> {
    return { provider: this.name, kind: 'browser', healthy: true, checkedAt: new Date().toISOString() };
  }
  async createSession(): Promise<BrowserSession> {
    let current = '';
    const site = this.site;
    const requested = this.requested;
    const pageShot = this.pageShot;
    const imageShot = this.imageShot;
    return {
      id: 'sec_fake',
      async goto(url) {
        current = url.replace(/\/$/, '');
      },
      async capture(options = {}): Promise<PageCapture> {
        requested.push(options);
        const page = site[current] ?? { title: 'Not found', text: '', links: [] };
        return {
          url: new URL(current).pathname === '/' ? `${current}/` : current,
          title: page.title,
          text: page.text,
          html: `<html><head><title>${page.title}</title></head><body></body></html>`,
          screenshot: pageShot,
          styleProfile: null,
          links: page.links.map((href) => ({ href, text: href })),
          statusCode: site[current] ? 200 : 404,
          capturedAt: new Date().toISOString(),
          ...(options.productImages && page.productImages
            ? {
                productImages: page.productImages.slice(0, options.productImages).map((image, index) => ({
                  bytes: imageShot,
                  alt: image.alt,
                  width: 1100,
                  height: 700,
                  top: 400 + index * 800,
                  src: `${current}/img${index}.png`,
                })),
              }
            : {}),
        };
      },
      async screenshot() {
        return pageShot;
      },
      async boundsOf() {
        return null;
      },
      async perform() {},
      async record() {
        return { video: null, frames: [], durationSeconds: 0 };
      },
      async currentUrl() {
        return current;
      },
      async clearState() {},
      async close() {},
    };
  }
}

const HOME = 'https://acme.com';
const site: Site = {
  [HOME]: {
    title: 'Acme — Close the books while you sleep',
    text: 'Acme reconciles invoices without a spreadsheet.\nReconciliation runs overnight and leaves you the exceptions.\nTrusted by finance teams.',
    links: [`${HOME}/pricing`, `${HOME}/product`],
    productImages: [{ alt: 'The Acme reconciliation dashboard' }],
  },
  [`${HOME}/pricing`]: {
    title: 'Pricing — Acme',
    text: 'Pricing\nStarter $49 per month for small teams.\nEvery plan includes unlimited reconciliations.',
    links: [],
  },
  [`${HOME}/product`]: {
    title: 'Product — Acme',
    text: 'Exceptions review\nThe few rows that need a human are queued for review with their source documents attached.',
    links: [],
    productImages: [{ alt: 'Exception review queue' }],
  },
};

function agentWith(browser: FakeBrowser, readings: Record<string, unknown>) {
  const llm = new ScriptedLlmProvider([
    {
      when: /Classify it/,
      respond: (messages: LlmMessage[]) => {
        const prompt = messages.map((m) => m.content).join('\n');
        return prompt.includes('product image') ? readings['image'] : readings['page'];
      },
    },
    {
      when: /Evidence:/,
      respond: (messages: LlmMessage[]) => {
        // Cite whatever evidence ids the prompt offered for each page: the
        // test is about matching, not about the model's judgement.
        const prompt = messages.map((m) => m.content).join('\n');
        const ids = [...prompt.matchAll(/\[(evt_[a-z0-9]+)\]/g)].map((m) => m[1]!);
        const from = (page: string) => ids.filter((id) => lineWith(prompt, id).includes(`@ ${HOME}${page}`));
        const pricingIds = from('/pricing');
        const productIds = from('/product');
        return {
          name: 'Acme',
          oneLiner: 'Reconciles invoices without a spreadsheet.',
          category: 'Finance automation',
          targetAudience: ['Finance teams'],
          keyBenefits: [{ text: 'Reconciles invoices without a spreadsheet.', evidenceIds: ids.slice(0, 1) }],
          tone: 'Direct',
          suggestedMoments: [
            { title: 'Exceptions queued for review', relevanceScore: 0.8, evidenceIds: productIds },
            { title: 'Plans that include unlimited runs', relevanceScore: 0.6, evidenceIds: pricingIds },
            { title: 'Overnight reconciliation', relevanceScore: 0.7, evidenceIds: [] },
          ],
        };
      },
    },
  ]);
  return new ProductResearchAgent(browser, llm);
}

function lineWith(prompt: string, id: string): string {
  return prompt.split('\n').find((line) => line.includes(`[${id}]`)) ?? '';
}

describe('ProductResearchAgent', () => {
  it('gives the brief real captures to film, matched to what each moment is about', async () => {
    const browser = new FakeBrowser(site, await interfacePng(1600, 1000), await interfacePng(1100, 700));
    const agent = agentWith(browser, {
      image: { kind: 'interface', obstructed: false, shows: 'A reconciliation dashboard with an exceptions list' },
      page: { kind: 'web_page', obstructed: false, shows: 'A marketing page' },
    });

    const result = await agent.research(
      { organizationId: 'org_1', projectId: 'prj_1', websiteUrl: HOME, maxPages: 6 },
      { organizationId: 'org_1' },
    );

    const moments = result.understanding.productMoments;
    expect(moments).toHaveLength(3);

    // Every suggested moment left research with something real to show.
    for (const moment of moments) {
      expect(result.momentCaptures.has(moment.id), moment.title).toBe(true);
      expect(moment.captureKind, moment.title).not.toBeNull();
      expect(moment.captureLabel.length).toBeGreaterThan(0);
      expect(moment.captureAspect).toBeGreaterThan(1);
    }

    // The exceptions moment cites the product page, which published a product
    // image: it gets that, not the page.
    const exceptions = moments.find((m) => m.title.startsWith('Exceptions'))!;
    expect(exceptions.captureKind).toBe('product_image');
    expect(exceptions.sourceUrl).toBe(`${HOME}/product`);
    expect(exceptions.captureLabel).toContain('A reconciliation dashboard');

    // The pricing moment cites the pricing page, which has no product image.
    const plans = moments.find((m) => m.title.startsWith('Plans'))!;
    expect(plans.captureKind).toBe('public_page');
    expect(plans.sourceUrl).toBe(`${HOME}/pricing`);

    // No two moments show the same capture.
    const keys = [...result.momentCaptures.values()].map((c) => `${c.kind}:${c.pageUrl}:${c.label}`);
    expect(new Set(keys).size).toBe(keys.length);

    // Product imagery was only asked for where it is likely to be the product.
    const asked = browser.requested.filter((o) => (o.productImages ?? 0) > 0).length;
    expect(asked).toBeGreaterThanOrEqual(2);
    expect(result.confidence.score).toBeGreaterThan(0);
  });

  it('drops a published image the model says is not an interface', async () => {
    const browser = new FakeBrowser(site, await interfacePng(1600, 1000), await interfacePng(1100, 700));
    const agent = agentWith(browser, {
      image: { kind: 'photograph', obstructed: false, shows: 'People at a desk' },
      page: { kind: 'web_page', obstructed: false, shows: 'A marketing page' },
    });

    const result = await agent.research(
      { organizationId: 'org_1', projectId: 'prj_1', websiteUrl: HOME, maxPages: 6 },
      { organizationId: 'org_1' },
    );

    for (const capture of result.momentCaptures.values()) {
      expect(capture.kind).toBe('public_page');
    }
  });

  it('drops a page the model says is covered by a dialog', async () => {
    const browser = new FakeBrowser(site, await interfacePng(1600, 1000), await interfacePng(1100, 700));
    const agent = agentWith(browser, {
      image: { kind: 'interface', obstructed: false, shows: 'Dashboard' },
      page: { kind: 'web_page', obstructed: true, shows: 'A cookie wall' },
    });

    const result = await agent.research(
      { organizationId: 'org_1', projectId: 'prj_1', websiteUrl: HOME, maxPages: 6 },
      { organizationId: 'org_1' },
    );

    for (const capture of result.momentCaptures.values()) {
      expect(capture.kind).toBe('product_image');
    }
  });
});
