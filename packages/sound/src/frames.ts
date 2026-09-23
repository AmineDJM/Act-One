import { readFile } from 'node:fs/promises';
import { runFfmpeg } from './ffmpeg.ts';
import { posterArgs } from './mix.ts';

/**
 * One frame out of a film, or null when there is none to have.
 *
 * FFmpeg exits cleanly when a seek lands where no frame can be decoded — past
 * the last one, or in a file that ends early — and simply writes nothing, so
 * "it succeeded" is not the same as "there is a picture". Every caller used to
 * read the file it asked for straight after, and the ENOENT from a still that
 * was never written failed the whole render of a finished film.
 */
export async function extractFrame(
  videoPath: string,
  atSeconds: number,
  outputPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Uint8Array | null> {
  const extracted = await runFfmpeg(posterArgs(videoPath, Math.max(0, atSeconds), outputPath), {
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (!extracted.ok) return null;
  try {
    const bytes = await readFile(outputPath);
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
