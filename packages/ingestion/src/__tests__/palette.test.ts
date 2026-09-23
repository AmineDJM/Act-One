import { describe, expect, it } from 'vitest';
import { buildPalette } from '../palette/build-palette.ts';
import type { RawPalette } from '../probes/palette-probe.ts';
import { Palette } from '../schema.ts';

/** A page as the probe reports it: white canvas, near-black ink, an oklch brand on its buttons. */
function page(overrides: Partial<RawPalette> = {}): RawPalette {
  return {
    uses: [
      { css: 'rgb(255, 255, 255)', usage: 'background', weight: 1_400_000, elements: 3, interactive: false },
      { css: 'rgb(244, 244, 246)', usage: 'background', weight: 180_000, elements: 6, interactive: false },
      { css: 'oklch(0.62 0.19 259.8)', usage: 'background', weight: 9_000, elements: 3, interactive: true },
      { css: 'rgb(17, 17, 19)', usage: 'text', weight: 800_000, elements: 40, interactive: false },
      { css: 'rgb(107, 114, 128)', usage: 'text', weight: 220_000, elements: 25, interactive: false },
      { css: 'rgb(255, 255, 255)', usage: 'text', weight: 12_000, elements: 3, interactive: true },
      { css: 'oklch(0.62 0.19 259.8)', usage: 'text', weight: 30_000, elements: 8, interactive: true },
      { css: 'rgba(0, 0, 0, 0.08)', usage: 'border', weight: 4_000, elements: 12, interactive: false },
      { css: 'rgba(0, 0, 0, 0.25)', usage: 'shadow', weight: 900, elements: 6, interactive: false },
      { css: 'color(display-p3 1 0.3 0.1)', usage: 'gradient', weight: 50_000, elements: 1, interactive: false },
      { css: 'rgba(0, 0, 0, 0)', usage: 'background', weight: 9_999_999, elements: 50, interactive: false },
      { css: 'not-a-colour', usage: 'text', weight: 10, elements: 1, interactive: false },
    ],
    gradients: [
      { css: 'linear-gradient(90deg, color(display-p3 1 0.3 0.1) 0%, oklch(0.62 0.19 259.8) 100%)', stops: ['color(display-p3 1 0.3 0.1)', 'oklch(0.62 0.19 259.8)'], area: 50_000 },
    ],
    tokens: [
      { name: '--brand', value: 'oklch(0.62 0.19 259.8)', color: 'oklch(0.62 0.19 259.8)' },
      { name: '--color-red-500', value: 'oklch(0.637 0.237 25.331)', color: 'oklch(0.637 0.237 25.331)' },
      { name: '--radius', value: '8px', color: null },
    ],
    themeColor: 'rgb(255, 255, 255)',
    canvas: 'rgb(255, 255, 255)',
    pairs: [
      { background: 'oklch(0.62 0.19 259.8)', color: 'rgb(255, 255, 255)', area: 9_000 },
      { background: 'rgb(244, 244, 246)', color: 'rgb(17, 17, 19)', area: 7_000 },
    ],
    scanned: 900,
    truncated: false,
    ...overrides,
  };
}

describe('buildPalette', () => {
  const built = buildPalette(page())!;
  const { palette } = built;
  const color = (hex8: string | null) => palette.colors.find((entry) => entry.hex8 === hex8);

  it('produces a palette the schema accepts', () => {
    expect(() => Palette.parse(palette)).not.toThrow();
  });

  it('names the roles a designer would', () => {
    expect(palette.roles.background).toBe('#ffffffff');
    expect(palette.roles.foreground).toBe('#111113ff');
    expect(palette.roles.mutedForeground).toBe('#6b7280ff');
    expect(palette.roles.surface).toBe('#f4f4f6ff');
    expect(palette.roles.primaryForeground).toBe('#ffffffff');
    expect(palette.roles.border).toBe('#00000014');
    expect(palette.scheme).toBe('light');
  });

  it('finds the brand on its buttons, and keeps it exactly as written', () => {
    const primary = color(palette.roles.primary)!;
    expect(primary.css).toBe('oklch(0.62 0.19 259.8)');
    expect(primary.space).toBe('oklch');
    expect(primary.hex).toBe('#3981f6');
    expect(primary.interactive).toBe(true);
    expect(primary.tokens).toEqual(['--brand']);
    expect(primary.usages).toEqual(expect.arrayContaining(['background', 'text']));
  });

  it('keeps a wide-gamut colour, says it was wider than sRGB, and maps it rather than clipping', () => {
    const p3 = palette.colors.find((entry) => entry.space === 'display-p3')!;
    expect(p3.inGamut).toBe(false);
    expect(p3.css).toBe('color(display-p3 1 0.3 0.1)');
    expect(palette.roles.accent).toBe(p3.hex8);
  });

  it('weighs colours so the palette sums to one, and drops the invisible', () => {
    const total = palette.colors.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 3);
    expect(palette.colors.some((entry) => entry.alpha === 0)).toBe(false);
    expect(built.warnings.some((warning) => warning.includes('not-a-colour'))).toBe(true);
  });

  it('lists design tokens and says which ones the page actually paints', () => {
    expect(palette.tokens.find((token) => token.name === '--brand')?.usedOnPage).toBe(true);
    expect(palette.tokens.find((token) => token.name === '--color-red-500')?.usedOnPage).toBe(false);
    expect(palette.tokens.some((token) => token.name === '--radius')).toBe(false);
  });

  it('reads gradient stops in their own spaces', () => {
    expect(palette.gradients).toHaveLength(1);
    expect(palette.gradients[0]!.stops).toHaveLength(2);
  });

  it('falls back to the brand tokens when every button is grey', () => {
    const neutral = buildPalette(
      page({
        pairs: [{ background: 'rgb(17, 17, 19)', color: 'rgb(255, 255, 255)', area: 9_000 }],
        uses: page().uses.map((use) => ({ ...use, interactive: false })),
      }),
    )!.palette;
    expect(neutral.roles.primary).toBe('#3981f6ff');
  });

  it('reads a dark page as dark', () => {
    const dark = buildPalette(
      page({
        uses: [
          { css: 'rgb(9, 9, 11)', usage: 'background', weight: 2_000_000, elements: 3, interactive: false },
          { css: 'rgb(250, 250, 250)', usage: 'text', weight: 800_000, elements: 40, interactive: false },
        ],
        pairs: [],
        tokens: [],
        gradients: [],
        themeColor: null,
        canvas: 'rgb(9, 9, 11)',
      }),
    )!.palette;
    expect(dark.scheme).toBe('dark');
    expect(dark.roles.foreground).toBe('#fafafaff');
    expect(dark.roles.primary).toBeNull();
  });

  it('still answers for a page that paints nothing but its canvas', () => {
    const empty = buildPalette(page({ uses: [], pairs: [], tokens: [], gradients: [], themeColor: null }))!;
    expect(empty.palette.colors).toHaveLength(1);
    expect(empty.palette.roles.background).toBe('#ffffffff');
    expect(empty.warnings.join(' ')).toMatch(/canvas alone/);
  });
});
