import { requireSuperAdmin } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { getStorage } from '@/server/assets.ts';
import { reportError } from '@/server/report.ts';
import { parseByteRange } from '@/server/range.ts';

/**
 * An asset of any workspace, for staff.
 *
 * The customer route reads under the caller's own workspace, which is right
 * for customers and useless for the console: an editor choosing a poster
 * frame for a film from another company must be able to see the frames.
 * Staff only, checked against the database flag, and never cached beyond
 * the browser that asked.
 */
export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string; id: string }> }): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { organizationId, id } = await params;
    const asset = await getStore().assets.get(organizationId, id);
    if (!asset) return new Response('Not found', { status: 404 });

    const storage = await getStorage();
    const thumbnailKey = typeof asset.metadata['thumbnailKey'] === 'string' ? asset.metadata['thumbnailKey'] : null;
    const thumbnail = new URL(request.url).searchParams.get('thumb') !== null && thumbnailKey !== null;
    const bytes = await storage.get(thumbnail ? thumbnailKey : asset.storageKey);
    const contentType = thumbnail ? 'image/webp' : asset.contentType || 'application/octet-stream';
    const common: Record<string, string> = {
      'content-type': contentType,
      'cache-control': 'private, max-age=600',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      ...(contentType.includes('svg') ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'content-disposition': 'inline' } : {}),
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
    const app = reportError('adminAsset', error);
    return new Response(app.publicMessage, { status: app.status });
  }
}
