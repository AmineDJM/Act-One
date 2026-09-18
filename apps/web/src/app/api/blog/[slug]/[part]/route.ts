import { publicArticleHero } from '@/server/blog.ts';
import { getStore } from '@/server/store.ts';
import { getStorage } from '@/server/assets.ts';
import { reportError } from '@/server/report.ts';

/**
 * A published article's picture, for anyone.
 *
 * Addressed by the article's own slug rather than an asset id, and served
 * only while the article is published — the same rule as a film in
 * Collections, for the same reason.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; part: string }> }): Promise<Response> {
  try {
    const { slug, part } = await params;
    if (part !== 'hero') return new Response('Not found', { status: 404 });
    const hero = await publicArticleHero(slug);
    if (!hero) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });

    const asset = await getStore().assets.get(hero.organizationId, hero.assetId);
    if (!asset || !asset.contentType.startsWith('image/') || asset.contentType.includes('svg')) {
      return new Response('Not found', { status: 404 });
    }
    const bytes = await (await getStorage()).get(asset.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': asset.contentType,
        'content-length': String(bytes.byteLength),
        'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const app = reportError('blogHero', error);
    return new Response(app.publicMessage, { status: app.status });
  }
}
