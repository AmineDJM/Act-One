import type { MetadataRoute } from 'next';
import { site, absoluteUrl } from '@/lib/site.ts';
import { getProductConfig } from '@/server/product.ts';

/**
 * Signed-in surfaces are excluded explicitly.
 *
 * They are already behind auth, so crawlers cannot read them — but a crawler
 * that repeatedly hits /app and gets redirected wastes crawl budget that
 * should be spent on pages that can actually rank.
 */
/*
 * Read on every request, never baked into the build.
 *
 * This file answers one question — may this deployment be crawled — and the
 * answer lives in the console and in the environment. A copy rendered at
 * build time would keep saying whatever was true when the image was built,
 * which is exactly the failure that gets a staging site indexed.
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await getProductConfig().catch(() => null);
  const isProduction = process.env.NODE_ENV === 'production' && !site.url.includes('localhost');

  // A real address is not the same as being ready to be found. The console can
  // hold the site back from search until somebody decides otherwise.
  if (!isProduction || config?.seo.discourageIndexing) {
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
