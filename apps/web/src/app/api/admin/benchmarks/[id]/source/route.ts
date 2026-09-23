import { redirect } from 'next/navigation';
import { requireSuperAdmin } from '@/server/auth.ts';
import { getBenchmark } from '@/server/benchmarks.ts';
import { getStorage } from '@/server/assets.ts';
import { parseByteRange } from '@/server/range.ts';
import { reportError } from '@/server/report.ts';

/**
 * The film itself, for the inspector's player: watching the film beside its
 * reading is how a person checks one against the other.
 *
 * From shared object storage the browser is sent to a short-lived signed URL
 * and streams from there, so a gigabyte never passes through this service.
 * Local storage — development only — is served from here, with ranges.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  let signed: string | null = null;
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const benchmark = await getBenchmark(id);
    if (!benchmark) return new Response('Not found', { status: 404 });
    const storage = await getStorage();
    if (storage.shared) {
      signed = await storage.signedUrl(benchmark.source.storageKey, 3600);
    } else {
      const bytes = await storage.get(benchmark.source.storageKey);
      const common = { 'content-type': benchmark.source.contentType, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' };
      const range = parseByteRange(request.headers.get('range'), bytes.byteLength);
      if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.byteLength}` } });
      if (range) {
        const slice = bytes.slice(range.start, range.end + 1);
        return new Response(new Uint8Array(slice), { status: 206, headers: { ...common, 'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`, 'content-length': String(slice.byteLength) } });
      }
      return new Response(new Uint8Array(bytes), { headers: { ...common, 'content-length': String(bytes.byteLength) } });
    }
  } catch (error) {
    const app = reportError('benchmarkSource', error);
    return new Response(app.publicMessage, { status: app.status });
  }
  redirect(signed);
}
