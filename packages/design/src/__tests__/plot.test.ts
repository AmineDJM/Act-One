import { describe, it, expect } from 'vitest';
import { fillDailyGaps, plot } from '../plot.ts';

const day = (d: string, value: number) => ({ day: d, value });

describe('plot', () => {
  it('puts the largest value at the top and zero on the baseline', () => {
    const result = plot({
      data: [day('a', 0), day('b', 10)],
      value: (d) => d.value,
      label: (d) => d.day,
      width: 100,
      height: 50,
    });

    expect(result.points[0]!.y).toBe(50);
    expect(result.points[1]!.y).toBe(0);
    expect(result.max).toBe(10);
  });

  it('draws an empty series as empty rather than as full height', () => {
    // Dividing by a zero maximum would either crash or, worse, silently make a
    // week with no spend look like the busiest one on record.
    const result = plot({
      data: [day('a', 0), day('b', 0)],
      value: (d) => d.value,
      label: (d) => d.day,
      width: 100,
      height: 50,
    });

    expect(result.max).toBe(1);
    expect(result.bars.every((bar) => bar.barHeight === 0)).toBe(true);
  });

  it('keeps the last bar inside the frame', () => {
    const result = plot({
      data: [day('a', 1), day('b', 2), day('c', 3)],
      value: (d) => d.value,
      label: (d) => d.day,
      width: 90,
      height: 30,
    });

    const last = result.bars[result.bars.length - 1]!;
    expect(last.x + last.width).toBeLessThanOrEqual(90);
  });

  it('respects padding on both axes', () => {
    const result = plot({
      data: [day('a', 5)],
      value: (d) => d.value,
      label: (d) => d.day,
      width: 100,
      height: 60,
      padding: { top: 5, right: 5, bottom: 10, left: 5 },
    });

    expect(result.points[0]!.y).toBe(5);
    expect(result.bars[0]!.x).toBe(5);
    expect(result.bars[0]!.width).toBe(90);
  });

  it('closes the area path back to the baseline', () => {
    const result = plot({
      data: [day('a', 1), day('b', 2)],
      value: (d) => d.value,
      label: (d) => d.day,
      width: 100,
      height: 50,
    });

    expect(result.area.startsWith('M')).toBe(true);
    expect(result.area.endsWith('Z')).toBe(true);
  });

  it('handles an empty series without throwing', () => {
    const result = plot({ data: [], value: () => 0, label: () => '', width: 100, height: 50 });
    expect(result.points).toEqual([]);
    expect(result.area).toBe('');
  });
});

describe('fillDailyGaps', () => {
  it('inserts the days nothing happened', () => {
    // Without this a straight line is drawn across an outage, and a quiet week
    // reads as a busy one.
    const filled = fillDailyGaps([day('2026-01-01', 5), day('2026-01-04', 2)], {
      day: (row) => row.day,
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-04T00:00:00Z'),
      empty: (d) => day(d, 0),
    });

    expect(filled.map((row) => row.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    expect(filled.map((row) => row.value)).toEqual([5, 0, 0, 2]);
  });

  it('tolerates full timestamps in the data', () => {
    const filled = fillDailyGaps([{ day: '2026-03-02T11:22:33.000Z', value: 7 }], {
      day: (row) => row.day,
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-03-02T00:00:00Z'),
      empty: (d) => ({ day: d, value: 0 }),
    });

    expect(filled.map((row) => row.value)).toEqual([0, 7]);
  });
});
