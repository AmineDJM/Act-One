import type { MetadataRoute } from 'next';
import { site, absoluteUrl } from '@/lib/site.ts';

/**
 * Signed-in surfaces are excluded explicitly.
 *
 * They are already behind auth, so crawlers cannot read them — but a crawler
 * that repeatedly hits /app and gets redirected wastes crawl budget that
 * should be spent on pages that can actually rank.
 */
export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.NODE_ENV === 'production' && !site.url.includes('localhost');

  if (!isProduction) {
    // A staging deployment that gets indexed outranks production for its own
    // brand terms. Blanket-disallow anything that is not the real site.
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/admin/', '/api/', '/auth/', '/*?*'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: site.url,
  };
}
