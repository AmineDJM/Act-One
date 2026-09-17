export type ByteRange = { start: number; end: number };

/**
 * Parses a single HTTP byte range.
 *
 * Without range support a browser must download an entire film before the
 * scrub bar does anything, and Safari refuses to play the video at all.
 *
 * Multipart ranges are legal and nothing we serve needs them, so a header with
 * a comma returns null and the caller sends the whole asset — a correct
 * response, just not the optimal one.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header || size === 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const rawStart = match[1]!;
  const rawEnd = match[2]!;
  if (rawStart === '' && rawEnd === '') return null;

  // `bytes=-500` means the last 500 bytes, not "everything up to byte 500".
  const suffix = rawStart === '';
  const start = suffix ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = suffix ? size - 1 : rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unsatisfiable';
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}
