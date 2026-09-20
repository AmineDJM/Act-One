import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { planUiSequence } from '@act-one/core';
import { readUiStructure } from '../ui-structure.ts';

/**
 * Reading an interface out of pixels.
 *
 * The fixture is drawn rather than captured, and deliberately so: it is a
 * layout, not a product. Software is flat fields separated by whitespace with
 * hard edges between them, and everything this module does follows from that
 * one property, so a synthetic layout with a header bar, a sidebar, a content
 * column and a small notice at the bottom exercises exactly the thing.
 */
async function layout(width: number, height: number): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3, 246);
  const box = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y += 1) {
      for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x += 1) {
        const i = (y * width + x) * 3;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    }
  };
  /*
   * Rows of "type": a filled block reads as one flat field with two edges,
   * which is not what a paragraph looks like to a gradient detector. Lines
   * with gaps between them are.
   */
  const lines = (x0: number, y0: number, x1: number, y1: number, step: number) => {
    for (let t = y0; t < y1; t += step) box(x0, t, x1, t + step * 0.45, 40);
  };

  box(0, 0, 1, 0.06, 26);                 // application chrome
  lines(0.02, 0.1, 0.18, 0.45, 0.035);    // sidebar
  lines(0.26, 0.1, 0.72, 0.62, 0.03);     // the working column
  lines(0.26, 0.82, 0.46, 0.9, 0.03);     // a notice at the bottom
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

describe('reading the structure of a capture', () => {
  it('finds the panels a person would name', async () => {
    const structure = await readUiStructure(await layout(1600, 900));
    expect(structure.regions.length).toBeGreaterThanOrEqual(3);
    const has = (x: number, y: number) =>
      structure.regions.some(
        (region) => Math.abs(region.x - x) < 0.12 && Math.abs(region.y - y) < 0.12,
      );
    expect(has(0.02, 0.1)).toBe(true);
    expect(has(0.26, 0.1)).toBe(true);
    expect(has(0.26, 0.82)).toBe(true);
  });

  it('reports the size of the capture, not of the raster it was analysed at', async () => {
    /*
     * The analysis runs on a 260px reduction because gutters are cheaper and
     * cleaner to find there. Reporting that size made every capture look far
     * too small to crop, and the framing budget downstream then refused every
     * close-up on a 2324px screenshot — a fidelity check computed against a
     * picture nobody was going to show.
     */
    const structure = await readUiStructure(await layout(2324, 1224));
    expect(structure.width).toBe(2324);
    expect(structure.height).toBe(1224);
    const plan = planUiSequence(structure, { seconds: 7, frameAspect: 16 / 9, renderWidth: 1920 });
    expect(Math.min(...plan.framings.map((framing) => framing.to.width))).toBeLessThan(0.6);
  });

  it('normalises regions, so the same layout at two sizes reads the same', async () => {
    const small = await readUiStructure(await layout(1200, 675));
    const large = await readUiStructure(await layout(2400, 1350));
    expect(large.regions.length).toBe(small.regions.length);
    for (const [index, region] of large.regions.entries()) {
      expect(region.x).toBeCloseTo(small.regions[index]!.x, 1);
      expect(region.y).toBeCloseTo(small.regions[index]!.y, 1);
    }
  });
});
