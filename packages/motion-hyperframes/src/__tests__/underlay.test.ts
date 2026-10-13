import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '@act-one/sound';
import { encodeFrames } from '../media.ts';

/**
 * The launch look's backdrop laid under frames captured without it.
 *
 * Real FFmpeg, on pictures whose colours are known: three plates (red, green,
 * blue) changing by an iris at 1 s and a dissolve at 2 s, under frames that
 * are transparent but for a half-transparent white box. Read back at chosen
 * moments, the encoded film shows what the page would have.
 */
const W = 160;
const H = 90;
const FPS = 10;
let dir = '';
let film = '';

async function solid(file: string, r: number, g: number, b: number): Promise<string> {
  await sharp({ create: { width: W, height: H, channels: 3, background: { r, g, b } } }).png().toFile(file);
  return file;
}

/** The decoded RGB of one pixel at a time in the film. */
async function pixel(seconds: number, x: number, y: number): Promise<[number, number, number]> {
  const frame = Math.round(seconds * FPS);
  const out = path.join(dir, `px-${frame}-${x}-${y}.png`);
  const result = await runFfmpeg(['-y', '-v', 'error', '-i', film, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', out]);
  if (!result.ok) throw new Error(result.stderr);
  const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (Math.min(y, info.height - 1) * info.width + Math.min(x, info.width - 1)) * 3;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-underlay-'));
  const stills = [await solid(path.join(dir, 'red.png'), 220, 30, 30), await solid(path.join(dir, 'green.png'), 30, 200, 60), await solid(path.join(dir, 'blue.png'), 30, 60, 220)];
  const frames = path.join(dir, 'frames');
  await mkdir(frames);
  const box = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="40" height="30" fill="#ffffff" fill-opacity="0.5"/></svg>`);
  for (let index = 0; index < 3 * FPS; index += 1) {
    await sharp(box).png().toFile(path.join(frames, `frame_${String(index).padStart(4, '0')}.png`));
  }
  film = path.join(dir, 'film.mp4');
  await encodeFrames(frames, film, {
    fps: FPS, frames: 3 * FPS, width: W, height: H, crf: 10,
    underlay: { stills, first: 0, changes: [{ to: 1, at: 1, seconds: 0.6, transition: 'iris' }, { to: 2, at: 2, seconds: 0.6, transition: 'fade' }] },
  });
}, 120_000);

const near = (actual: number[], expected: number[], tolerance = 14) => actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);

describe('frames over the backdrop’s plates', () => {
  it('show the first plate, then the iris opening from the centre, then the second plate', async () => {
    expect(near(await pixel(0.5, 120, 60), [220, 30, 30])).toBe(true);
    // Halfway through the iris: the centre has the new plate, towards the corner still the old (the circle's radius is 49 px at this size; that point is 67 px out).
    expect(near(await pixel(1.3, W / 2, H / 2), [30, 200, 60])).toBe(true);
    expect(near(await pixel(1.3, 140, 75), [220, 30, 30], 22)).toBe(true);
    expect(near(await pixel(1.8, 140, 75), [30, 200, 60])).toBe(true);
  });

  it('dissolve from one plate to the next on an eased curve', async () => {
    // Halfway in time is halfway eased (power2.inOut is symmetric): an even mix of green and blue.
    expect(near(await pixel(2.3, 120, 60), [30, 130, 140], 18)).toBe(true);
    expect(near(await pixel(2.8, 120, 60), [30, 60, 220])).toBe(true);
  });

  it('lay each frame over the plate with its own alpha', async () => {
    // Half-transparent white over red.
    expect(near(await pixel(0.5, 10, 10), [238, 143, 143], 16)).toBe(true);
  });
});

describe('the easing the plates change on', () => {
  it('is GSAP’s power2.inOut, a cubic', async () => {
    const { power2InOut } = await import('../media.ts');
    expect(power2InOut(0)).toBe(0);
    expect(power2InOut(0.25)).toBeCloseTo(0.0625, 6);
    expect(power2InOut(0.5)).toBeCloseTo(0.5, 6);
    expect(power2InOut(0.75)).toBeCloseTo(0.9375, 6);
    expect(power2InOut(1.2)).toBe(1);
  });
});

describe('a frame of the iris', () => {
  it('is, pixel for pixel, the incoming act inside a soft-edged circle over the outgoing one', async () => {
    const { plateRuns, power2InOut } = await import('../media.ts');
    const work = await mkdtemp(path.join(tmpdir(), 'act-one-iris-'));
    const w = 64;
    const h = 36;
    const noise = (seed: number) => Buffer.from(Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + seed * 101) % 251));
    const a = noise(1);
    const b = noise(2);
    await sharp(a, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(work, 'a.png'));
    await sharp(b, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(work, 'b.png'));
    const runs = await plateRuns({ stills: [path.join(work, 'a.png'), path.join(work, 'b.png')], first: 0, changes: [{ to: 1, at: 0.1, seconds: 1, transition: 'iris' }] }, { width: w, height: h }, 10, 20, path.join(work, 'runs'));
    expect(runs.map((run) => [run.kind, run.frames])).toEqual([['still', 2], ['sequence', 9], ['still', 9]]);
    // Frame 6 is t = 0.6 s, half a second into the change.
    const { data } = await sharp(path.join(work, 'runs', 'change-0-00006.png')).raw().toBuffer({ resolveWithObject: true });
    const radius = power2InOut(0.5) * (0.75 * Math.hypot(w, h)) / Math.SQRT2;
    let differ = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const cover = Math.min(1, Math.max(0, (radius - Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2)) / 1.5 + 0.5));
        for (let c = 0; c < 3; c += 1) {
          const at = (y * w + x) * 3 + c;
          if (data[at] !== Math.round(a[at]! + (b[at]! - a[at]!) * cover)) differ += 1;
        }
      }
    }
    expect(differ).toBe(0);
  });
});
