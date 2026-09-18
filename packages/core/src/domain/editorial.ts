import { z } from 'zod';
import { nonEmpty, urlString } from '../zod-helpers.ts';

/**
 * The journal.
 *
 * Articles about launching software: how a launch film earns attention, what
 * separates a film from a demo, what founders get wrong on launch day. They
 * exist to be found and to be worth reading — which means a machine may draft
 * one, and a person decides whether it is published. Mass-produced filler is
 * the exact thing this refuses to be, so the schedule is conservative by
 * default and publishing is a human act unless somebody deliberately says
 * otherwise.
 */
export const ArticleStatus = z.enum(['draft', 'in_review', 'scheduled', 'published', 'unpublished']);
export type ArticleStatus = z.infer<typeof ArticleStatus>;

export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: 'Draft',
  in_review: 'Waiting for a person',
  scheduled: 'Scheduled',
  published: 'Published',
  unpublished: 'Unpublished',
};

/** How an article came to exist. Stated plainly, never hidden. */
export const ArticleOrigin = z.enum(['written', 'assisted', 'generated']);
export type ArticleOrigin = z.infer<typeof ArticleOrigin>;

/** A source the article leans on, kept with it and linked in the text. */
export const ArticleSource = z.object({
  title: nonEmpty(200),
  url: urlString,
  note: z.string().max(400).default(''),
});
export type ArticleSource = z.infer<typeof ArticleSource>;

/** One section, so a person can regenerate a single part rather than the article. */
export const ArticleSection = z.object({
  id: z.string(),
  heading: nonEmpty(160),
  /** Markdown. Rendered server-side; never raw HTML from a model. */
  body: z.string().max(12_000).default(''),
  /** What this section is for, from the outline: kept so a regeneration knows the brief. */
  intent: z.string().max(400).default(''),
});
export type ArticleSection = z.infer<typeof ArticleSection>;

