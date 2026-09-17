import { normalizeUrl, registrableDomainOf } from './url.ts';

/**
 * What to read, and in what order.
 *
 * A launch film needs a specific, small set of facts: what this is, who it is
 * for, what it replaces, what it costs, and what it looks like in use. Crawling
 * a marketing site breadth-first buries those under press releases and careers
 * pages, so pages are scored by how likely they are to carry one of those
 * facts and visited best-first under a tight budget.
 */
export type PageIntent =
  | 'home'
  | 'pricing'
  | 'product'
  | 'use_case'
  | 'customers'
  | 'docs'
  | 'changelog'
  | 'about'
  | 'blog'
  | 'launch_profile'
  | 'other';

export type PlannedPage = {
  url: string;
  intent: PageIntent;
  /** Higher is read sooner. */
  score: number;
  reason: string;
};

const INTENT_RULES: { intent: PageIntent; score: number; patterns: RegExp[] }[] = [
  {
    intent: 'pricing',
    score: 92,
    patterns: [/\/pricing/i, /\/plans?/i, /\/price/i],
  },
  {
    intent: 'product',
    score: 88,
    patterns: [/\/product/i, /\/platform/i, /\/features?/i, /\/how-it-works/i, /\/why-/i],
  },
  {
    intent: 'use_case',
    score: 78,
    patterns: [/\/use-cases?/i, /\/solutions?/i, /\/for-[a-z]+/i, /\/industries/i],
  },
  {
    intent: 'customers',
    score: 74,
    patterns: [/\/customers?/i, /\/case-stud/i, /\/testimonial/i, /\/stories/i],
  },
  {
    intent: 'docs',
    score: 62,
    patterns: [/\/docs?/i, /\/documentation/i, /\/guides?/i, /\/api\b/i, /\/quickstart/i],
  },
  {
    intent: 'changelog',
    score: 58,
    patterns: [/\/changelog/i, /\/releases?/i, /\/whats-new/i, /\/updates/i],
  },
  {
    intent: 'about',
    score: 48,
    patterns: [/\/about/i, /\/company/i, /\/team/i, /\/manifesto/i, /\/mission/i],
  },
  {
    intent: 'blog',
    score: 30,
    patterns: [/\/blog/i, /\/news/i, /\/press/i, /\/resources/i],
  },
];

/**
 * How many pages of any one intent are worth reading. Two pricing pages tell
 * you the pricing; a third is the same information in a different layout.
 */
export const INTENT_BUDGET = 2;

/** Pages that never contain anything a film needs. */
const EXCLUDE = [
  /\/(careers?|jobs?|hiring)\b/i,
  /\/(privacy|terms|legal|dpa|gdpr|cookie|security-policy|sub-?processors)\b/i,
  /\/(login|signin|signup|register|auth|account|logout)\b/i,
  /\/(support|help|contact|status)\b/i,
  /\/(rss|feed|sitemap|robots)\b/i,
  /\.(pdf|zip|dmg|exe|csv|xml|json|png|jpg|jpeg|svg|gif|webp|mp4|woff2?)($|\?)/i,
  /\/tag\//i,
  /\/author\//i,
  /\/category\//i,
];

export function classifyUrl(url: string): { intent: PageIntent; score: number } {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return { intent: 'other', score: 0 };
  }

  if (path === '/' || path === '') return { intent: 'home', score: 100 };
  if (EXCLUDE.some((pattern) => pattern.test(path))) return { intent: 'other', score: 0 };

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(path))) {
      // A deep path under a matched section is usually a detail page: still
      // relevant, but the section index is a better use of the budget.
      const depth = path.split('/').filter(Boolean).length;
      return { intent: rule.intent, score: Math.max(10, rule.score - (depth - 1) * 9) };
    }
  }
  return { intent: 'other', score: 12 };
}

export function classifyExternal(url: string): { intent: PageIntent; score: number } | null {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (/producthunt\.com$/.test(host)) return { intent: 'launch_profile', score: 86 };
  if (/linkedin\.com$/.test(host)) return { intent: 'launch_profile', score: 70 };
  if (/(github\.com|crunchbase\.com)$/.test(host)) return { intent: 'launch_profile', score: 55 };
  return null;
}

export type PlanOptions = {
  maxPages?: number;
  /** URLs the customer explicitly supplied; always read, always first. */
  seeds?: string[];
};

/**
 * Builds the initial plan from the site root plus any supplemental links.
 * The plan is refined as pages are read — see expandPlan.
 */
export function initialPlan(websiteUrl: string, options: PlanOptions = {}): PlannedPage[] {
  const root = normalizeUrl(websiteUrl);
  if (!root) return [];
  const planned: PlannedPage[] = [
    { url: root, intent: 'home', score: 100, reason: 'Product homepage' },
  ];

  for (const seed of options.seeds ?? []) {
    const url = normalizeUrl(seed);
    if (!url || url === root) continue;
    const external = classifyExternal(url);
    const classified = external ?? classifyUrl(url);
    planned.push({
      url,
      // A customer-supplied link is evidence of what they think matters, so it
      // outranks anything we discovered ourselves.
      score: Math.max(classified.score, 90),
      intent: classified.intent,
      reason: 'Supplied by the customer',
    });
  }

  return dedupe(planned).slice(0, options.maxPages ?? 24);
}

/** Merges newly discovered links into the plan, keeping it scored and unique. */
export function expandPlan(
  plan: PlannedPage[],
  visited: Set<string>,
  links: { href: string; text: string }[],
  rootUrl: string,
  maxPages: number,
  /**
   * How many pages of each intent have already been read. The plan is rebuilt
   * on every crawl step, so without carrying this across calls the per-intent
   * cap resets each time and the crawl drains its budget on one section.
   */
  visitedIntents: Map<PageIntent, number> = new Map(),
): PlannedPage[] {
  const rootDomain = registrableDomainOf(rootUrl);
  const candidates: PlannedPage[] = [...plan];

  for (const link of links) {
    const url = normalizeUrl(link.href);
    if (!url || visited.has(url)) continue;
    if (registrableDomainOf(url) !== rootDomain) continue;

    const { intent, score } = classifyUrl(url);
    if (score <= 0) continue;

    // Anchor text is a strong signal that the URL alone misses: "See how it
    // works" pointing at /x/y is worth more than the path suggests.
    const boost = /pricing|how it works|product|demo|features|customers|use case/i.test(link.text)
      ? 12
      : 0;
    candidates.push({ url, intent, score: score + boost, reason: link.text.slice(0, 80) || intent });
  }

  const wanted = dedupe(candidates)
    .filter((page) => !visited.has(page.url))
    .sort((a, b) => b.score - a.score);

  // One page per intent before a second of any intent: breadth across the
  // question set beats depth in one section.
  const byIntent = new Map(visitedIntents);
  const balanced: PlannedPage[] = [];
  for (const page of wanted) {
    const seen = byIntent.get(page.intent) ?? 0;
    if (seen >= INTENT_BUDGET) continue;
    byIntent.set(page.intent, seen + 1);
    balanced.push(page);
    if (balanced.length >= maxPages) break;
  }
  return balanced;
}

function dedupe(pages: PlannedPage[]): PlannedPage[] {
  const best = new Map<string, PlannedPage>();
  for (const page of pages) {
    const existing = best.get(page.url);
    if (!existing || page.score > existing.score) best.set(page.url, page);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
