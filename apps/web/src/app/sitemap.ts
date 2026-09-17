import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site.ts';

/** Only pages that can actually rank. Authenticated routes are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/pricing'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/work'), lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: absoluteUrl('/how-it-works'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
