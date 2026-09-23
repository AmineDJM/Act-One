import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AssetCollector } from '../assets.ts';
import { unsafeRequestReason } from '../browser/request-guard.ts';
import { fitScale, inspectPixels, visualSimilarity } from '../capture/element-capture.ts';
import { Deadline } from '../deadline.ts';
import { IngestionError } from '../errors.ts';
import { AssetRef } from '../schema.ts';

describe('Deadline', () => {
  it('returns what finishes in time', async () => {
    const deadline = new Deadline(1_000);
    await expect(deadline.within(Promise.resolve(42), 500, 'step')).resolves.toBe(42);
    deadline.dispose();
  });

  it('stops a step that hangs, as a timeout at that step', async () => {
    const deadline = new Deadline(5_000);
    const hung = new Promise<never>(() => undefined);
    await expect(deadline.within(hung, 30, 'palette')).rejects.toMatchObject({ failure: 'timeout', stage: 'palette' });
    deadline.dispose();
  });

  it('never gives a step more than the run has left', async () => {
    const deadline = new Deadline(40);
    await expect(deadline.within(new Promise(() => undefined), 10_000, 'fonts')).rejects.toBeInstanceOf(IngestionError);
    expect(deadline.remaining()).toBe(0);
    expect(() => deadline.check('after')).toThrow(/time was spent/);
    deadline.dispose();
  });

  it('reports cancellation as cancellation, not as a timeout', async () => {
    const controller = new AbortController();
    const deadline = new Deadline(5_000, controller.signal);
    const pending = deadline.within(new Promise(() => undefined), 5_000, 'logo');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ failure: 'cancelled' });
    deadline.dispose();
  });

  it('does not leak the loser of the race as an unhandled rejection', async () => {
    const deadline = new Deadline(5_000);
    const late = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late')), 30));
    await expect(deadline.within(late, 5, 'step')).rejects.toMatchObject({ failure: 'timeout' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    deadline.dispose();
  });
});

describe('AssetCollector', () => {
  it('addresses by content and dedupes', () => {
    const collector = new AssetCollector(1_000);
    const first = collector.add('capture-png', 'image/png', Buffer.from('abc'))!;
    const again = collector.add('capture-png', 'image/png', Buffer.from('abc'))!;
    expect(again.id).toBe(first.id);
    expect(collector.files()).toHaveLength(1);
    expect(() => AssetRef.parse(first)).not.toThrow();
    expect(first.fileName).toBe(`${first.id}.png`);
  });

  it('refuses what would pass the budget, and empty files', () => {
    const collector = new AssetCollector(4);
    expect(collector.add('font', 'font/woff2', Buffer.from('abcd'))).not.toBeNull();
    expect(collector.add('font', 'font/woff2', Buffer.from('e'))).toBeNull();
    expect(collector.add('font', 'font/woff2', Buffer.alloc(0))).toBeNull();
    expect(collector.totalBytes).toBe(4);
  });
});

describe('unsafeRequestReason', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/', /private/],
    ['http://metadata.google.internal/computeMetadata/v1/', /private/],
    ['http://127.0.0.1:8080/', /private/],
    ['http://[::1]/', /private/],
    ['http://2130706433/', /private/],
    ['http://10.0.0.5/fonts.css', /private/],
    ['http://user:pass@brand.example/', /credentials/],
    ['file:///etc/passwd', /scheme/],
    ['ftp://brand.example/', /scheme/],
    ['not a url', /unparseable/],
  ])('refuses %s', (url, reason) => {
    expect(unsafeRequestReason(url)).toMatch(reason);
  });

  it.each(['https://brand.example/app.css', 'https://fonts.gstatic.com/s/inter.woff2', 'data:font/woff2;base64,AAAA', 'blob:https://brand.example/1'])(
    'lets %s through',
    (url) => {
      expect(unsafeRequestReason(url)).toBeNull();
    },
  );
});

describe('capture pixels', () => {
  const png = (width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) => {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) data.set(fill(x, y), (y * width + x) * 4);
    }
    return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  };

  it('refuses a capture with nothing drawn', async () => {
    expect(await inspectPixels(await png(20, 20, () => [0, 0, 0, 0]))).toMatchObject({ ok: false, reason: /transparent/ });
    expect(await inspectPixels(await png(20, 20, () => [255, 255, 255, 255]))).toMatchObject({ ok: false, reason: /flat/ });
  });

  it('accepts a rounded, shadowed piece and says how much of it is opaque', async () => {
    const card = await png(40, 20, (x) => (x < 10 ? [0, 0, 0, 40] : x < 30 ? [255, 255, 255, 255] : [30, 90, 200, 255]));
    const verdict = await inspectPixels(card);
    expect(verdict).toMatchObject({ ok: true, transparent: true, width: 40, height: 20 });
    if (verdict.ok) expect(verdict.opaqueCoverage).toBeCloseTo(0.75, 2);
  });

  it('scores the same picture as identical and a different one as different', async () => {
    const a = await png(32, 32, (x, y) => (x > y ? [200, 0, 0, 255] : [0, 0, 0, 0]));
    const b = await png(32, 32, (x, y) => (x > y ? [0, 0, 200, 255] : [0, 0, 0, 0]));
    expect(await visualSimilarity(a, a)).toBe(1);
    expect(await visualSimilarity(a, b)).toBeLessThan(0.9);
  });

  it('fits the scale to the pixel budget in quarter steps, never below one', () => {
    expect(fitScale(4, { width: 100, height: 40 }, 16_000_000)).toBe(4);
    expect(fitScale(3, { width: 1440, height: 900 }, 16_000_000)).toBe(3);
    expect(fitScale(4, { width: 2400, height: 1600 }, 16_000_000)).toBe(2);
    expect(fitScale(4, { width: 8000, height: 8000 }, 16_000_000)).toBe(1);
  });
});
