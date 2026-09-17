import { describe, it, expect } from 'vitest';
import { classifyUrl, classifyExternal, initialPlan, expandPlan, INTENT_BUDGET } from '../index.ts';
import type { PageIntent } from '../index.ts';

describe('classifyUrl', () => {
  it('ranks the pages a film actually needs above the rest', () => {
    const pricing = classifyUrl('https://acme.com/pricing');
    const blog = classifyUrl('https://acme.com/blog/we-raised-a-seed');
    const product = classifyUrl('https://acme.com/product');

    expect(pricing.intent).toBe('pricing');
    expect(product.intent).toBe('product');
    expect(pricing.score).toBeGreaterThan(blog.score);
    expect(product.score).toBeGreaterThan(blog.score);
  });

  it('gives the homepage top priority', () => {
    expect(classifyUrl('https://acme.com/')).toEqual({ intent: 'home', score: 100 });
  });

  it('excludes pages that never carry anything a film needs', () => {
    for (const url of [
      'https://acme.com/careers',
      'https://acme.com/privacy',
      'https://acme.com/terms',
      'https://acme.com/login',
      'https://acme.com/whitepaper.pdf',
      'https://acme.com/blog/tag/engineering',
      'https://acme.com/sitemap.xml',
    ]) {
      expect(classifyUrl(url).score, url).toBe(0);
    }
  });

  it('prefers a section index over a deep detail page', () => {
    const index = classifyUrl('https://acme.com/use-cases');
    const detail = classifyUrl('https://acme.com/use-cases/finance/reconciliation');
    expect(index.score).toBeGreaterThan(detail.score);
  });

  it('recognises launch profiles on external hosts', () => {
    expect(classifyExternal('https://www.producthunt.com/posts/acme')?.intent).toBe('launch_profile');
    expect(classifyExternal('https://www.linkedin.com/company/acme')?.intent).toBe('launch_profile');
    expect(classifyExternal('https://random.example/page')).toBeNull();
  });
});

describe('initialPlan', () => {
  it('starts at the homepage and honours customer-supplied links first', () => {
    const plan = initialPlan('acme.com', {
      seeds: ['https://www.producthunt.com/posts/acme', 'https://acme.com/blog/launch'],
    });

    expect(plan[0]?.url).toBe('https://acme.com/');
    const blog = plan.find((p) => p.url.includes('/blog/launch'));
    // A blog post the customer pointed at is worth far more than one we found.
    expect(blog?.score).toBeGreaterThanOrEqual(90);
    expect(blog?.reason).toMatch(/customer/i);
  });

  it('returns nothing for an unusable URL', () => {
    expect(initialPlan('not a url at all')).toEqual([]);
  });
});

describe('expandPlan', () => {
  const root = 'https://acme.com/';

  it('stays on the company’s own domain', () => {
    const plan = expandPlan([], new Set([root]), [
      { href: 'https://acme.com/pricing', text: 'Pricing' },
      { href: 'https://competitor.io/pricing', text: 'Pricing' },
      { href: 'https://twitter.com/acme', text: 'Twitter' },
    ], root, 10);

    expect(plan.map((p) => p.url)).toEqual(['https://acme.com/pricing']);
  });

  it('boosts links whose anchor text signals value', () => {
    const plan = expandPlan([], new Set([root]), [
      { href: 'https://acme.com/x/y', text: 'See how it works' },
      { href: 'https://acme.com/a/b', text: 'Read more' },
    ], root, 10);

    expect(plan[0]?.url).toBe('https://acme.com/x/y');
  });

  it('spreads the budget across intents instead of draining one section', () => {
    const links = [
      ...Array.from({ length: 8 }, (_, i) => ({
        href: `https://acme.com/blog/post-${i}`,
        text: `Post ${i}`,
      })),
      { href: 'https://acme.com/pricing', text: 'Pricing' },
      { href: 'https://acme.com/product', text: 'Product' },
    ];
    const plan = expandPlan([], new Set([root]), links, root, 10);
    const blogCount = plan.filter((p) => p.intent === 'blog').length;

    expect(blogCount).toBeLessThanOrEqual(INTENT_BUDGET);
    expect(plan.map((p) => p.intent)).toContain('pricing');
    expect(plan.map((p) => p.intent)).toContain('product');
  });

  it('carries the intent budget across crawl steps', () => {
    // The plan is rebuilt on every step. Without cumulative accounting the cap
    // resets each time and the crawl spends its whole budget on one section.
    const links = Array.from({ length: 6 }, (_, i) => ({
      href: `https://acme.com/blog/post-${i}`,
      text: `Post ${i}`,
    }));
    const spent = new Map<PageIntent, number>([['blog', INTENT_BUDGET]]);
    const plan = expandPlan([], new Set([root]), links, root, 10, spent);

    expect(plan.filter((p) => p.intent === 'blog')).toEqual([]);
  });

  it('never re-plans a page already visited', () => {
    const visited = new Set([root, 'https://acme.com/pricing']);
    const plan = expandPlan([], visited, [{ href: 'https://acme.com/pricing', text: 'Pricing' }], root, 10);
    expect(plan).toEqual([]);
  });
});
