import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { assessCapture, cropToFold, measure } from '../capture-quality.ts';

/** A PNG painted from a per-pixel function, so each test states its image. */
async function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

/** Deterministic noise: what a photograph looks like to a histogram. */
function noise(x: number, y: number): [number, number, number] {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
}

/** White page, a grey sidebar, a dark toolbar, rows of text-like dashes. */
function ui(x: number, y: number): [number, number, number] {
  if (y < 40) return [28, 30, 36];
  if (x < 200) return [244, 245, 247];
  const row = (y - 40) % 36;
  const inText = row > 12 && row < 22 && x > 240 && x < 240 + ((y * 7) % 500);
  return inText ? [40, 42, 48] : [255, 255, 255];
}

describe('assessCapture', () => {
  it('passes an interface', async () => {
    const result = await assessCapture(await png(1280, 800, ui), { expect: 'interface' });
    expect(result.verdict).toBe('filmable');
    expect(result.flatness).toBeGreaterThan(0.6);
  });

  it('refuses a blank capture', async () => {
    const result = await assessCapture(await png(1280, 800, () => [255, 255, 255]));
    expect(result.verdict).toBe('blank');
    expect(result.dominantShare).toBeGreaterThan(0.99);
  });

  it('refuses a photograph where an interface was expected', async () => {
    const result = await assessCapture(await png(1280, 800, noise), { expect: 'interface' });
    expect(result.verdict).toBe('photograph');
    expect(result.flatness).toBeLessThan(0.1);
  });

  it('accepts photography on a page, because pages have it', async () => {
    const result = await assessCapture(await png(1280, 800, noise), { expect: 'page' });
    expect(result.verdict).toBe('filmable');
  });

  it('refuses a capture too small for a frame', async () => {
    const result = await assessCapture(await png(400, 300, ui), { expect: 'interface' });
    expect(result.verdict).toBe('too_small');
  });
});

describe('measure', () => {
  it('reads a uniform buffer as one colour', () => {
    const data = new Uint8Array(4 * 4 * 3).fill(200);
    const stats = measure(data, 4, 4, 3);
    expect(stats.dominantShare).toBe(1);
    expect(stats.flatness).toBe(1);
    expect(stats.distinctColours).toBe(1);
  });
});

describe('cropToFold', () => {
  it('keeps the top of a tall capture at the viewport shape', async () => {
    const tall = await png(800, 3000, ui);
    const fold = await cropToFold(tall, 1.6);
    expect(fold.width).toBe(800);
    expect(fold.height).toBe(500);
    const meta = await sharp(Buffer.from(fold.bytes)).metadata();
    expect(meta.height).toBe(500);
  });

  it('leaves a capture at the shape alone', async () => {
    const wide = await png(800, 400, ui);
    const fold = await cropToFold(wide, 1.6);
    expect(fold.bytes).toBe(wide);
    expect(fold.height).toBe(400);
  });
});
