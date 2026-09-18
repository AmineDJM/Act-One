import { after } from 'next/server';
import { requireSession } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { MAX_UPLOAD_BYTES, cardOf, classifyLibraryAsset, uploadLibraryAsset } from '@/server/library.ts';

/**
 * One file into the library.
 *
 * The uploader sends files one request each, several at a time, so a
 * hundred pictures dropped on the page arrive as a hundred small requests
 * rather than one that a proxy somewhere cuts off. The file is read as
 * bytes and identified by them; the name it came with is only a name.
 *
 * Classification runs after the response: the card appears at once, with
 * the name and a first guess, and fills in what the picture shows when the
 * classifier has looked at it.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession();

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      return Response.json({ error: `Files are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB for now.` }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'No file was sent.' }, { status: 400 });

    const projectIds = form.getAll('project').map(String).filter(Boolean);
    const parent = form.get('parent');

    const asset = await uploadLibraryAsset(session, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      projectIds,
      parentAssetId: typeof parent === 'string' && parent ? parent : null,
    });

    schedule(() => classifyLibraryAsset(session.organizationId, asset.id));

    return Response.json({ asset: cardOf(asset, []) }, { status: 201 });
  } catch (error) {
    const app = reportError('libraryUpload', error);
    return Response.json({ error: app.publicMessage }, { status: app.status });
  }
}

/** After the response when there is a request to be after; right away when there is not (tests). */
function schedule(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}
