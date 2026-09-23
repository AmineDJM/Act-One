import { describe, expect, it } from 'vitest';
import { compositeOver, gamutMapToSrgb, parseCssColor, srgbToHex } from '../css-color.ts';

/*
 * The oracle is Chromium itself: each colour was painted on an sRGB canvas and
 * read back. For colours inside sRGB the canvas is exact, so the parser must
 * agree to within one code value (the canvas rounds, the parser rounds, and
 * the two may round a .5 in different directions).
 */
const CHROMIUM_IN_GAMUT: [string, [number, number, number]][] = [
  ['oklch(0.62 0.19 259.8)', [57, 129, 246]],
  ['oklch(0.985 0 0)', [250, 250, 250]],
  ['oklch(0.21 0.006 285.885)', [24, 24, 27]],
  ['oklab(0.5 0.1 -0.1)', [129, 69, 154]],
  ['oklab(0.7 -0.05 0.08)', [148, 168, 100]],
  ['lab(50 40 -20)', [171, 90, 154]],
  ['lab(80 -20 30)', [176, 208, 141]],
  ['lch(60 40 120)', [125, 154, 81]],
  ['lch(35 30 300)', [89, 75, 124]],
  ['color(display-p3 0.5 0.4 0.3)', [132, 101, 73]],
  ['color(srgb 0.25 0.5 0.75)', [64, 128, 191]],
  ['color(srgb-linear 0.2 0.3 0.4)', [124, 149, 170]],
  ['color(a98-rgb 0.4 0.5 0.6)', [89, 128, 155]],
  ['color(prophoto-rgb 0.4 0.4 0.5)', [112, 121, 149]],
  ['color(rec2020 0.4 0.5 0.3)', [100, 142, 84]],
  ['color(xyz-d65 0.3 0.3 0.3)', [162, 145, 143]],
  ['color(xyz-d50 0.2 0.25 0.2)', [99, 147, 134]],
  ['hsl(210 50% 40%)', [51, 102, 153]],
  ['hwb(120 10% 20%)', [26, 204, 26]],
  ['rgb(12 200 99)', [12, 200, 99]],
  ['rgb(59, 130, 246)', [59, 130, 246]],
  ['#3b82f6', [59, 130, 246]],
];

function bytes(css: string): [number, number, number] {
  const parsed = parseCssColor(css);
  if (!parsed) throw new Error(`did not parse ${css}`);
  return [parsed.srgb.r, parsed.srgb.g, parsed.srgb.b].map((channel) => Math.round(channel * 255)) as [
    number,
    number,
    number,
  ];
}

describe('parseCssColor against Chromium', () => {
  it.each(CHROMIUM_IN_GAMUT)('%s', (css, expected) => {
    const actual = bytes(css);
    actual.forEach((channel, index) => expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(1));
    expect(parseCssColor(css)!.inGamut).toBe(true);
  });
});

