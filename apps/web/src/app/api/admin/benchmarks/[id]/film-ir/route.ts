import { requireSuperAdmin } from '@/server/auth.ts';
import { getBenchmark } from '@/server/benchmarks.ts';
import { getStorage } from '@/server/assets.ts';
import { reportError } from '@/server/report.ts';

/**
 * A benchmark's FilmIR, or its validation report with `?part=validation`, as
 * a download. Staff only, never cached beyond the browser that asked.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const benchmark = await getBenchmark(id);
    const validation = new URL(request.url).searchParams.get('part') === 'validation';
    const key = validation ? benchmark?.analysis.validationKey : benchmark?.analysis.filmIrKey;
    if (!benchmark || !key) return new Response('Not found', { status: 404 });
    const storage = await getStorage();
    if (!(await storage.exists(key))) return new Response('Not found', { status: 404 });
    const bytes = await storage.get(key);
    const name = `${benchmark.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || benchmark.id}.${validation ? 'validation' : 'film-ir'}.json`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${benchmark.id}.json"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const app = reportError('benchmarkFilmIr', error);
    return new Response(app.publicMessage, { status: app.status });
  }
}
