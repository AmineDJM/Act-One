import { applyCase, type DesignTokens, type TypeToken } from './tokens.ts';
import { breakLines, measureText, metricsFor } from './typography.ts';
import type { Box } from './layout.ts';

/**
 * Deterministic SVG output.
 *
 * Used for anything that must be pixel-exact and text-bearing: statistic
 * plates, charts, watermarks, poster frames and the lockups a rasteriser turns
 * into stills. Building SVG by hand rather than through a charting library
 * keeps typography under the same token system as the rest of the film — a
 * chart whose axis labels are set in a different family than the headline is
 * the sort of detail that reads as "assembled" rather than "designed".
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type TextBlockOptions = {
  token: TypeToken;
  color: string;
  box: Box;
  align?: 'left' | 'center' | 'right';
  /** Vertical anchor within the box. */
  valign?: 'top' | 'center';
  maxLines?: number;
};

export function textBlock(text: string, options: TextBlockOptions): { svg: string; lines: string[]; height: number } {
  const { token, box } = options;
  const cased = applyCase(text, token);
  const lines = breakLines(cased, {
    family: token.family,
    fontSizePx: token.sizePx,
    tracking: token.tracking,
    weight: token.weight,
    maxWidthPx: box.width,
    maxLines: options.maxLines,
  });

  const lineHeightPx = token.sizePx * token.lineHeight;
  const blockHeight = lines.length * lineHeightPx;
  const metrics = metricsFor(token.family);

  const startY =
    options.valign === 'center'
      ? box.y + (box.height - blockHeight) / 2 + metrics.capHeight * token.sizePx
      : box.y + metrics.capHeight * token.sizePx;

  const anchor = options.align === 'center' ? 'middle' : options.align === 'right' ? 'end' : 'start';
  const anchorX =
    options.align === 'center' ? box.x + box.width / 2 : options.align === 'right' ? box.x + box.width : box.x;

  const svg = lines
    .map(
      (line, index) =>
        `<text x="${round(anchorX)}" y="${round(startY + index * lineHeightPx)}" ` +
        `fill="${options.color}" font-family="${escapeXml(token.family)}, sans-serif" ` +
        `font-size="${round(token.sizePx)}" font-weight="${token.weight}" ` +
        `letter-spacing="${round(token.tracking * token.sizePx, 3)}" ` +
        `text-anchor="${anchor}" xml:space="preserve">${escapeXml(line)}</text>`,
    )
    .join('\n');

  return { svg, lines, height: blockHeight };
}

export function roundedRect(box: Box, radius: number, fill: string, extra = ''): string {
  return (
    `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" ` +
    `height="${round(box.height)}" rx="${round(radius)}" fill="${fill}" ${extra}/>`
  );
}

export function document(tokens: DesignTokens, body: string, background?: string): string {
  const { frame } = tokens;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" ` +
    `viewBox="0 0 ${frame.width} ${frame.height}">` +
    `<rect width="${frame.width}" height="${frame.height}" fill="${background ?? tokens.canvas}"/>` +
    body +
    `</svg>`
  );
}

export type ChartSeries = { label: string; value: number };

export type ChartOptions = {
  tokens: DesignTokens;
  box: Box;
  series: ChartSeries[];
  /** Formatted by the caller: we never invent units. */
  valueFormatter?: (value: number) => string;
  highlightIndex?: number;
};

/**
 * Bar chart.
 *
 * Deliberately plain. The axis starts at zero, always — an axis that starts
 * elsewhere exaggerates a trend, and a launch film that flatters its own data
 * is the kind of thing a customer's legal team finds later.
 */
