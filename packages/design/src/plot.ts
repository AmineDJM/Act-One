/**
 * Chart geometry, without any rendering.
 *
 * Returns coordinates and path data so the caller decides the markup: the
 * console draws these as React SVG so they inherit its colour tokens and adapt
 * to the viewport, while the film renderer writes SVG strings. Sharing the
 * maths rather than the markup keeps both honest about the one part that is
 * easy to get subtly wrong — the scale.
 */
export type Point = { x: number; y: number };

export type PlotPoint<T> = Point & { datum: T; value: number; label: string };

export type PlotOptions<T> = {
  data: readonly T[];
  value: (datum: T) => number;
  label: (datum: T) => string;
  width: number;
  height: number;
  /** Room for the baseline and for a stroke that would otherwise be clipped. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Forces the top of the scale; otherwise the largest value sets it. */
  max?: number;
};

export type Plot<T> = {
  points: PlotPoint<T>[];
  /** Polyline through every point, for a line or the top of an area. */
  line: string;
  /** The line closed down to the baseline, for a filled area. */
  area: string;
  bars: (PlotPoint<T> & { width: number; barHeight: number })[];
  max: number;
  width: number;
  height: number;
};

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

export function plot<T>(options: PlotOptions<T>): Plot<T> {
  const padding = { ...NO_PADDING, ...options.padding };
  const inner = {
    width: Math.max(1, options.width - padding.left - padding.right),
    height: Math.max(1, options.height - padding.top - padding.bottom),
  };

  const values = options.data.map(options.value);
  /*
   * A flat series of zeroes must not divide by zero, and must not draw a full
   * height bar either: an empty week should look empty, not maxed out.
   */
  const max = Math.max(options.max ?? 0, ...values, 0) || 1;
  const baseline = padding.top + inner.height;

  const step = options.data.length > 1 ? inner.width / (options.data.length - 1) : 0;
  const slot = options.data.length > 0 ? inner.width / options.data.length : inner.width;

  const points: PlotPoint<T>[] = options.data.map((datum, index) => {
    const value = values[index]!;
    return {
      datum,
      value,
      label: options.label(datum),
      x: padding.left + (options.data.length > 1 ? step * index : inner.width / 2),
      y: baseline - (value / max) * inner.height,
    };
  });

  const bars = options.data.map((datum, index) => {
    const value = values[index]!;
    const barHeight = (value / max) * inner.height;
    return {
      datum,
      value,
      label: options.label(datum),
      // Bars occupy their own slot rather than sitting on the line's points,
      // so the last bar does not hang off the right edge.
      x: padding.left + slot * index,
      y: baseline - barHeight,
      width: slot,
      barHeight,
    };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)},${round(point.y)}`).join(' ');
  const area =
    points.length > 0
      ? `${line} L${round(points[points.length - 1]!.x)},${round(baseline)} L${round(points[0]!.x)},${round(baseline)} Z`
      : '';

  return { points, line, area, bars, max, width: options.width, height: options.height };
}

/**
 * Fills in the days with no rows.
 *
 * A cost query returns only days something happened. Plotting that directly
 * draws a straight line across an outage and makes a quiet week look like a
 * busy one, so the gaps are made explicit before anything is scaled.
 */
export function fillDailyGaps<T>(
  rows: readonly T[],
  options: { day: (row: T) => string; from: Date; to: Date; empty: (day: string) => T },
): T[] {
  const byDay = new Map(rows.map((row) => [options.day(row).slice(0, 10), row]));
  const filled: T[] = [];

  const cursor = new Date(Date.UTC(options.from.getUTCFullYear(), options.from.getUTCMonth(), options.from.getUTCDate()));
  const end = Date.UTC(options.to.getUTCFullYear(), options.to.getUTCMonth(), options.to.getUTCDate());

  while (cursor.getTime() <= end) {
    const day = cursor.toISOString().slice(0, 10);
    filled.push(byDay.get(day) ?? options.empty(day));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return filled;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
