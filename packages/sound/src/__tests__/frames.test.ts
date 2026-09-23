import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../ffmpeg.ts';
import { extractFrame } from '../frames.ts';

describe('extractFrame', () => {
  let work: string;
  let film: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'act-one-frames-'));
    film = path.join(work, 'one-second.mp4');
    const made = await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=25:duration=1',
      '-pix_fmt', 'yuv420p', film,
    ]);
    if (!made.ok) throw new Error(`could not make the test film: ${made.stderr}`);
  }, 60_000);

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('returns the picture at a time inside the film', async () => {
    const frame = await extractFrame(film, 0.5, path.join(work, 'inside.jpg'));
    expect(frame).not.toBeNull();
    // A JPEG, not an empty file.
    expect(frame![0]).toBe(0xff);
    expect(frame![1]).toBe(0xd8);
  });

  it('returns null rather than throwing when the seek lands past the last frame', async () => {
    await expect(extractFrame(film, 5, path.join(work, 'past-the-end.jpg'))).resolves.toBeNull();
  });

  it('returns null when the film cannot be read at all', async () => {
    await expect(extractFrame(path.join(work, 'missing.mp4'), 0.5, path.join(work, 'none.jpg'))).resolves.toBeNull();
  });
});
