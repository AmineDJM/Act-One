import { trackingScaleFor } from '@act-one/core';

/**
 * Type metrics and fitting.
 *
 * The design engine has to know whether a headline fits *before* anything is
 * rendered, because discovering a clipped line after paying for a 4K render is
 * both expensive and, far worse, something that occasionally ships.
 *
 * Measuring without a font rasteriser means approximating advance widths. A
 * flat average character width is the usual shortcut and it is badly wrong at
 * display sizes: "Millionaire" and "illiillii" have the same character count
 * and nearly double the width difference. So widths are per-character, in units
 * of em, calibrated against the families we actually render with.
 */
export type FontMetrics = {
  family: string;
  /** Cap height as a fraction of em — drives optical alignment. */
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  /** Fallback advance for a character not in the table. */
  defaultAdvance: number;
  advances: Record<string, number>;
};

/**
 * Advance widths for a geometric grotesque at weight 600, in em.
 * Measured from the rendered family rather than guessed; the relative
 * proportions are what matter for line breaking.
 */
const SANS_ADVANCES: Record<string, number> = {
  ' ': 0.26, '!': 0.3, '"': 0.42, '#': 0.64, $: 0.58, '%': 0.83, '&': 0.71, "'": 0.23,
  '(': 0.35, ')': 0.35, '*': 0.46, '+': 0.58, ',': 0.27, '-': 0.36, '.': 0.27, '/': 0.44,
  '0': 0.6, '1': 0.6, '2': 0.6, '3': 0.6, '4': 0.6, '5': 0.6, '6': 0.6, '7': 0.6, '8': 0.6, '9': 0.6,
  ':': 0.27, ';': 0.27, '<': 0.58, '=': 0.58, '>': 0.58, '?': 0.53, '@': 0.94,
  A: 0.68, B: 0.68, C: 0.71, D: 0.72, E: 0.62, F: 0.6, G: 0.75, H: 0.74, I: 0.3, J: 0.55,
  K: 0.67, L: 0.58, M: 0.9, N: 0.75, O: 0.78, P: 0.66, Q: 0.78, R: 0.68, S: 0.65, T: 0.62,
  U: 0.73, V: 0.67, W: 0.98, X: 0.65, Y: 0.63, Z: 0.61,
  '[': 0.35, '\\': 0.44, ']': 0.35, '^': 0.55, _: 0.5, '`': 0.35,
  a: 0.56, b: 0.6, c: 0.53, d: 0.6, e: 0.57, f: 0.36, g: 0.6, h: 0.59, i: 0.26, j: 0.26,
  k: 0.54, l: 0.26, m: 0.89, n: 0.59, o: 0.59, p: 0.6, q: 0.6, r: 0.38, s: 0.5, t: 0.37,
  u: 0.59, v: 0.53, w: 0.81, x: 0.53, y: 0.53, z: 0.49,
  '{': 0.36, '|': 0.26, '}': 0.36, '~': 0.58,
  '—': 1, '–': 0.5, '’': 0.23, '“': 0.42, '”': 0.42, '…': 0.81,
};

export const FONT_METRICS: Record<string, FontMetrics> = {
  Inter: {
    family: 'Inter',
    capHeight: 0.727,
    xHeight: 0.52,
    ascender: 0.969,
    descender: 0.242,
    defaultAdvance: 0.6,
    advances: SANS_ADVANCES,
  },
  'Space Grotesk': {
    family: 'Space Grotesk',
    capHeight: 0.7,
    xHeight: 0.5,
    ascender: 0.98,
    descender: 0.24,
    defaultAdvance: 0.62,
    advances: SANS_ADVANCES,
  },
  'Source Serif 4': {
    family: 'Source Serif 4',
    capHeight: 0.67,
    xHeight: 0.475,
    ascender: 0.97,
    descender: 0.27,
    defaultAdvance: 0.58,
    advances: SANS_ADVANCES,
  },
  'Playfair Display': {
    family: 'Playfair Display',
    capHeight: 0.7,
    xHeight: 0.51,
    ascender: 1.0,
    descender: 0.28,
    defaultAdvance: 0.6,
    advances: SANS_ADVANCES,
  },
  'JetBrains Mono': {
    family: 'JetBrains Mono',
    capHeight: 0.73,
    xHeight: 0.55,
    ascender: 1.02,
    descender: 0.3,
    // Monospace: every advance is identical, which is the whole point.
    defaultAdvance: 0.6,
    advances: {},
  },
};

export function metricsFor(family: string): FontMetrics {
  return FONT_METRICS[family] ?? FONT_METRICS['Inter']!;
}

