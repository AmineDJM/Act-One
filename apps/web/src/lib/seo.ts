import type { Metadata } from 'next';
import { site, absoluteUrl } from './site.ts';

/**
 * One way to describe a public page.
 *
 * Every page needs the same six things — a title, a description worth
 * clicking, a canonical, a social card with a picture, and the right
 * indexing rule — and getting one of them wrong on one page is how a site
 * quietly loses a page from search. Building them in one place means a new
 * page cannot forget.
 *
 * The social picture defaults to the generated card at /opengraph-image.
 * Next only attaches that automatically to routes that do not declare their
 * own `openGraph`, which is exactly the routes that declare one — so it is
 * set explicitly here.
 */
export type PageSeo = {
  title: string;
  description: string;
  /** Path within the site, e.g. "/collections". */
  path: string;
  /** A picture for the card; the generated one when absent. */
  image?: { url: string; alt?: string; width?: number; height?: number } | null;
  type?: 'website' | 'article';
  /** Keep it out of search: sign-up, invitations, anything behind a door. */
  noIndex?: boolean;
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
};

/**
 * The canonical address and the language map.
 *
 * Two pages disagreeing about which address is the real one is how a site
 * splits its own ranking in half, so both come from here. `canonical` names
 * somewhere else only for a piece first published elsewhere.
 *
 * The language map is ready for other languages without claiming any: when a
 * translation exists it is one more entry, not a new metadata story.
 */
export function addresses(path: string, canonical?: string): NonNullable<Metadata['alternates']> {
  return { canonical: canonical || path, languages: { 'x-default': absoluteUrl(path), en: absoluteUrl(path) } };
}

export type SocialImage = { url: string; alt?: string; width?: number; height?: number };

/** The picture a social card shows: the page's own, or the generated card. */
export function socialImage(image?: SocialImage | null): SocialImage {
  return image ?? { url: absoluteUrl('/opengraph-image'), alt: `${site.name} — ${site.tagline}`, width: 1200, height: 630 };
}

export function pageMetadata(seo: PageSeo): Metadata {
  const image = socialImage(seo.image);
  return {
    title: seo.title,
    description: seo.description,
    alternates: addresses(seo.path),
    ...(seo.noIndex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: seo.type ?? 'website',
      title: seo.title.includes(site.name) ? seo.title : `${seo.title} · ${site.name}`,
      description: seo.description,
      url: absoluteUrl(seo.path),
      siteName: site.name,
      locale: site.locale,
      images: [image],
      ...(seo.publishedTime ? { publishedTime: seo.publishedTime } : {}),
      ...(seo.modifiedTime ? { modifiedTime: seo.modifiedTime } : {}),
      ...(seo.authors ? { authors: seo.authors } : {}),
      ...(seo.tags ? { tags: seo.tags } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title.includes(site.name) ? seo.title : `${seo.title} · ${site.name}`,
      description: seo.description,
      images: [image.url],
      ...(site.twitter ? { creator: site.twitter } : {}),
    },
  };
}

export type Crumb = { name: string; path: string };

/** The trail a reader sees, said again for machines. */
export function breadcrumbs(crumbs: readonly Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: site.name, path: '/' }, ...crumbs].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** A list of pages, in the order the page shows them. */
export function itemList(name: string, items: readonly { name: string; path: string }[]) {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

/** Questions that are actually on the page, answered where a reader can read them. */
export function faqPage(questions: readonly { question: string; answer: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: questions.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

/** One JSON-LD graph, ready for a script tag. */
export function jsonLd(...nodes: object[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
}
