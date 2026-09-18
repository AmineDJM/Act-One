import { describe, it, expect } from 'vitest';
import type { Evidence, ProductMoment } from '@act-one/core';
import { attachPublicCaptures, pageLabel, type CaptureCandidate } from '../public-captures.ts';

function moment(over: Partial<ProductMoment> & Pick<ProductMoment, 'id'>): ProductMoment {
  return {
    title: over.id,
    description: '',
    startState: '',
    endState: '',
    screenshots: [],
    recording: null,
    sourceUrl: null,
    wowScore: 0.35,
    relevanceScore: 0.6,
    interactionSteps: [],
    requiresAuth: false,
    elementBounds: null,
    evidenceIds: [],
    captureKind: null,
    captureLabel: '',
    captureAspect: null,
    ...over,
  };
}

function evidence(id: string, sourceUrl: string): Evidence {
  return { id, kind: 'page_text', sourceUrl, excerpt: 'x'.repeat(20), capturedAt: '2026-01-01T00:00:00.000Z', confidence: 1 };
}

function candidate(over: Partial<CaptureCandidate> & Pick<CaptureCandidate, 'key' | 'kind' | 'pageUrl'>): CaptureCandidate {
  return {
    label: over.key,
    bytes: new Uint8Array([1]),
    width: 1600,
    height: 1000,
    rank: 0,
    ...over,
  };
}

const HOME = 'https://acme.com/';
const PRICING = 'https://acme.com/pricing';
const PRODUCT = 'https://acme.com/product';

describe('attachPublicCaptures', () => {
  it('gives a moment the page its own evidence came from', () => {
    const { moments, attachments } = attachPublicCaptures(
      [moment({ id: 'm1', evidenceIds: ['e_pricing'] })],
      [evidence('e_pricing', PRICING), evidence('e_home', HOME)],
      [candidate({ key: 'home', kind: 'public_page', pageUrl: HOME }), candidate({ key: 'pricing', kind: 'public_page', pageUrl: PRICING })],
      { homepageUrl: HOME },
    );
    expect(attachments.map((a) => [a.momentId, a.candidate.key])).toEqual([['m1', 'pricing']]);
    expect(moments[0]).toMatchObject({ sourceUrl: PRICING, captureKind: 'public_page', captureAspect: 1.6 });
  });

  it('prefers a published product image on that page over the page itself', () => {
    const { attachments } = attachPublicCaptures(
      [moment({ id: 'm1', evidenceIds: ['e_product'] })],
      [evidence('e_product', PRODUCT)],
      [
        candidate({ key: 'product-page', kind: 'public_page', pageUrl: PRODUCT }),
        candidate({ key: 'product-shot', kind: 'product_image', pageUrl: PRODUCT, width: 1400, height: 900 }),
      ],
      { homepageUrl: HOME },
    );
    expect(attachments[0]?.candidate.key).toBe('product-shot');
  });

  it('never gives two moments the same capture', () => {
    // Two scenes of the same page is the template look. The second moment
    // falls back to the homepage; a third with nothing left stays unfilmed.
    const { moments, attachments } = attachPublicCaptures(
      [
        moment({ id: 'm1', evidenceIds: ['e_pricing'], relevanceScore: 0.7 }),
        moment({ id: 'm2', evidenceIds: ['e_pricing'], relevanceScore: 0.6 }),
        moment({ id: 'm3', evidenceIds: ['e_pricing'], relevanceScore: 0.5 }),
      ],
      [evidence('e_pricing', PRICING)],
      [candidate({ key: 'pricing', kind: 'public_page', pageUrl: PRICING }), candidate({ key: 'home', kind: 'public_page', pageUrl: HOME })],
      { homepageUrl: HOME },
    );
    expect(attachments.map((a) => [a.momentId, a.candidate.key])).toEqual([
      ['m1', 'pricing'],
      ['m2', 'home'],
    ]);
    expect(moments[2]?.captureKind).toBeNull();
  });

  it('lets the strongest moment choose first', () => {
    const { attachments } = attachPublicCaptures(
      [
        moment({ id: 'weak', evidenceIds: ['e_home'], relevanceScore: 0.4 }),
        moment({ id: 'strong', evidenceIds: ['e_home'], relevanceScore: 0.75 }),
      ],
      [evidence('e_home', HOME)],
      [
        candidate({ key: 'hero-shot', kind: 'product_image', pageUrl: HOME }),
        candidate({ key: 'home', kind: 'public_page', pageUrl: HOME }),
      ],
      { homepageUrl: HOME },
    );
    expect(attachments.find((a) => a.momentId === 'strong')?.candidate.key).toBe('hero-shot');
    expect(attachments.find((a) => a.momentId === 'weak')?.candidate.key).toBe('home');
  });

  it('sends a moment with no evidence to the homepage', () => {
    const { attachments } = attachPublicCaptures(
      [moment({ id: 'm1' })],
      [],
      [candidate({ key: 'home', kind: 'public_page', pageUrl: HOME })],
      { homepageUrl: HOME },
    );
    expect(attachments[0]?.candidate.key).toBe('home');
  });

  it('leaves observed moments alone', () => {
    const observed = moment({ id: 'seen', screenshots: ['ast_1'], captureKind: 'in_app', evidenceIds: ['e_home'] });
    const { moments, attachments } = attachPublicCaptures(
      [observed],
      [evidence('e_home', HOME)],
      [candidate({ key: 'home', kind: 'public_page', pageUrl: HOME })],
      { homepageUrl: HOME },
    );
    expect(attachments).toEqual([]);
    expect(moments[0]).toBe(observed);
  });

  it('raises the wow of a published image above a page, and both below the product in use', () => {
    const { moments } = attachPublicCaptures(
      [moment({ id: 'a', evidenceIds: ['e_product'] }), moment({ id: 'b', evidenceIds: ['e_pricing'] })],
      [evidence('e_product', PRODUCT), evidence('e_pricing', PRICING)],
      [
        candidate({ key: 'shot', kind: 'product_image', pageUrl: PRODUCT }),
        candidate({ key: 'pricing', kind: 'public_page', pageUrl: PRICING }),
      ],
      { homepageUrl: HOME },
    );
    expect(moments[0]?.wowScore).toBe(0.55);
    expect(moments[1]?.wowScore).toBe(0.45);
  });
});

describe('pageLabel', () => {
  it('names the page in words a director can use', () => {
    expect(pageLabel('https://www.acme.com/', '')).toBe('the homepage (acme.com)');
    expect(pageLabel('https://acme.com/pricing', 'Pricing – Acme')).toBe(
      'the pricing page (acme.com/pricing) — “Pricing – Acme”',
    );
    expect(pageLabel('https://acme.com/blog/post', '')).toBe('a page of the site (acme.com/blog/post)');
  });
});
