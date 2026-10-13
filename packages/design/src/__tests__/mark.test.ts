import { describe, expect, it } from 'vitest';
import { readMark, showsAMark } from '../mark.ts';

function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set(paint(x, y), (y * width + x) * 4);
  }
  return rgba;
}

describe('a mark', () => {
  it('is a shape against transparency, even in one colour', () => {
    const disc = picture(64, 64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 400 ? [29, 153, 243, 255] : [0, 0, 0, 0]));
    expect(showsAMark(readMark(disc, 64, 64))).toBe(true);
  });

  it('is a wordmark on an opaque ground', () => {
    const card = picture(120, 32, (x, y) => (x > 20 && x < 100 && y > 10 && y < 22 ? [35, 38, 41, 255] : [255, 255, 255, 255]));
    expect(showsAMark(readMark(card, 120, 32))).toBe(true);
  });

  it('is not a picture with nothing drawn in it — the sprite icon whose symbol stayed behind', () => {
    const empty = picture(64, 64, () => [0, 0, 0, 0]);
    expect(readMark(empty, 64, 64)).toEqual({ coverage: 0, spread: 0, shaped: false });
    expect(showsAMark(readMark(empty, 64, 64))).toBe(false);
  });

  it('is not a few stray pixels', () => {
    const specks = picture(100, 100, (x, y) => (x === 50 && y < 3 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(showsAMark(readMark(specks, 100, 100))).toBe(false);
  });

  it('is not a flat swatch edge to edge', () => {
    const swatch = picture(40, 40, () => [200, 40, 40, 255]);
    expect(showsAMark(readMark(swatch, 40, 40))).toBe(false);
  });

  it('reads a truncated buffer as nothing rather than past its end', () => {
    expect(readMark(new Uint8Array(10), 64, 64).coverage).toBe(0);
  });
});
