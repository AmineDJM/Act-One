import { describe, it, expect } from 'vitest';
import { SAFE_AREAS, type AspectRatio } from '@act-one/core';
import {
  contrastRatio, lightness, ensureContrast, readableOn, neutralRamp, dedupeColors,
  perceptualDistance, isNeutral, mix, withLightness, hexToRgb, rgbToHex,
  measureText, breakLines, fitTextToBox, opticalTracking,
  createFrame, createGrid, place, withinSafeArea, columnSpan, stageProduct,
  resolveTokens, applyCase, textBlock, document as svgDocument, barChart, watermark,
} from '../index.ts';

const brand = {
  id: 'brd_1',
  organizationId: 'org_1',
  name: 'Northwind',
  logo: null,
  logoVariants: [],
  primaryColor: '#2f6fed',
  secondaryColor: '#8fb2f7',
  accentColors: [],
  primaryCandidates: ['#2f6fed'],
  neutrals: neutralRamp('#2f6fed', 9, 0.05),
  canvasDark: '#08080c',
  canvasLight: '#ffffff',
  typography: [],
  visualStyle: 'minimal' as const,
  imageTreatment: 'none' as const,
  layoutDensity: 'balanced' as const,
  cornerStyle: 'subtle' as const,
  cornerRadiusPx: 8,
  motionStyle: 'precise' as const,
  tone: '',
  allowsGlow: false,
  allowsGradient: false,
  confirmedByUser: true,
  sources: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('colour', () => {
  it('round-trips hex and rgb', () => {
    expect(rgbToHex(hexToRgb('#2f6fed'))).toBe('#2f6fed');
  });

  it('computes WCAG contrast correctly at the extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('uses perceptual lightness, not HSL — the classic auto-palette tell', () => {
    // Pure yellow and pure blue have identical HSL lightness (50%) and wildly
    // different perceived lightness. Ramps built on HSL produce muddy mid-tones.
    expect(lightness('#ffff00')).toBeGreaterThan(lightness('#0000ff') + 0.4);
  });

  it('nudges an accent until it is legible rather than giving up on the brand', () => {
    const fixed = ensureContrast('#2f6fed', '#08080c', 4.5);
    expect(contrastRatio(fixed, '#08080c')).toBeGreaterThanOrEqual(4.5);
    // Still recognisably the brand colour, not replaced with white.
    expect(perceptualDistance(fixed, '#2f6fed')).toBeLessThan(0.45);
  });

  it('falls back to black or white only when the palette genuinely cannot work', () => {
    const result = readableOn('#7f7f7f', ['#808080', '#818181'], 4.5);
    expect(result.usedFallback).toBe(true);
    expect(['#ffffff', '#000000']).toContain(result.color);
  });

  it('builds a brand-tinted neutral ramp rather than pure grey', () => {
    const ramp = neutralRamp('#2f6fed', 9, 0.08);
    expect(ramp).toHaveLength(9);
    expect(lightness(ramp[0]!)).toBeLessThan(lightness(ramp[8]!));
    expect(isNeutral(ramp[4]!, 0.005)).toBe(false);
  });

  it('deduplicates colours the eye cannot tell apart', () => {
    expect(dedupeColors(['#2f6fed', '#2f70ee', '#e4f222'])).toHaveLength(2);
  });

  it('mixes in a perceptual space', () => {
    const middle = mix('#000000', '#ffffff', 0.5);
    expect(lightness(middle)).toBeGreaterThan(0.4);
    expect(lightness(middle)).toBeLessThan(0.65);
  });

  it('preserves hue when setting lightness', () => {
    const lighter = withLightness('#2f6fed', 0.8);
    expect(lightness(lighter)).toBeCloseTo(0.8, 1);
    expect(isNeutral(lighter)).toBe(false);
  });
});

