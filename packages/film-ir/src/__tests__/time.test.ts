import { describe, expect, it } from 'vitest';
import {
  addTime,
  compareTime,
  durationOf,
  fromSeconds,
  isInt64String,
  maxTime,
  minTime,
  rangeContains,
  rangesOverlap,
  rescale,
  rescaleExact,
  rt,
  sameTime,
  subtractTime,
  toSeconds,
} from '../time.ts';

/**
 * A film's clock is integers. These are the properties the compiler leans on:
 * exact comparison across clocks, exact sums, rounding only when asked for.
 */
describe('rational time', () => {
  it('compares times on different clocks exactly', () => {
    // Frame 1 of a 25 fps stream on a 1/12800 time base, and 40 ms.
    expect(sameTime(rt(512, 12800), rt(40, 1000))).toBe(true);
    // One tick apart on a 90 kHz clock is still apart.
    expect(compareTime(rt(3001, 90000), rt(3000, 90000))).toBe(1);
    // NTSC: frame 1001 at 30000/1001 is exactly 33.3667 s, not near it.
    expect(sameTime(rt(1001 * 1001, 30000), rt(1002001, 30000))).toBe(true);
    expect(compareTime(rt(1, 3), rt(333333, 1000000))).toBe(1);
  });

  it('adds and subtracts on a common clock without rounding', () => {
    const sum = addTime(rt(1, 25), rt(1, 48000));
    expect(sum).toEqual({ ticks: '1921', timescale: 48000 });
    expect(sameTime(subtractTime(sum, rt(1, 48000)), rt(1, 25))).toBe(true);
    expect(durationOf({ start: rt(1024, 12800), end: rt(3, 1) })).toEqual({ ticks: '37376', timescale: 12800 });
  });

  it('keeps ticks beyond the range of a double', () => {
    const late = rt('9007199254740993', 1);
    expect(compareTime(late, rt('9007199254740992', 1))).toBe(1);
    expect(isInt64String('9223372036854775807')).toBe(true);
    expect(isInt64String('9223372036854775808')).toBe(false);
    expect(() => rt('9223372036854775808', 1)).toThrow(RangeError);
  });

  it('refuses what is not a time', () => {
    expect(() => rt(1.5, 1000)).toThrow(/integer/);
    expect(() => rt('12a', 1000)).toThrow(/integer/);
    expect(() => rt(1, 0)).toThrow(/positive integer/);
    expect(() => rt(1, 29.97)).toThrow(/positive integer/);
    expect(() => fromSeconds(Number.NaN, 1000)).toThrow(/Not a time/);
  });

  it('refuses to invent a clock finer than 32 bits', () => {
    expect(() => addTime(rt(1, 2147483647), rt(1, 2147483646))).toThrow(/No common clock/);
  });

  it('rescales exactly only when the time falls on a tick', () => {
    expect(rescaleExact(rt(512, 12800), 25)).toEqual({ ticks: '1', timescale: 25 });
    expect(rescaleExact(rt(1, 48000), 1000)).toBeNull();
    // Rounding is explicit, and half away from zero.
    expect(rescale(rt(1, 2000), 1000)).toEqual({ ticks: '1', timescale: 1000 });
    expect(rescale(rt(-1, 2000), 1000)).toEqual({ ticks: '-1', timescale: 1000 });
  });

  it('stores seconds from a report at the precision they were given', () => {
    expect(fromSeconds(1.2345, 1000)).toEqual({ ticks: '1235', timescale: 1000 });
    expect(toSeconds(rt(37376, 12800))).toBeCloseTo(2.92, 10);
  });

  it('answers containment and overlap with half-open ranges', () => {
    const shot = { start: rt(0, 25), end: rt(40, 25) };
    expect(rangeContains(shot, rt(39, 25))).toBe(true);
    expect(rangeContains(shot, rt(40, 25))).toBe(false);
    expect(rangesOverlap(shot, { start: rt(40, 25), end: rt(80, 25) })).toBe(false);
    expect(rangesOverlap(shot, { start: rt(1599, 1000), end: rt(2, 1) })).toBe(true);
    expect(minTime(rt(1, 25), rt(39, 1000))).toEqual(rt(39, 1000));
    expect(maxTime(rt(1, 25), rt(41, 1000))).toEqual(rt(41, 1000));
  });
});