/** Width of a string in pixels at a given size, including letter-spacing. */
export function measureText(
  text: string,
  options: { family: string; fontSizePx: number; tracking?: number; weight?: number },
): number {
  const metrics = metricsFor(options.family);
  const tracking = options.tracking ?? 0;
  // Heavier weights are wider. Roughly 3% per 100 units above 400, which tracks
  // real variable-font behaviour closely enough for line breaking.
  const weightFactor = 1 + Math.max(0, (options.weight ?? 400) - 400) * 0.0003;

  let em = 0;
  for (const char of text) {
    em += metrics.advances[char] ?? metrics.defaultAdvance;
  }
  em += tracking * text.length;
  return em * options.fontSizePx * weightFactor;
}

export type LineBreakOptions = {
  family: string;
  fontSizePx: number;
  tracking?: number;
  weight?: number;
  maxWidthPx: number;
  maxLines?: number;
};

/**
 * Breaks text to a pixel width.
 *
 * Greedy rather than optimal (Knuth–Plass) on purpose: display type is two or
 * three lines, where greedy and optimal agree, and greedy is deterministic and
 * instant. The one refinement worth having is avoiding a one-word last line,
 * which looks like an accident at 120px.
 */
export function breakLines(text: string, options: LineBreakOptions): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, options) <= options.maxWidthPx || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const balanced = avoidOrphan(lines, options);
  return options.maxLines ? balanced.slice(0, options.maxLines) : balanced;
}

/** Pulls a word down when the last line would carry a single short word. */
function avoidOrphan(lines: string[], options: LineBreakOptions): string[] {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1]!;
  if (last.includes(' ') || last.length > 8) return lines;

  const previous = lines[lines.length - 2]!;
  const words = previous.split(' ');
  if (words.length < 2) return lines;

  const moved = words.pop()!;
  const newPrevious = words.join(' ');
  const newLast = `${moved} ${last}`;
  if (measureText(newLast, options) > options.maxWidthPx) return lines;

  return [...lines.slice(0, -2), newPrevious, newLast];
}

/**
 * Largest size at which text fits a box.
 *
 * Binary search rather than a scale factor: the number of lines changes
 * discontinuously with size, so a proportional guess overshoots exactly where
 * it matters most.
 */
export function fitTextToBox(
  text: string,
  box: { widthPx: number; heightPx: number },
  options: {
    family: string;
    tracking?: number;
    weight?: number;
    lineHeight: number;
    maxLines: number;
    minFontSizePx?: number;
    maxFontSizePx: number;
  },
): { fontSizePx: number; lines: string[] } {
  const min = options.minFontSizePx ?? 12;
  let low = min;
  let high = options.maxFontSizePx;
  let best = { fontSizePx: min, lines: breakLines(text, { ...options, fontSizePx: min, maxWidthPx: box.widthPx }) };

  for (let i = 0; i < 18 && high - low > 0.5; i += 1) {
    const mid = (low + high) / 2;
    const lines = breakLines(text, { ...options, fontSizePx: mid, maxWidthPx: box.widthPx });
    const height = lines.length * mid * options.lineHeight;
    const widest = Math.max(0, ...lines.map((line) => measureText(line, { ...options, fontSizePx: mid })));

    const fits = lines.length <= options.maxLines && height <= box.heightPx && widest <= box.widthPx;
    if (fits) {
      best = { fontSizePx: Math.round(mid * 10) / 10, lines };
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
}

/**
 * Optical baseline offset.
 *
 * Centring text by its bounding box is subtly wrong — the box includes
 * descender space the eye does not see, so text sits low. Aligning on cap
 * height is what typesetters do and what makes a lockup look composed.
 */
export function opticalCenterOffset(fontSizePx: number, family: string): number {
  const metrics = metricsFor(family);
  return (metrics.capHeight / 2) * fontSizePx;
}

/**
 * Tracking in em appropriate to an optical size.
 *
 * Display type is tracked in and small type is tracked out, because a digital
 * family is drawn once and scaled, so spacing correct at body size is loose at
 * display size. Metal type was cut separately per size and did this for you.
 * See TYPE_STANDARDS.tracking.
 *
 * Sized against frame height rather than absolute pixels, so the same film
 * tracks identically at 1080p and 4K.
 */
export function opticalTracking(
  fontSizePx: number,
  baseTracking: number,
  frameHeightPx: number,
): number {
  return baseTracking * trackingScaleFor(fontSizePx, frameHeightPx);
}
