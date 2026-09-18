import { requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { getStorage } from '@/server/assets.ts';
import { reportError } from '@/server/report.ts';
import { parseByteRange } from '@/server/range.ts';

/**
 * Serves one asset to the organisation that owns it.
 *
 * Everything the product makes lands in storage under a key the customer never
 * sees, so this is the only way a finished film reaches the person who paid for
 * it. The lookup is scoped to the caller's organisation, which means another
 * tenant's id reads as a plain 404 rather than a 403 — a "forbidden" would
 * confirm the id exists and turn this into an enumeration oracle.
 *
 * Masters are private. They are streamed through here rather than handed out as
 * a storage URL, because a URL that works without a session keeps working after
 * the person who was sent it leaves the company.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireSession();
    const { id } = await params;

    const asset = await getStore().assets.get(session.organizationId, id);
    if (!asset) return new Response('Not found', { status: 404 });

    const storage = await getStorage();
    const query = new URL(request.url).searchParams;
    const download = query.get('download') !== null;

    // The library's cards ask for the small version the upload made; an asset
    // without one (an SVG, an older capture) is served as it is.
    const thumbnailKey = typeof asset.metadata['thumbnailKey'] === 'string' ? asset.metadata['thumbnailKey'] : null;
    const thumbnail = query.get('thumb') !== null && thumbnailKey !== null;
    const bytes = await storage.get(thumbnail ? thumbnailKey : asset.storageKey);
    const contentType = thumbnail ? 'image/webp' : asset.contentType || 'application/octet-stream';

    const common: Record<string, string> = {
      'content-type': contentType,
      // Private, so a shared machine's browser cache does not hand the film to
      // the next person, and no CDN in between keeps a copy. A library
      // picture may be cached by the browser that fetched it for a while: the
      // grid asks for dozens at once, and the bytes never change under an id.
      'cache-control': asset.library ? 'private, max-age=3600' : 'private, max-age=0, must-revalidate',
      'accept-ranges': 'bytes',
      ...(download
        ? { 'content-disposition': `attachment; filename="${filenameFor(asset.kind, contentType, asset.id)}"` }
        : {}),
      // An SVG is a document. Served from our origin it could run as us, so
      // it is served as a picture and nothing else: no script, no fetches.
      ...(contentType.includes('svg')
        ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'content-disposition': download ? `attachment; filename="${filenameFor(asset.kind, contentType, asset.id)}"` : 'inline' }
        : {}),
    };

    const range = parseByteRange(request.headers.get('range'), bytes.byteLength);
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${bytes.byteLength}` },
      });
    }
    if (range) {
      const slice = bytes.slice(range.start, range.end + 1);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          ...common,
          'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
          'content-length': String(slice.byteLength),
        },
      });
    }

    return new Response(new Uint8Array(bytes), {
      headers: { ...common, 'content-length': String(bytes.byteLength) },
    });
  } catch (error) {
    const app = reportError('assetDownload', error);
    return new Response(app.publicMessage, { status: app.status });
  }
}

function filenameFor(kind: string, contentType: string, id: string): string {
  const extension = contentType.includes('mp4')
    ? 'mp4'
    : contentType.includes('png')
      ? 'png'
      : contentType.includes('jpeg')
        ? 'jpg'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('svg')
            ? 'svg'
            : contentType.includes('wav')
              ? 'wav'
              : contentType.includes('mpeg')
                ? 'mp3'
                : contentType.includes('vtt')
                  ? 'vtt'
                  : 'bin';
  return `${kind}-${id}.${extension}`;
}
