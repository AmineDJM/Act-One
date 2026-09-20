import { expandHex } from '@act-one/core';

/**
 * Colour maths for the design engine.
 *
 * Deliberately not a dependency: the operations we need are few, and owning
 * them means our contrast checks, tint ramps and overlay decisions are exactly
 * the ones the QA pass asserts against. Perceptual work (lightness ramps,
 * "is this colour dark") goes through OKLab rather than HSL, because HSL's
 * lightness is not perceptual and produces muddy mid-tones on saturated brand
 * colours — the classic tell of an auto-generated palette.
 */
export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const value = expandHex(hex).replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** sRGB -> linear, the gamma expansion every correct colour operation needs. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type Oklab = { L: number; a: number; b: number };

export function hexToOklab(hex: string): Oklab {
  const { r, g, b } = hexToRgb(hex);
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToHex({ L, a, b }: Oklab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return rgbToHex({
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** Perceptual lightness, 0..1. */
export function lightness(hex: string): number {
  return clamp(hexToOklab(hex).L, 0, 1);
}

export function chroma(hex: string): number {
  const { a, b } = hexToOklab(hex);
  return Math.hypot(a, b);
}

/** Sets perceptual lightness while preserving hue and chroma. */
export function withLightness(hex: string, L: number): string {
  const lab = hexToOklab(hex);
  return oklabToHex({ ...lab, L: clamp(L, 0, 1) });
}

export function mix(a: string, b: string, amount: number): string {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  const t = clamp(amount, 0, 1);
  return oklabToHex({
    L: la.L + (lb.L - la.L) * t,
    a: la.a + (lb.a - la.a) * t,
    b: la.b + (lb.b - la.b) * t,
  });
}

/**
 * The darkest a film's canvas is allowed to be, and the lightest.
 *
 * Every creative system in the catalogue says some version of the same thing —
 * "a brand-tinted near-black, never #000. Pure black kills the sense of a lit
 * space and makes the UI look pasted on" — and nothing enforced it. The canvas
 * came straight out of brand extraction, so a site with a black background
 * produced a film whose every frame measured 0,0,0 in every corner: not a dark
 * film, an absence of one. The white end matters for the same reason and for
 * one more: a deliverable is studio range, and paper white clips there.
 */
export const CANVAS_FLOOR_L = 0.125;
export const CANVAS_CEILING_L = 0.965;

/**
 * The canvas a film is actually shot on.
 *
 * Lifts a black off the floor and pulls a white off the ceiling, and gives the
 * lift the brand's own hue rather than a neutral grey — a near-black that
 * carries a trace of the accent reads as a lit room, and a neutral one reads
 * as a switched-off screen. The tint is small on purpose: at a tenth of the
 * accent it is below the threshold anybody could name, which is exactly where
 * it belongs.
 *
 * A canvas already inside the range is returned untouched. A brand that chose
 * #101014 chose it.
 */
export function filmCanvas(canvas: string, accent: string): string {
  const L = lightness(canvas);
  if (L < CANVAS_FLOOR_L) {
    /*
     * Hue first, lightness second, and in that order for a reason: setting a
     * saturated accent to a near-black lightness asks sRGB for a colour it
     * does not have, and the clipped answer comes back both brighter and far
     * more coloured than it was asked for — which is how a "trace of blue"
     * became a navy canvas the first time this was written.
     */
    const tinted = chroma(canvas) < 0.01 ? mix(canvas, accent, 0.12) : canvas;
    return withLightness(tinted, CANVAS_FLOOR_L);
  }
  if (L > CANVAS_CEILING_L) return withLightness(canvas, CANVAS_CEILING_L);
  return canvas;
}

export function isDark(hex: string): boolean {
  return lightness(hex) < 0.55;
}

/**
 * Picks whichever of the supplied foregrounds reads best on `background`.
 * Falls back to pure black/white only when nothing in the brand palette
 * clears the threshold — a film with unreadable type is worse than a film
 * that steps outside the palette for one caption.
 */
export function readableOn(
  background: string,
  candidates: string[],
  minimumContrast = 4.5,
): { color: string; contrast: number; usedFallback: boolean } {
  let best: { color: string; contrast: number } | null = null;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (!best || ratio > best.contrast) best = { color: candidate, contrast: ratio };
  }
  if (best && best.contrast >= minimumContrast) return { ...best, usedFallback: false };

  const white = contrastRatio(background, '#ffffff');
  const black = contrastRatio(background, '#000000');
  const fallback = white >= black ? '#ffffff' : '#000000';
  return { color: fallback, contrast: Math.max(white, black), usedFallback: true };
}

/**
 * Nudges a colour along the lightness axis until it clears the contrast
 * threshold against a background. Used for accent colours that are correct for
 * the brand but unreadable as type at their native lightness — very common
 * with saturated blues and greens on dark canvases.
 */
export function ensureContrast(
  color: string,
  background: string,
  minimumContrast = 4.5,
): string {
  if (contrastRatio(color, background) >= minimumContrast) return color;

  const backgroundIsDark = isDark(background);
  const step = backgroundIsDark ? 0.03 : -0.03;
  let candidate = color;
  for (let i = 0; i < 30; i += 1) {
    const next = withLightness(candidate, lightness(candidate) + step);
    if (next === candidate) break;
    candidate = next;
    if (contrastRatio(candidate, background) >= minimumContrast) return candidate;
  }
  return backgroundIsDark ? '#ffffff' : '#0a0a0a';
}

/** A neutral ramp derived from the brand, not from grey. Keeps films cohesive. */
export function neutralRamp(seed: string, steps = 9, tint = 0.06): string[] {
  const ramp: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const L = 0.04 + (i / (steps - 1)) * 0.94;
    const grey = oklabToHex({ L, a: 0, b: 0 });
    ramp.push(mix(grey, seed, tint));
  }
  return ramp;
}

/** Tints and shades of a brand colour at perceptually even spacing. */
export function colorRamp(seed: string, steps = 7): string[] {
  const ramp: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    ramp.push(withLightness(seed, 0.2 + (i / (steps - 1)) * 0.68));
  }
  return ramp;
}

/** Distance in OKLab; used to deduplicate near-identical measured colours. */
export function perceptualDistance(a: string, b: string): number {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
}

export function dedupeColors(colors: string[], threshold = 0.05): string[] {
  const kept: string[] = [];
  for (const color of colors) {
    if (!kept.some((existing) => perceptualDistance(existing, color) < threshold)) {
      kept.push(color);
    }
  }
  return kept;
}

export function isNeutral(hex: string, chromaThreshold = 0.035): boolean {
  return chroma(hex) < chromaThreshold;
}

export function withAlpha(hex: string, alpha: number): string {
  const a = clamp(Math.round(alpha * 255), 0, 255).toString(16).padStart(2, '0');
  return `${expandHex(hex)}${a}`;
}