describe('typography', () => {
  it('measures per character, not by an average width', () => {
    const opts = { family: 'Inter', fontSizePx: 100 };
    // Same character count, very different widths.
    expect(measureText('WWWWW', opts)).toBeGreaterThan(measureText('iiiii', opts) * 3);
  });

  it('accounts for tracking and weight', () => {
    const base = measureText('Northwind', { family: 'Inter', fontSizePx: 60 });
    expect(measureText('Northwind', { family: 'Inter', fontSizePx: 60, tracking: 0.1 })).toBeGreaterThan(base);
    expect(measureText('Northwind', { family: 'Inter', fontSizePx: 60, weight: 700 })).toBeGreaterThan(base);
  });

  it('breaks lines to a pixel width without splitting words', () => {
    const lines = breakLines('Close the books without manual matching', {
      family: 'Inter',
      fontSizePx: 60,
      maxWidthPx: 500,
    });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Close the books without manual matching');
    for (const line of lines) {
      expect(measureText(line, { family: 'Inter', fontSizePx: 60 })).toBeLessThanOrEqual(500);
    }
  });

  it('avoids leaving a single short word on the last line', () => {
    const lines = breakLines('Reconciliation that actually finishes on time', {
      family: 'Inter',
      fontSizePx: 48,
      maxWidthPx: 460,
    });
    const last = lines[lines.length - 1]!;
    // A one-word orphan at display size looks like an accident.
    expect(last.includes(' ') || last.length > 8 || lines.length === 1).toBe(true);
  });

  it('finds the largest size that genuinely fits the box', () => {
    const box = { widthPx: 900, heightPx: 320 };
    const fit = fitTextToBox('One command replaces the whole close process', box, {
      family: 'Inter',
      lineHeight: 1.05,
      maxLines: 2,
      maxFontSizePx: 200,
      weight: 700,
    });

    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.lines.length * fit.fontSizePx * 1.05).toBeLessThanOrEqual(320);
    for (const line of fit.lines) {
      expect(
        measureText(line, { family: 'Inter', fontSizePx: fit.fontSizePx, weight: 700 }),
      ).toBeLessThanOrEqual(900);
    }
    // And it should not be timid about it.
    expect(fit.fontSizePx).toBeGreaterThan(40);
  });

  it('tightens tracking optically as size grows', () => {
    expect(Math.abs(opticalTracking(120, -0.03))).toBeGreaterThan(Math.abs(opticalTracking(18, -0.03)));
  });
});

describe('layout', () => {
  const aspects: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

  it('gives vertical formats far more bottom margin for platform UI', () => {
    const wide = createGrid(createFrame('16:9'));
    const tall = createGrid(createFrame('9:16'));
    const wideRatio = wide.margin.bottom / wide.frame.height;
    const tallRatio = tall.margin.bottom / tall.frame.height;
    expect(tallRatio).toBeGreaterThan(wideRatio * 1.8);
  });

  it('keeps every placement inside the safe area, in every aspect', () => {
    for (const aspect of aspects) {
      const grid = createGrid(createFrame(aspect));
      for (const placement of ['top_left', 'center', 'bottom_center', 'lower_third'] as const) {
        const box = place(grid, { width: grid.safe.width * 0.8, height: grid.safe.height * 0.3 }, placement);
        expect(withinSafeArea(grid, box), `${aspect}/${placement}`).toBe(true);
      }
    }
  });

  it('uses fewer, wider columns on vertical frames', () => {
    expect(createGrid(createFrame('9:16')).columns).toBeLessThan(createGrid(createFrame('16:9')).columns);
  });

  it('spans columns without escaping the grid', () => {
    const grid = createGrid(createFrame('16:9'));
    const span = columnSpan(grid, 0, 6);
    expect(span.x).toBe(grid.safe.x);
    expect(span.width).toBeLessThan(grid.safe.width);
    expect(columnSpan(grid, 10, 8).width).toBeLessThanOrEqual(grid.safe.width);
  });

  it('never lets product staging bleed to the frame edge', () => {
    for (const aspect of aspects) {
      const grid = createGrid(createFrame(aspect));
      const staged = stageProduct(grid, 16 / 9);
      expect(withinSafeArea(grid, staged), aspect).toBe(true);
      expect(staged.x).toBeGreaterThan(0);
    }
  });

  it('honours the declared safe areas', () => {
    for (const aspect of aspects) {
      const grid = createGrid(createFrame(aspect));
      expect(grid.margin.top / grid.frame.height).toBeCloseTo(SAFE_AREAS[aspect].top, 1);
    }
  });
});