export function barChart(options: ChartOptions): string {
  const { tokens, box, series } = options;
  if (series.length === 0) return '';

  const max = Math.max(...series.map((s) => s.value), 0);
  if (max <= 0) return '';

  const labelToken = tokens.type.caption;
  const labelHeight = labelToken.sizePx * 2.2;
  const plotHeight = box.height - labelHeight;
  const gap = box.width * 0.04;
  const barWidth = (box.width - gap * (series.length - 1)) / series.length;

  const parts: string[] = [];

  // Baseline. Its presence is what tells the eye the axis starts at zero.
  parts.push(
    `<line x1="${round(box.x)}" y1="${round(box.y + plotHeight)}" x2="${round(box.x + box.width)}" ` +
      `y2="${round(box.y + plotHeight)}" stroke="${tokens.line}" stroke-width="1"/>`,
  );

  series.forEach((entry, index) => {
    const height = (entry.value / max) * plotHeight * 0.92;
    const x = box.x + index * (barWidth + gap);
    const y = box.y + plotHeight - height;
    const isHighlight = options.highlightIndex === index;

    parts.push(
      roundedRect(
        { x, y, width: barWidth, height },
        Math.min(tokens.radius.sm, barWidth / 2),
        isHighlight ? tokens.accent : tokens.surfaceRaised,
      ),
    );

    const label = textBlock(entry.label, {
      token: labelToken,
      color: isHighlight ? tokens.onCanvas.primary : tokens.onCanvas.muted,
      box: { x, y: box.y + plotHeight + labelToken.sizePx * 0.6, width: barWidth, height: labelHeight },
      align: 'center',
      maxLines: 1,
    });
    parts.push(label.svg);

    if (options.valueFormatter) {
      const value = textBlock(options.valueFormatter(entry.value), {
        token: { ...tokens.type.body, weight: 600 },
        color: isHighlight ? tokens.accent : tokens.onCanvas.secondary,
        box: { x, y: y - tokens.type.body.sizePx * 1.6, width: barWidth, height: tokens.type.body.sizePx * 1.4 },
        align: 'center',
        maxLines: 1,
      });
      parts.push(value.svg);
    }
  });

  return parts.join('\n');
}

/** Single large figure with a caption — the statistic scene's core plate. */
export function metricPlate(options: {
  tokens: DesignTokens;
  box: Box;
  value: string;
  caption: string;
  align?: 'left' | 'center';
}): string {
  const { tokens, box } = options;
  const align = options.align ?? 'left';

  const figure = textBlock(options.value, {
    token: { ...tokens.type.display, weight: 700 },
    color: tokens.onCanvas.primary,
    box: { ...box, height: tokens.type.display.sizePx * 1.2 },
    align,
    maxLines: 1,
  });

  const caption = textBlock(options.caption, {
    token: tokens.type.caption,
    color: tokens.onCanvas.muted,
    box: {
      ...box,
      y: box.y + figure.height + tokens.space(1.5),
      height: tokens.type.caption.sizePx * 3,
    },
    align,
    maxLines: 2,
  });

  return `${figure.svg}\n${caption.svg}`;
}

/**
 * Watermark for free-tier previews.
 *
 * Legible enough to deter use, light enough that the customer can still judge
 * the film — a preview so defaced that it cannot be evaluated does not convert
 * anybody.
 */
export function watermark(tokens: DesignTokens, label: string): string {
  const token = { ...tokens.type.caption, sizePx: Math.round(tokens.frame.height * 0.018) };
  const width = measureText(label.toUpperCase(), {
    family: token.family,
    fontSizePx: token.sizePx,
    tracking: token.tracking,
    weight: token.weight,
  });
  const padding = tokens.space(1.2);
  const box: Box = {
    x: tokens.frame.width - tokens.grid.margin.right - width - padding * 2,
    y: tokens.frame.height - tokens.grid.margin.bottom - token.sizePx * 2.4,
    width: width + padding * 2,
    height: token.sizePx * 2.4,
  };

  const chip = roundedRect(box, tokens.radius.sm, tokens.surfaceRaised, 'fill-opacity="0.72"');
  const text = textBlock(label, {
    token,
    color: tokens.onCanvas.secondary,
    box: { ...box, x: box.x + padding, width: width },
    valign: 'center',
    maxLines: 1,
  });
  return `${chip}\n${text.svg}`;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
