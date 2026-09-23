import type { CDPSession, Page } from 'playwright-core';
import sharp from 'sharp';
import type { Deadline } from '../deadline.ts';
import { isolateForCapture, restoreAfterCapture } from '../probes/components-probe.ts';
import type { Rect } from '../schema.ts';

export type CaptureRequest = {
  selector: string;
  /** Ancestors stop painting, so only the element and its own shadow remain. */
  transparent: boolean;
  /** Device pixels per CSS pixel wanted; lowered to keep within `maxPixels`. */
  scale: number;
  maxPixels: number;
  /** Tallest capture, CSS px; a taller element is cut to it and marked as cropped. */
  maxHeight: number;
};

export type ElementCapture = {
  png: Buffer;
  rect: Rect;
  clip: Rect;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  transparent: boolean;
  opaqueCoverage: number;
  /** Share of pixels with anything drawn at all. */
  visibleCoverage: number;
  cropped: boolean;
};

export type CaptureOutcome = { ok: true; capture: ElementCapture } | { ok: false; reason: string };

const REVEAL_WAIT_MS = 1_500;

/**
 * One element, lifted out of the page at more than screen resolution.
 *
 * The DevTools capture takes a scale of its own, so the element is drawn
 * again at that scale — real pixels, text re-rasterised sharp — rather than
 * enlarged afterwards. With the default background overridden to transparent
 * and the element's ancestors made not to paint, what comes back is the
 * element alone, its rounded corners and its shadow carried in the alpha
 * channel: a piece a motion system can place on any ground.
 *
 * The page is always put back, whatever happens in between.
 */
export async function captureElement(
  page: Page,
  cdp: CDPSession,
  request: CaptureRequest,
  deadline: Deadline,
): Promise<CaptureOutcome> {
  const stage = `capture:${request.selector}`;
  const present = await deadline.within(
    page.evaluate(
      (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        element.scrollIntoView({ block: rect.height < window.innerHeight * 0.9 ? 'center' : 'start', inline: 'nearest' });
        return true;
      },
      request.selector,
    ),
    5_000,
    stage,
  );
  if (!present) return { ok: false, reason: 'the element is no longer in the page' };

  await deadline.within(page.evaluate(waitForReveal, { selector: request.selector, timeoutMs: REVEAL_WAIT_MS }), REVEAL_WAIT_MS + 1_000, stage).catch(() => undefined);

  let transparentBackground = false;
  try {
    const isolation = await deadline.within(
      page.evaluate(isolateForCapture, {
        selector: request.selector,
        transparent: request.transparent,
        maxHeight: request.maxHeight,
      }),
      5_000,
      stage,
    );
    if (!isolation) return { ok: false, reason: 'the element could not be isolated' };

    const { clip } = isolation;
    if (clip.width < 1 || clip.height < 1) return { ok: false, reason: 'the element has no size' };
    const scale = fitScale(request.scale, clip, request.maxPixels);

    if (request.transparent) {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      transparentBackground = true;
    }
    const shot = await deadline.within(
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale },
        captureBeyondViewport: true,
        fromSurface: true,
      }),
      15_000,
      stage,
    );
    const png = Buffer.from(shot.data, 'base64');
    const verdict = await inspectPixels(png);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    return {
      ok: true,
      capture: {
        png,
        rect: isolation.rect,
        clip,
        scale,
        pixelWidth: verdict.width,
        pixelHeight: verdict.height,
        transparent: verdict.transparent,
        opaqueCoverage: verdict.opaqueCoverage,
        visibleCoverage: verdict.visibleCoverage,
        cropped: isolation.rect.height + 4 > request.maxHeight,
      },
    };
  } finally {
    await page.evaluate(restoreAfterCapture).catch(() => undefined);
    if (transparentBackground) {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {}).catch(() => undefined);
    }
  }
}

/**
 * The largest scale that keeps the capture within the pixel budget, in
 * quarter steps, never below 1: a capture at less than screen resolution is
 * worse than the page it came from.
 */
export function fitScale(wanted: number, clip: { width: number; height: number }, maxPixels: number): number {
  const budget = Math.sqrt(maxPixels / Math.max(1, clip.width * clip.height));
  const scale = Math.min(4, wanted, budget);
  return Math.max(1, Math.floor(scale * 4) / 4);
}