export const Article = z.object({
  id: z.string(),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: nonEmpty(160),
  /** The line under the title on the page and in search results. */
  dek: z.string().max(300).default(''),
  /** What the reader wants when they search for this. */
  intent: z.string().max(300).default(''),
  sections: z.array(ArticleSection).max(24).default([]),
  /** The closing paragraph that leads to the product, written as part of the piece. */
  closing: z.string().max(2000).default(''),
  sources: z.array(ArticleSource).max(20).default([]),
  categories: z.array(nonEmpty(60)).max(6).default([]),
  tags: z.array(nonEmpty(40)).max(12).default([]),
  authorName: z.string().max(80).default('Act One'),
  /** A picture for the page and the card, from the library or a made one. */
  heroAssetId: z.string().nullable().default(null),
  heroAlt: z.string().max(200).default(''),
  status: ArticleStatus.default('draft'),
  origin: ArticleOrigin.default('written'),
  /** The words a person may change without touching the body. */
  seoTitle: z.string().max(120).default(''),
  seoDescription: z.string().max(240).default(''),
  canonicalUrl: z.string().max(400).default(''),
  /** When it should go live, for a scheduled piece. */
  scheduledFor: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  updatedByUserId: z.string().nullable().default(null),
  /** What the pipeline did, for the console. Never shown to a reader. */
  pipelineNotes: z.array(z.string().max(300)).max(40).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Article = z.infer<typeof Article>;

/** A topic waiting to be written, discovered or typed by a person. */
export const ArticleTopic = z.object({
  id: z.string(),
  title: nonEmpty(200),
  /** The search intent this answers, in the reader's words. */
  intent: z.string().max(300).default(''),
  /** Why it is worth writing: the opportunity, in one line. */
  rationale: z.string().max(400).default(''),
  keywords: z.array(nonEmpty(60)).max(10).default([]),
  /** 0–100; the console sorts by it. */
  score: z.number().int().min(0).max(100).default(50),
  status: z.enum(['open', 'writing', 'written', 'dropped']).default('open'),
  articleId: z.string().nullable().default(null),
  createdByUserId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ArticleTopic = z.infer<typeof ArticleTopic>;

/** How often the machine may draft something, if at all. */
export const EditorialCadence = z.enum(['manual', 'every_2_days', 'every_3_days', 'weekly']);
export type EditorialCadence = z.infer<typeof EditorialCadence>;

export const CADENCE_HOURS: Record<EditorialCadence, number | null> = {
  manual: null,
  every_2_days: 48,
  every_3_days: 72,
  weekly: 168,
};

export const EditorialSchedule = z.object({
  /** May the machine draft articles on its own? Off by default. */
  autoDraft: z.boolean().default(false),
  cadence: EditorialCadence.default('weekly'),
  /**
   * May a finished draft publish itself? Off by default, and deliberately
   * separate from autoDraft: drafting is cheap, publishing is the promise.
   */
  autoPublish: z.boolean().default(false),
  /** The editorial line every article is written against. */
  brief: z.string().max(1200).default(
    'Write for founders and product people launching software. Concrete, specific, no filler, ' +
      'no listicles, no invented statistics. Every claim either obvious, argued, or cited.',
  ),
  /** Where topics come from when nobody has typed one. */
  topics: z.array(nonEmpty(200)).max(50).default([]),
  /** The last time the machine drafted something, so the cadence can be honoured. */
  lastRunAt: z.string().nullable().default(null),
});
export type EditorialSchedule = z.infer<typeof EditorialSchedule>;
export const DEFAULT_EDITORIAL_SCHEDULE: EditorialSchedule = EditorialSchedule.parse({});

/** Is a run due? Pure, so the worker and the console agree. */
export function editorialRunDue(schedule: EditorialSchedule, now: Date): boolean {
  if (!schedule.autoDraft) return false;
  const hours = CADENCE_HOURS[schedule.cadence];
  if (hours === null) return false;
  if (!schedule.lastRunAt) return true;
  return now.getTime() - Date.parse(schedule.lastRunAt) >= hours * 3_600_000;
}

/** A slug from a title, made unique against what is taken. */
export function articleSlug(title: string, taken: (candidate: string) => boolean): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'article';
  if (!taken(base)) return base;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** The whole article as one body of text: for word counts, reading time and checks. */
export function articleText(article: Pick<Article, 'dek' | 'sections' | 'closing'>): string {
  return [article.dek, ...article.sections.map((section) => `${section.heading}\n${section.body}`), article.closing].join('\n\n').trim();
}

export function articleWordCount(article: Pick<Article, 'dek' | 'sections' | 'closing'>): number {
  const text = articleText(article);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Reading time in whole minutes, at the usual 220 words a minute, never zero. */
export function articleReadingMinutes(article: Pick<Article, 'dek' | 'sections' | 'closing'>): number {
  return Math.max(1, Math.round(articleWordCount(article) / 220));
}

export type EditorialFinding = { severity: 'blocking' | 'warning'; message: string };

/**
 * What stands between this draft and publication.
 *
 * Deliberately mechanical: length, the fields search engines read, a link to
 * the product, and the two failure modes a machine-written article actually
 * has — inventing numbers, and saying nothing. A person still reads it.
 */
export function editorialFindings(article: Article, options: { existingSlug?: boolean } = {}): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  const words = articleWordCount(article);
  const text = articleText(article);

  if (!article.title.trim()) findings.push({ severity: 'blocking', message: 'The article has no title.' });
  if (article.title.length > 70) findings.push({ severity: 'warning', message: 'The title is long enough that search results will cut it.' });
  if (!article.dek.trim()) findings.push({ severity: 'blocking', message: 'There is no line under the title; search results will take whatever they find.' });
  if (article.sections.length < 3) findings.push({ severity: 'blocking', message: 'Fewer than three sections: this is a note, not an article.' });
  if (words < 500) findings.push({ severity: 'blocking', message: `Only ${words} words. Say something or do not publish it.` });
  if (words > 3500) findings.push({ severity: 'warning', message: `${words} words. Long enough that somebody should cut it.` });
  if (options.existingSlug) findings.push({ severity: 'blocking', message: 'That address is already taken by another article.' });

  const description = article.seoDescription || article.dek;
  if (description.length > 165) findings.push({ severity: 'warning', message: 'The description is longer than search results show.' });
  if (description.length > 0 && description.length < 70) findings.push({ severity: 'warning', message: 'The description is short enough to look unfinished in search results.' });
  if (!article.heroAssetId) findings.push({ severity: 'warning', message: 'No picture: the card and the social preview will be plain.' });
  if (article.heroAssetId && !article.heroAlt.trim()) findings.push({ severity: 'blocking', message: 'The picture has no description for people who cannot see it.' });

  // Numbers without a source are how a generated article lies confidently.
  const statistics = text.match(/\b\d{1,3}(?:\.\d+)?\s?%|\b\d+x\b/gi) ?? [];
  if (statistics.length > 0 && article.sources.length === 0) {
    findings.push({ severity: 'blocking', message: `The article states figures (${statistics.slice(0, 3).join(', ')}) and cites nothing.` });
  }
  if (!/act one/i.test(text)) findings.push({ severity: 'warning', message: 'The article never mentions the product it is published by.' });
  const headings = new Set(article.sections.map((section) => section.heading.trim().toLowerCase()));
  if (headings.size !== article.sections.length) findings.push({ severity: 'warning', message: 'Two sections share a heading.' });

  return findings;
}

export function articleReadyToPublish(article: Article, options: { existingSlug?: boolean } = {}): boolean {
  return editorialFindings(article, options).every((finding) => finding.severity !== 'blocking');
}
