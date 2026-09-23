import type { RationalTime, TimeRange } from './schema/primitives.ts';

/**
 * Rational time.
 *
 * A film's clock is not a float. Every frame of an MP4 carries a presentation
 * timestamp that is an integer count of its stream's time base, and every
 * audio sample sits at an integer position at its sample rate. Seconds as a
 * double would quietly move a 60 fps frame boundary by a few nanoseconds, and
 * two such values compared across a cut would disagree about which frame an
 * event belongs to. So times are kept as they arrive — ticks over a
 * timescale — and compared exactly, with BigInt cross-multiplication.
 *
 * Seconds exist only for display and for arithmetic whose result is itself
 * marked as estimated.
 */

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

export function rt(ticks: bigint | number | string, timescale: number): RationalTime {
  if (!Number.isInteger(timescale) || timescale <= 0) {
    throw new RangeError(`A timescale is a positive integer, not ${timescale}.`);
  }
  const value = toBigInt(ticks);
  if (value < INT64_MIN || value > INT64_MAX) throw new RangeError(`Ticks ${value} do not fit in int64.`);
  return { ticks: value.toString(), timescale };
}

export function ticksOf(time: RationalTime): bigint {
  return BigInt(time.ticks);
}

/** Negative, zero or positive, exactly: a·d − c·b without leaving the integers. */
export function compareTime(a: RationalTime, b: RationalTime): number {
  const left = ticksOf(a) * BigInt(b.timescale);
  const right = ticksOf(b) * BigInt(a.timescale);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sameTime(a: RationalTime, b: RationalTime): boolean {
  return compareTime(a, b) === 0;
}

/** The sum on the finer of the two clocks; exact when one timescale divides the other. */
export function addTime(a: RationalTime, b: RationalTime): RationalTime {
  const scale = lcm(a.timescale, b.timescale);
  return rt(ticksOf(a) * BigInt(scale / a.timescale) + ticksOf(b) * BigInt(scale / b.timescale), scale);
}

export function subtractTime(a: RationalTime, b: RationalTime): RationalTime {
  return addTime(a, { ticks: (-ticksOf(b)).toString(), timescale: b.timescale });
}

/**
 * Onto another clock, rounded to the nearest tick of it.
 *
 * Rounding is the point: moving a time onto a coarser clock loses precision,
 * and the caller is saying so by choosing the clock.
 */
export function rescale(time: RationalTime, timescale: number): RationalTime {
  const numerator = ticksOf(time) * BigInt(timescale);
  const denominator = BigInt(time.timescale);
  return rt(roundDivide(numerator, denominator), timescale);
}

/** Exact when possible, and only then; null when the time falls between ticks of the target clock. */
export function rescaleExact(time: RationalTime, timescale: number): RationalTime | null {
  const numerator = ticksOf(time) * BigInt(timescale);
  const denominator = BigInt(time.timescale);
  return numerator % denominator === 0n ? rt(numerator / denominator, timescale) : null;
}

/** For display and for estimates. Never stored as the time itself. */
export function toSeconds(time: RationalTime): number {
  return Number(ticksOf(time)) / time.timescale;
}

/**
 * Seconds from a model or a report, onto a clock, with the precision it
 * actually had. A value given to the millisecond is stored on a millisecond
 * clock, not dressed as a sample position.
 */
export function fromSeconds(seconds: number, timescale: number): RationalTime {
  if (!Number.isFinite(seconds)) throw new RangeError(`Not a time: ${seconds}`);
  return rt(Math.round(seconds * timescale), timescale);
}

export function formatTime(time: RationalTime, digits = 3): string {
  return `${toSeconds(time).toFixed(digits)}s`;
}

export function durationOf(range: TimeRange): RationalTime {
  return subtractTime(range.end, range.start);
}

export function rangeContains(range: TimeRange, time: RationalTime): boolean {
  return compareTime(time, range.start) >= 0 && compareTime(time, range.end) < 0;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return compareTime(a.start, b.end) < 0 && compareTime(b.start, a.end) < 0;
}

export function minTime(a: RationalTime, b: RationalTime): RationalTime {
  return compareTime(a, b) <= 0 ? a : b;
}

export function maxTime(a: RationalTime, b: RationalTime): RationalTime {
  return compareTime(a, b) >= 0 ? a : b;
}

export function isInt64String(value: string): boolean {
  if (!/^-?(0|[1-9][0-9]{0,18})$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= INT64_MIN && parsed <= INT64_MAX;
}

function toBigInt(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Ticks must be an integer, not ${value}.`);
    return BigInt(value);
  }
  if (!/^-?[0-9]+$/.test(value)) throw new RangeError(`Ticks must be an integer, not "${value}".`);
  return BigInt(value);
}

/** Round half away from zero, in the integers. */
function roundDivide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n + d / 2n) / d;
  return negative ? -quotient : quotient;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

function lcm(a: number, b: number): number {
  const result = (a / gcd(a, b)) * b;
  if (!Number.isSafeInteger(result) || result > 2 ** 31 - 1) {
    throw new RangeError(`No common clock for timescales ${a} and ${b} within 32 bits.`);
  }
  return result;
}
