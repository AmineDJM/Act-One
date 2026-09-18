import { publicFilmAsset } from '@/server/collections.ts';
import { getStorage } from '@/server/assets.ts';
import { reportError } from '@/server/report.ts';
import { parseByteRange } from '@/server/range.ts';

/**
 * A published film's bytes, for anyone.
 *
 * The public gallery is the one place a customer's master leaves the
 * authenticated route, and it does so only while the entry is published:
 * the address is the film's public slug, never an asset id, and an
 * unpublished or withdrawn film answers 404 the moment its status changes.
 * Cacheable, because a launch page is shared widely and the bytes under a
 * slug do not change without a republish.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; part: string }> }): Promise<Response> {
  try {
    const { slug, part } = await params;
    const asset = await publicFilmAsset(slug, part);
    if (!asset) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });

    const storage = await getStorage();
    const thumbnailKey = typeof asset.metadata['thumbnailKey'] === 'string' ? asset.metadata['thumbnailKey'] : null;
    const thumbnail = new URL(request.url).searchParams.get('thumb') !== null && thumbnailKey !== null;
    const bytes = await storage.get(thumbnail ? thumbnailKey : asset.storageKey);
    const contentType = thumbnail ? 'image/webp' : asset.contentType;

    const common: Record<string, string> = {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'accept-ranges': 'bytes',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    };

    const range = parseByteRange(request.headers.get('range'), bytes.byteLength);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.byteLength}` } });
    }
    if (range) {
      const slice = bytes.slice(range.start, range.end + 1);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: { ...common, 'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`, 'content-length': String(slice.byteLength) },
      });
    }
    return new Response(new Uint8Array(bytes), { headers: { ...common, 'content-length': String(bytes.byteLength) } });
  } catch (error) {
    const app = reportError('collectionsAsset', error);
    return new Response(app.publicMessage, { status: app.status });
  }
}