type PixelVerdict =
  | { ok: true; width: number; height: number; transparent: boolean; opaqueCoverage: number; visibleCoverage: number }
  | { ok: false; reason: string };

/**
 * Refuses captures that show nothing: every pixel transparent, or every
 * pixel the same colour. Either means the element was not drawn — still
 * hidden behind a reveal, or clipped away — and keeping it would put an empty
 * rectangle into a film.
 */
export async function inspectPixels(png: Buffer): Promise<PixelVerdict> {
  const image = sharp(png).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.width < 1 || info.height < 1) return { ok: false, reason: 'the capture is empty' };
  const pixels = info.width * info.height;
  let opaque = 0;
  let visible = 0;
  let minLuma = 255;
  let maxLuma = 0;
  const stride = info.channels;
  // Sampled on a grid: exact enough for a verdict, cheap on a 16-megapixel hero.
  const step = Math.max(1, Math.floor(Math.sqrt(pixels / 250_000)));
  let sampled = 0;
  for (let y = 0; y < info.height; y += step) {
    for (let x = 0; x < info.width; x += step) {
      const offset = (y * info.width + x) * stride;
      const alpha = data[offset + 3]!;
      sampled += 1;
      if (alpha === 255) opaque += 1;
      if (alpha > 8) {
        visible += 1;
        const luma = 0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!;
        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
      }
    }
  }
  if (visible === 0) return { ok: false, reason: 'the capture is fully transparent' };
  if (maxLuma - minLuma < 2 && opaque === sampled) return { ok: false, reason: 'the capture is one flat colour' };
  return {
    ok: true,
    width: info.width,
    height: info.height,
    transparent: opaque < sampled,
    opaqueCoverage: Math.round((opaque / sampled) * 10000) / 10000,
    visibleCoverage: Math.round((visible / sampled) * 10000) / 10000,
  };
}

/**
 * How alike two pictures of the same thing are, 0..1.
 *
 * Both are brought to one size and composited over black and over white:
 * comparing on one backdrop alone would call a black mark with a transparent
 * background identical to a black rectangle. The score is one minus the mean
 * absolute difference across both.
 */
export async function visualSimilarity(a: Buffer, b: Buffer): Promise<number> {
  // Transparent margins are cut first: two captures of the same mark often
  // differ only in how much empty border came with them, and stretching one
  // to the other's frame would misalign every edge.
  const [left, right] = await Promise.all([trimTransparent(a), trimTransparent(b)]);
  const meta = await sharp(left).metadata();
  const width = 192;
  const height = Math.max(8, Math.min(768, Math.round((width * (meta.height ?? width)) / Math.max(1, meta.width ?? width))));
  let total = 0;
  for (const background of ['#000000', '#ffffff']) {
    // A light blur, so sub-pixel antialiasing differences between two correct
    // renderings do not read as a difference in the mark.
    const flatten = (image: Buffer) =>
      sharp(image).resize(width, height, { fit: 'fill' }).flatten({ background }).blur(0.6).removeAlpha().raw().toBuffer();
    const [first, second] = await Promise.all([flatten(left), flatten(right)]);
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) difference += Math.abs(first[index]! - (second[index] ?? 0));
    total += difference / (first.length * 255);
  }
  return Math.max(0, Math.min(1, 1 - total / 2));
}

async function trimTransparent(image: Buffer): Promise<Buffer> {
  try {
    return await sharp(image).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer();
  } catch {
    // Nothing to trim (or nothing but margin): compare as it is.
    return image;
  }
}

/* In-page: waits until the element is fully shown, finishing what animates it. */
export async function waitForReveal(input: { selector: string; timeoutMs: number }): Promise<boolean> {
  const element = document.querySelector(input.selector);
  if (!element) return false;
  const opacity = (): number => {
    let value = 1;
    for (let current: Element | null = element; current; current = current.parentElement) {
      value *= Number.parseFloat(getComputedStyle(current).opacity) || 0;
    }
    return value;
  };
  const started = Date.now();
  while (Date.now() - started < input.timeoutMs) {
    for (let current: Element | null = element; current; current = current.parentElement) {
      for (const animation of current.getAnimations?.() ?? []) {
        try {
          const end = animation.effect?.getComputedTiming().endTime;
          if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
        } catch {
          // Left as it is.
        }
      }
    }
    if (opacity() >= 0.98) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return opacity() >= 0.98;
}
