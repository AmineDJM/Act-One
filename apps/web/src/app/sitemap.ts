import type { MetadataRoute } from 'next';
import { CollectionCategory } from '@act-one/core';
import { absoluteUrl } from '@/lib/site.ts';
import { listPublicFilms } from '@/server/collections.ts';

/**
 * Only pages that can actually rank. Authenticated routes are never listed.
 *
 * Collections entries are read at request time, so a film published a
 * minute ago is in the map; a withdrawn one is out of it as fast.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const films = await listPublicFilms().catch(() => []);
  const categories = new Set(films.map((film) => film.category));
  return [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/pricing'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/collections'), lastModified: films[0] ? new Date(films.map((film) => film.updatedAt).sort().at(-1)!) : now, changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl('/work'), lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: absoluteUrl('/how-it-works'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    ...CollectionCategory.options
      .filter((category) => categories.has(category))
      .map((category) => ({ url: absoluteUrl(`/collections/category/${category}`), lastModified: now, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...films.map((film) => ({ url: absoluteUrl(film.path), lastModified: new Date(film.updatedAt), changeFrequency: 'monthly' as const, priority: 0.7 })),
  ];
}
