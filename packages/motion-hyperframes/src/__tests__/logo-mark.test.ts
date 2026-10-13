import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { drawsAMark } from '../render.ts';

/**
 * The last check before a logo goes on screen: does the file draw anything?
 * Real files, decoded by the same sharp the render uses.
 */
let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-logo-mark-'));
});

async function file(name: string, bytes: Buffer | string): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, bytes);
  return target;
}

describe('a logo file', () => {
  it('draws a mark when it has shapes in it', async () => {
    const svg = await file('mark.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32"><rect width="32" height="32" rx="6" fill="#1d99f3"/><rect x="40" y="10" width="76" height="12" fill="#232629"/></svg>');
    expect(await drawsAMark(svg)).toBe(true);
  });

  it('draws nothing when it is a sprite icon whose symbol stayed in the page', async () => {
    const svg = await file('sprite.svg', '<svg xmlns="http://www.w3.org/2000/svg" class="bi theme-icon" viewBox="0 0 20 20"><use href="#search-icon"/></svg>');
    expect(await drawsAMark(svg)).toBe(false);
  });

  it('reads a grey mark with transparency, not only colour pictures', async () => {
    const grey = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="20" fill="#777"/></svg>') }])
      .toColourspace('b-w')
      .png()
      .toBuffer();
    expect(await drawsAMark(await file('grey.png', grey))).toBe(true);
  });

  it('draws nothing when it is a flat swatch, or not a picture at all', async () => {
    const swatch = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#c82828' } }).jpeg().toBuffer();
    expect(await drawsAMark(await file('swatch.jpg', swatch))).toBe(false);
    expect(await drawsAMark(await file('junk.png', 'not a picture'))).toBe(false);
  });
});
