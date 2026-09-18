import { momentStrength, type CaptureKind, type Evidence, type ProductMoment } from '@act-one/core';

/**
 * Giving unfilmed moments something real to show.
 *
 * Without product access, research used to leave every moment with no
 * screenshots, the storyboard engine routed every product beat to typography,
 * and the film never showed the product. The public site is real material the
 * company chose to publish: its pages, and the product imagery on them. Each
 * suggested moment was inferred from evidence, and evidence came from a page —
 * so the page that says it is the page that shows it.
 *
 * Pure: takes assessed candidates and returns the assignment. Storage and
 * model calls happen around it, which is what makes the matching testable.
 */
export type CaptureCandidate = {
  /** Unique within a crawl. */
  key: string;
  kind: Exclude<CaptureKind, 'in_app'>;
  pageUrl: string;
  /** What the capture shows, in words a director can write against. */
  label: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Lower is better within a page: the hero shot before the footer's. */
  rank: number;
};

export type CaptureAttachment = {
  momentId: string;
  candidate: CaptureCandidate;
};

export type AttachOptions = {
  homepageUrl: string;
  /** How many moments one capture may serve. One keeps scenes distinct. */
  maxUsesPerCapture?: number;
};

export function attachPublicCaptures(
  moments: ProductMoment[],
  evidence: Evidence[],
  candidates: CaptureCandidate[],
  options: AttachOptions,
): { moments: ProductMoment[]; attachments: CaptureAttachment[] } {
  const maxUses = options.maxUsesPerCapture ?? 1;
  const uses = new Map<string, number>();
  const byPage = new Map<string, CaptureCandidate[]>();
  for (const candidate of [...candidates].sort((a, b) => order(a) - order(b) || a.rank - b.rank)) {
    const list = byPage.get(normalise(candidate.pageUrl)) ?? [];
    list.push(candidate);
    byPage.set(normalise(candidate.pageUrl), list);
  }
  const evidenceUrl = new Map(evidence.map((item) => [item.id, normalise(item.sourceUrl)]));
  const homepage = normalise(options.homepageUrl);

  const attachments: CaptureAttachment[] = [];
  const updated = new Map<string, ProductMoment>();

  // Strongest moments choose first: they are the ones the film will lead with,
  // and the hero imagery should go to them.
  const unfilmed = moments
    .filter((moment) => moment.screenshots.length === 0)
    .sort((a, b) => momentStrength(b) - momentStrength(a));

  for (const moment of unfilmed) {
    const pages = citedPages(moment, evidenceUrl);
    const search = pages.length > 0 ? pages : [homepage];

    let chosen: CaptureCandidate | null = null;
    for (const page of search) {
      chosen = (byPage.get(page) ?? []).find((c) => (uses.get(c.key) ?? 0) < maxUses) ?? null;
      if (chosen) break;
    }
    // A moment whose own pages are spent may still be shown on the homepage:
    // it is the front door, and it is about the whole product.
    if (!chosen && !search.includes(homepage)) {
      chosen = (byPage.get(homepage) ?? []).find((c) => (uses.get(c.key) ?? 0) < maxUses) ?? null;
    }
    if (!chosen) continue;

    uses.set(chosen.key, (uses.get(chosen.key) ?? 0) + 1);
    attachments.push({ momentId: moment.id, candidate: chosen });
    updated.set(moment.id, {
      ...moment,
      sourceUrl: chosen.pageUrl,
      captureKind: chosen.kind,
      captureLabel: chosen.label,
      captureAspect: chosen.height > 0 ? round3(chosen.width / chosen.height) : null,
      // Published imagery of the product outranks a page about it, and both
      // stay below anything actually observed in the product in use.
      wowScore: Math.max(moment.wowScore, chosen.kind === 'product_image' ? 0.55 : 0.45),
    });
  }

  return {
    moments: moments.map((moment) => updated.get(moment.id) ?? moment),
    attachments,
  };
}

/** Pages the moment's evidence came from, most-cited first. */
function citedPages(moment: ProductMoment, evidenceUrl: Map<string, string>): string[] {
  const counts = new Map<string, number>();
  for (const id of moment.evidenceIds) {
    const url = evidenceUrl.get(id);
    if (!url) continue;
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

function order(candidate: CaptureCandidate): number {
  return candidate.kind === 'product_image' ? 0 : 1;
}

function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A label for a page capture, from what the crawl knows about the page. */
export function pageLabel(url: string, title: string): string {
  let path = '';
  let host = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '');
    path = parsed.pathname.replace(/\/$/, '');
  } catch {
    return title || 'A page of the public site';
  }
  const named: [RegExp, string][] = [
    [/^$/, 'the homepage'],
    [/pricing|plans?$/i, 'the pricing page'],
    [/product|platform|features?|how-it-works/i, 'a product page'],
    [/use-cases?|solutions?|for-/i, 'a use-case page'],
    [/customers?|case-stud|stories/i, 'the customers page'],
    [/docs?|documentation|guides?/i, 'the documentation'],
    [/changelog|releases?|updates/i, 'the changelog'],
    [/about|company|team/i, 'the about page'],
  ];
  const what = named.find(([pattern]) => pattern.test(path))?.[1] ?? 'a page of the site';
  const where = path ? `${host}${path}` : host;
  return title ? `${what} (${where}) — “${title.slice(0, 80)}”` : `${what} (${where})`;
}
