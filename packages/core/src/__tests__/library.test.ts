import { describe, it, expect } from 'vitest';
import { categoryFromFilename, imageInfo, nameFromFilename, rankLibraryAssets, svgIsSafe } from '../index.ts';

/**
 * The library's small certainties: what a file is, read from its bytes; a
 * first guess at a category from its name that never overreaches; and the
 * order the creative system consults assets in.
 */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with the frame size.
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function webpX(width: number, height: number): Uint8Array {
  const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

describe('imageInfo', () => {
  it('reads dimensions from PNG, JPEG and WebP headers', () => {
    expect(imageInfo(png(1920, 1080))).toMatchObject({ format: 'png', contentType: 'image/png', width: 1920, height: 1080 });
    expect(imageInfo(jpeg(640, 427))).toMatchObject({ format: 'jpeg', extension: 'jpg', width: 640, height: 427 });
    expect(imageInfo(webpX(2560, 1440))).toMatchObject({ format: 'webp', width: 2560, height: 1440 });
  });

  it('reads an SVG by its markup, with the size from attributes or the viewBox', () => {
    const text = (svg: string) => new TextEncoder().encode(svg);
    expect(imageInfo(text('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"></svg>'))).toMatchObject({ format: 'svg', width: 120, height: 40 });
    expect(imageInfo(text('<svg viewBox="0 0 512 256"><path d="M0 0"/></svg>'))).toMatchObject({ format: 'svg', width: 512, height: 256 });
    expect(imageInfo(text('<svg width="100%" height="auto"></svg>'))).toMatchObject({ format: 'svg', width: null, height: null });
  });

  it('refuses what is not an image, whatever it is called', () => {
    expect(imageInfo(new TextEncoder().encode('<html><body>hello</body></html>'))).toBeNull();
    expect(imageInfo(new TextEncoder().encode('%PDF-1.7 ...'))).toBeNull();
    expect(imageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF: not yet
    expect(imageInfo(new Uint8Array(0))).toBeNull();
  });
});

describe('svgIsSafe', () => {
  const svg = (inner: string, attrs = '') => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`);
  it('accepts drawing and refuses anything that runs or reaches out', () => {
    expect(svgIsSafe(svg('<path d="M0 0h10v10z" fill="#5b6cff"/><text>Act One</text>'))).toBe(true);
    expect(svgIsSafe(svg('<script>alert(1)</script>'))).toBe(false);
    expect(svgIsSafe(svg('<rect onload="alert(1)"/>'))).toBe(false);
    expect(svgIsSafe(svg('<a href="javascript:alert(1)"><rect/></a>'))).toBe(false);
    expect(svgIsSafe(svg('<image href="https://tracker.example/pixel.png"/>'))).toBe(false);
    expect(svgIsSafe(svg('<foreignObject><div>hi</div></foreignObject>'))).toBe(false);
    expect(svgIsSafe(svg('<style>@import url(https://x.example/a.css)</style>'))).toBe(false);
  });
});

describe('categoryFromFilename', () => {
  it('guesses from the name and admits when it cannot', () => {
    expect(categoryFromFilename('acme-logo-dark.svg')).toBe('logo');
    expect(categoryFromFilename('Screenshot 2026-09-12 at 10.14.03.png')).toBe('screenshot');
    expect(categoryFromFilename('founder_portrait.jpg')).toBe('founder');
    expect(categoryFromFilename('team-offsite-2026.jpg')).toBe('team');
    expect(categoryFromFilename('HQ_office.webp')).toBe('office');
    expect(categoryFromFilename('dashboard-mockup@2x.png')).toBe('ui');
    expect(categoryFromFilename('packshot-front.png')).toBe('product');
    expect(categoryFromFilename('moodboard-01.png')).toBe('reference');
    expect(categoryFromFilename('IMG_2041.jpg')).toBe('other');
    expect(categoryFromFilename('mark.svg', 'image/svg+xml')).toBe('logo');
  });
});

describe('nameFromFilename', () => {
  it('drops the extension and the path, keeps the words', () => {
    expect(nameFromFilename('/Users/amine/Desktop/founder_portrait.JPG')).toBe('founder portrait');
    expect(nameFromFilename('Screenshot 2026-09-12 at 10.14.03.png')).toBe('Screenshot 2026-09-12 at 10.14.03');
    expect(nameFromFilename('.hidden')).toBe('.hidden');
  });
});

describe('rankLibraryAssets', () => {
  it('puts approved first, then favourites, then the newest', () => {
    const ranked = rankLibraryAssets([
      { id: 'old', approved: false, favorite: false, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'new', approved: false, favorite: false, createdAt: '2026-02-01T00:00:00Z' },
      { id: 'fav', approved: false, favorite: true, createdAt: '2025-01-01T00:00:00Z' },
      { id: 'ok', approved: true, favorite: false, createdAt: '2024-01-01T00:00:00Z' },
    ]);
    expect(ranked.map((asset) => asset.id)).toEqual(['ok', 'fav', 'new', 'old']);
  });
});
