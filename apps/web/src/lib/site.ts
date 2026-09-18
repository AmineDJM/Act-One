import { PRODUCT_NAME, PRODUCT_SUBLINE, PRODUCT_TAGLINE } from '@act-one/core';

/**
 * Site-level configuration.
 *
 * Every public string and URL comes from here so the working product name can
 * change without a find-and-replace across the app — branding is explicitly
 * not final.
 */
export const site = {
  name: PRODUCT_NAME,
  tagline: PRODUCT_TAGLINE,
  subline: PRODUCT_SUBLINE,
  /**
   * Canonical origin. Set ACT_ONE_SITE_URL in production: without it, canonical
   * tags, sitemap entries and OG image URLs all point at localhost, which is
   * the single most common way a launch gets deindexed.
   */
  url: (
    process.env.ACT_ONE_SITE_URL ??
    // What the host says it is serving us at. Set ACT_ONE_SITE_URL only for
    // a custom domain; otherwise the deploy is correct without anybody
    // typing the address in.
    process.env.RENDER_EXTERNAL_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, ''),
  locale: 'en_US',
  twitter: process.env.ACT_ONE_TWITTER ?? '',
  /**
   * Optional. Empty means no contact link and no email in the structured
   * data — an invented address is worse than none, and this used to default
   * to one.
   */
  supportEmail: process.env.ACT_ONE_SUPPORT_EMAIL ?? '',
  /** Company behind the product, for structured data. */
  legalName: process.env.ACT_ONE_LEGAL_NAME ?? PRODUCT_NAME,
} as const;

export function absoluteUrl(path = '/'): string {
  return `${site.url}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Keyword clusters the public pages are written against.
 *
 * Not stuffed into a meta tag — meta keywords have been ignored by search
 * engines for over a decade. This exists to keep page copy, headings and
 * internal links pointed at the same intents, which is what actually ranks.
 */
export const SEARCH_INTENTS = {
  primary: 'product launch video for SaaS',
  secondary: [
    'SaaS launch film',
    'product launch video agency',
    'automated product video',
    'Product Hunt launch video',
    'B2B software demo video',
    'homepage hero video',
  ],
} as const;
