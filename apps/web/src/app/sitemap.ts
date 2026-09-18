import type { MetadataRoute } from 'next';
import { CollectionCategory } from '@act-one/core';
import { absoluteUrl } from '@/lib/site.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { listPublicArticles } from '@/server/blog.ts';

/*
 * Rendered per request, because a build has no database.
 *
 * This page reads published rows, and the machine that runs `next build` is
 * not the machine that runs the migrations: on a fresh environment the table
 * does not exist yet and prerendering fails the whole build. Even where it
 * succeeds it bakes in whatever was published at build time, so a film
 * selected an hour after a deploy would not appear until something else
 * triggered a rebuild.
 */
export const dynamic = 'force-dynamic';


/**
 * Only pages that can actually rank. Authenticated routes are never listed.
 *
 * A film published a minute ago is in the map; a withdrawn one is out of it
 * as fast, because both go through an action that rewrites this.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [films, articles] = await Promise.all([listPublicFilms().catch(() => []), listPublicArticles(500).catch(() => [])]);
  const categories = new Set(films.map((film) => film.category));
  return [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/pricing'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/collections'), lastModified: films[0] ? new Date(films.map((film) => film.updatedAt).sort().at(-1)!) : now, changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl('/work'), lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: absoluteUrl('/blog'), lastModified: articles[0] ? new Date(articles[0].publishedAt) : now, changeFrequency: 'weekly', priority: 0.8 },
    { url: absoluteUrl('/how-it-works'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    ...CollectionCategory.options
      .filter((category) => categories.has(category))
      .map((category) => ({ url: absoluteUrl(`/collections/category/${category}`), lastModified: now, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...films.map((film) => ({ url: absoluteUrl(film.path), lastModified: new Date(film.updatedAt), changeFrequency: 'monthly' as const, priority: 0.7 })),
    ...articles.map((article) => ({ url: absoluteUrl(article.path), lastModified: new Date(article.updatedAt), changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
