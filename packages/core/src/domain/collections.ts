import { z } from 'zod';
import { nonEmpty, urlString } from '../zod-helpers.ts';

/**
 * Act One Collections.
 *
 * The curated public gallery of the best launch films made here. A film
 * enters it in exactly two ways: a customer submits it for selection, with
 * their explicit consent to public display, or staff publish it with the
 * customer's written consent on file. Nothing becomes public on its own;
 * a person selects, features, orders and unpublishes.
 */
export const CollectionStatus = z.enum(['pending', 'published', 'rejected', 'unpublished', 'withdrawn']);
export type CollectionStatus = z.infer<typeof CollectionStatus>;

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  pending: 'Under consideration',
  published: 'Selected for Collections',
  rejected: 'Not selected',
  unpublished: 'Unpublished',
  withdrawn: 'Withdrawn',
};

export const CollectionCategory = z.enum(['saas', 'ai', 'developer_tools', 'fintech', 'productivity', 'consumer', 'hardware', 'other']);
export type CollectionCategory = z.infer<typeof CollectionCategory>;

export const COLLECTION_CATEGORY_LABELS: Record<CollectionCategory, string> = {
  saas: 'SaaS',
  ai: 'AI',
  developer_tools: 'Developer tools',
  fintech: 'Fintech',
  productivity: 'Productivity',
  consumer: 'Consumer',
  hardware: 'Hardware',
  other: 'Other',
};

/** Who agreed to public display, when, and in which words. */
export const CollectionConsent = z.object({
  grantedByUserId: z.string(),
  grantedAt: z.string(),
  statement: nonEmpty(600),
  /** Staff attesting to written consent held elsewhere, rather than the customer ticking the box here. */
  byStaff: z.boolean().default(false),
});
export type CollectionConsent = z.infer<typeof CollectionConsent>;

export const CollectionEntry = z.object({
  id: z.string(),
  /** The public address: /collections/{slug}. */
  slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** Addresses this film used to have, so an old link redirects rather than breaking. */
  previousSlugs: z.array(z.string().min(2).max(80)).max(20).default([]),
  organizationId: z.string(),
  projectId: z.string(),
  renderId: z.string(),
  masterAssetId: z.string(),
  posterAssetId: z.string().nullable().default(null),
  /** Frames chosen for the page, in order. */
  stillAssetIds: z.array(z.string()).max(8).default([]),
  company: nonEmpty(120),
  productUrl: urlString,
  title: nonEmpty(140),
  tagline: z.string().max(200).default(''),
  /** The creative concept in a sentence or two, when the maker wants to say it. */
  concept: z.string().max(600).default(''),
  category: CollectionCategory.default('other'),
  /** The launch date as a calendar day, when known. */
  launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  durationSeconds: z.number().min(0).default(0),
  status: CollectionStatus.default('pending'),
  featured: z.boolean().default(false),
  launchOfTheWeek: z.boolean().default(false),
  /** Commissioned or editorially made by Act One itself. */
  original: z.boolean().default(false),
  /** Editorial order among published entries; lower first. */
  position: z.number().int().default(0),
  consent: CollectionConsent,
  submittedByUserId: z.string().nullable().default(null),
  submittedAt: z.string(),
  decidedByUserId: z.string().nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  editorialNote: z.string().max(1000).default(''),
  seoTitle: z.string().max(120).default(''),
  seoDescription: z.string().max(240).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CollectionEntry = z.infer<typeof CollectionEntry>;

/** The line under a public film. Never "generated": Act One is the studio behind it. */
export function creditLine(entry: Pick<CollectionEntry, 'original'>): string {
  return entry.original ? 'Act One Original' : 'An Act One Production';
}

/** A slug from the company's name, made unique against the ones already taken. */
export function collectionSlug(company: string, taken: (candidate: string) => boolean): string {
  const base =
    company
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'film';
  if (!taken(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** The public order: the launch of the week, then what is featured, then the editorial order, newest published last among equals. */
export function orderForPublic<T extends Pick<CollectionEntry, 'launchOfTheWeek' | 'featured' | 'position' | 'publishedAt'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.launchOfTheWeek !== b.launchOfTheWeek) return a.launchOfTheWeek ? -1 : 1;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });
}

/** What the customer may do with their entry from where it stands. */
export function submissionNext(status: CollectionStatus | null): 'submit' | 'wait' | 'withdraw' | 'resubmit' {
  if (status === null || status === 'withdrawn' || status === 'rejected' || status === 'unpublished') return status === null ? 'submit' : 'resubmit';
  if (status === 'pending') return 'wait';
  return 'withdraw';
}