describe('parseCssColor syntax', () => {
  it('reads every hex length', () => {
    expect(parseCssColor('#abc')!.hex).toBe('#aabbcc');
    expect(parseCssColor('#abcd')!.alpha).toBeCloseTo(0xdd / 255, 6);
    expect(parseCssColor('#A1B2C3')!.hex).toBe('#a1b2c3');
    expect(parseCssColor('#a1b2c380')!.hex8).toBe('#a1b2c380');
  });

  it('reads legacy and modern alpha, as a number or a percentage', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')!.alpha).toBe(0.5);
    expect(parseCssColor('rgb(0 0 0 / 25%)')!.alpha).toBe(0.25);
    expect(parseCssColor('oklch(0.7 0.1 250 / 0.4)')!.alpha).toBe(0.4);
    expect(parseCssColor('hsla(0, 100%, 50%, 1)')!.hex).toBe('#ff0000');
  });

  it('treats none as zero and reads every angle unit', () => {
    expect(parseCssColor('oklch(0.7 0 none)')!.oklch.c).toBeLessThan(1e-6);
    const degrees = parseCssColor('hsl(180deg 50% 50%)')!.hex;
    expect(parseCssColor('hsl(0.5turn 50% 50%)')!.hex).toBe(degrees);
    expect(parseCssColor(`hsl(${Math.PI}rad 50% 50%)`)!.hex).toBe(degrees);
    expect(parseCssColor('hsl(200grad 50% 50%)')!.hex).toBe(degrees);
  });

  it('reads percentages in the lab family against their reference ranges', () => {
    expect(parseCssColor('lab(50% 32% -16%)')!.hex).toBe(parseCssColor('lab(50 40 -20)')!.hex);
    expect(parseCssColor('oklch(62% 47.5% 259.8)')!.hex).toBe(parseCssColor('oklch(0.62 0.19 259.8)')!.hex);
  });

  it('reads transparent as black with no alpha', () => {
    const parsed = parseCssColor('transparent')!;
    expect(parsed.alpha).toBe(0);
    expect(parsed.hex8).toBe('#00000000');
  });

  it('refuses what it cannot read rather than guessing', () => {
    for (const bad of [
      '',
      'rebeccapurple',
      'currentcolor',
      'var(--brand)',
      'rgb(1 2)',
      'rgb(1, 2 3)',
      'rgb(1 2 3 / )',
      'oklch(0.5 0.1 20% )',
      'color(unknown 1 1 1)',
      'color(srgb 1, 1, 1)',
      'hsl(10 20% 30% / 1 / 2)',
      '#12',
      '#ggg',
      'rgb(1 2 3) extra',
      'linear-gradient(red, blue)',
      'x'.repeat(400),
    ]) {
      expect(parseCssColor(bad), bad).toBeNull();
    }
  });

  it('keeps the value as written, for a render that wants the exact CSS', () => {
    expect(parseCssColor('  oklch(0.62 0.19 259.8)  ')!.css).toBe('oklch(0.62 0.19 259.8)');
  });
});

describe('gamut mapping', () => {
  const OUT_OF_GAMUT = [
    'oklch(0.623 0.214 259.815)',
    'oklch(0.705 0.213 47.604)',
    'color(display-p3 0.2 0.6 0.8)',
    'color(display-p3 1 0 0)',
    'color(rec2020 0 1 0)',
    'oklch(0.9 0.37 145)',
  ];

  it.each(OUT_OF_GAMUT)('%s lands inside sRGB with its hue and lightness held', (css) => {
    const parsed = parseCssColor(css)!;
    expect(parsed.inGamut).toBe(false);
    for (const channel of [parsed.srgb.r, parsed.srgb.g, parsed.srgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    const mapped = parseCssColor(srgbToHex(parsed.srgb))!;
    // Chroma reduction keeps lightness within a JND-sized tolerance and the
    // hue within a few degrees, which per-channel clipping does not.
    expect(Math.abs(mapped.oklch.l - parsed.oklch.l)).toBeLessThan(0.03);
    const hueShift = Math.abs(((mapped.oklch.h - parsed.oklch.h + 540) % 360) - 180);
    expect(hueShift).toBeLessThan(4);
  });

  it('sends lightness at the ends of the range to white and black', () => {
    expect(gamutMapToSrgb({ l: 1.2, c: 0.3, h: 30 })).toEqual([1, 1, 1]);
    expect(gamutMapToSrgb({ l: 0, c: 0.3, h: 30 })).toEqual([0, 0, 0]);
  });

  it('is exact for a colour already inside sRGB', () => {
    expect(bytes('oklch(0.62 0.19 259.8)')).toEqual([57, 129, 246]);
  });
});

describe('compositeOver', () => {
  it('blends on encoded values, as browsers paint', () => {
    const half = parseCssColor('rgba(0, 0, 0, 0.5)')!;
    const result = compositeOver(half, { r: 1, g: 1, b: 1 });
    expect(srgbToHex(result)).toBe('#808080');
  });

  it('is the foreground when opaque and the backdrop when invisible', () => {
    const backdrop = { r: 0.2, g: 0.4, b: 0.6 };
    expect(compositeOver(parseCssColor('#ff0000')!, backdrop)).toEqual({ r: 1, g: 0, b: 0 });
    expect(compositeOver(parseCssColor('transparent')!, backdrop)).toEqual(backdrop);
  });
});