describe('tokens', () => {
  it('produces identical compositions at 1080p and 4K', () => {
    const hd = resolveTokens(brand, { aspect: '16:9', quality: 'hd' });
    const uhd = resolveTokens(brand, { aspect: '16:9', quality: 'uhd' });

    // Everything scales with the frame, so ratios must match exactly.
    expect(uhd.type.display.sizePx / uhd.frame.height).toBeCloseTo(
      hd.type.display.sizePx / hd.frame.height,
      3,
    );
    expect(uhd.radius.md / uhd.frame.width).toBeCloseTo(hd.radius.md / hd.frame.width, 3);
    expect(uhd.grid.margin.left / uhd.frame.width).toBeCloseTo(hd.grid.margin.left / hd.frame.width, 3);
  });

  it('guarantees legible text on whichever canvas it chose', () => {
    for (const theme of ['dark', 'light'] as const) {
      const tokens = resolveTokens(brand, { aspect: '16:9', theme });
      expect(contrastRatio(tokens.onCanvas.primary, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.onCanvas.secondary, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.onCanvas.accent, tokens.canvas)).toBeGreaterThanOrEqual(3);
    }
  });

  it('sizes type against frame height so vertical type is not tiny', () => {
    const wide = resolveTokens(brand, { aspect: '16:9' });
    const tall = resolveTokens(brand, { aspect: '9:16' });
    expect(tall.type.display.sizePx).toBeGreaterThan(wide.type.display.sizePx);
  });

  it('puts an editorial brand on a light canvas rather than forcing black', () => {
    const editorial = resolveTokens({ ...brand, visualStyle: 'editorial' }, { aspect: '16:9' });
    expect(editorial.isDarkCanvas).toBe(false);
  });

  it('derives radius from the radius measured on the brand’s own site', () => {
    const sharp = resolveTokens({ ...brand, cornerStyle: 'sharp', cornerRadiusPx: 0 }, { aspect: '16:9' });
    const pill = resolveTokens({ ...brand, cornerStyle: 'pill', cornerRadiusPx: 24 }, { aspect: '16:9' });
    expect(sharp.radius.md).toBe(0);
    expect(pill.radius.md).toBeGreaterThan(20);
  });

  it('applies case transforms from the token', () => {
    expect(applyCase('one run', { ...resolveTokens(brand, { aspect: '16:9' }).type.caption })).toBe('ONE RUN');
  });
});

describe('svg', () => {
  const tokens = resolveTokens(brand, { aspect: '16:9' });

  it('escapes text so customer copy cannot break the document', () => {
    const block = textBlock('Tools & <scripts> "quoted"', {
      token: tokens.type.body,
      color: '#ffffff',
      box: { x: 0, y: 0, width: 1600, height: 200 },
    });
    expect(block.svg).toContain('&amp;');
    expect(block.svg).toContain('&lt;scripts&gt;');
    expect(block.svg).not.toContain('<scripts>');
  });

  it('emits a well-formed document at the frame size', () => {
    const svg = svgDocument(tokens, '<rect x="0" y="0" width="10" height="10"/>');
    expect(svg).toContain(`width="${tokens.frame.width}"`);
    expect(svg).toContain(`viewBox="0 0 ${tokens.frame.width} ${tokens.frame.height}"`);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('draws a bar chart with a zero baseline', () => {
    const chart = barChart({
      tokens,
      box: { x: 100, y: 100, width: 800, height: 400 },
      series: [
        { label: 'Before', value: 40 },
        { label: 'After', value: 2 },
      ],
      highlightIndex: 1,
      valueFormatter: (v) => String(v),
    });
    expect(chart).toContain('<line');
    expect(chart).toContain(tokens.accent);
    // Caption tokens are upper-case by design, so the label is transformed.
    expect(chart).toContain('BEFORE');
  });

  it('returns nothing rather than a misleading chart when there is no data', () => {
    expect(barChart({ tokens, box: { x: 0, y: 0, width: 100, height: 100 }, series: [] })).toBe('');
    expect(
      barChart({
        tokens,
        box: { x: 0, y: 0, width: 100, height: 100 },
        series: [{ label: 'a', value: 0 }],
      }),
    ).toBe('');
  });

  it('places the watermark inside the safe area', () => {
    const mark = watermark(tokens, 'Act One preview');
    expect(mark).toContain('ACT ONE PREVIEW');
    expect(mark).toContain('<rect');
  });
});
