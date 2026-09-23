import { requireSuperAdmin } from '@/server/auth.ts';
import { receiveBenchmarkUpload } from '@/server/benchmarks.ts';
import { reportError } from '@/server/report.ts';
import { assertSameOrigin } from '@/server/same-origin.ts';

/**
 * One film into the Benchmark Library.
 *
 * The body is the file itself, streamed to disk as it arrives rather than
 * parsed as a form, because a reference film can be a gigabyte and a form is
 * held in memory whole. Its name and the operator's notes travel in headers,
 * URI-encoded. The film is identified by its own first bytes and its SHA-256:
 * a second upload of the same bytes returns the first rather than storing it
 * twice.
 */
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireSuperAdmin();
    assertSameOrigin(request);
    const header = (name: string) => {
      const value = request.headers.get(name);
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    };
    const declared = Number(request.headers.get('content-length') ?? NaN);
    const { benchmark, duplicate } = await receiveBenchmarkUpload({
      body: request.body,
      declaredBytes: Number.isFinite(declared) ? declared : null,
      fileName: header('x-file-name') ?? '',
      title: header('x-benchmark-title'),
      origin: header('x-benchmark-origin'),
      rights: header('x-benchmark-rights'),
      analyze: request.headers.get('x-benchmark-analyze') === '1',
      userId: user.id,
    });
    return Response.json({ id: benchmark.id, title: benchmark.title, status: benchmark.status, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    const app = reportError('benchmarkUpload', error);
    return Response.json({ error: app.publicMessage }, { status: app.status });
  }
}
