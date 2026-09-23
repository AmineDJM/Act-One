import type { RationalTime } from '../schema/primitives.ts';
import { addTime, compareTime, rt, ticksOf } from '../time.ts';

/**
 * The two clocks a film is observed on.
 *
 * Video: every frame's presentation timestamp, exactly as the stream carries
 * it. A stream time base of num/den means seconds = pts·num/den, so ticks are
 * pts·num on a den clock — exact for every container, including the 1001/30000
 * kind. Audio: sample k of the decoded stream sits at the first sample's
 * timestamp plus k samples, on a clock of the sample rate.
 */
export class FrameClock {
  readonly count: number;
  readonly timescale: number;
  private readonly pts: bigint[];
  private readonly durations: (bigint | null)[];

  constructor(pts: readonly string[], durations: readonly (string | null)[], timebase: { num: number; den: number }) {
    this.count = pts.length;
    this.timescale = timebase.den;
    const num = BigInt(timebase.num);
    this.pts = pts.map((value) => BigInt(value) * num);
    this.durations = durations.map((value) => (value === null ? null : BigInt(value) * num));
  }

  /** When frame `index` is presented. */
  at(index: number): RationalTime {
    return rt(this.pts[this.clamp(index)]!, this.timescale);
  }

  /** When frame `index` stops being presented: its timestamp plus its duration, or the next frame's timestamp. */
  end(index: number): RationalTime {
    const i = this.clamp(index);
    const duration = this.durations[i];
    if (duration !== null && duration !== undefined) return rt(this.pts[i]! + duration, this.timescale);
    if (i + 1 < this.count) return rt(this.pts[i + 1]!, this.timescale);
    // The last frame with no duration: its end is not known, and its start is the honest bound.
    return this.at(i);
  }

  /** One frame's duration, as a time; the modal duration stands in only where a frame has none. */
  duration(index: number): RationalTime {
    const i = this.clamp(index);
    const own = this.durations[i];
    if (own !== null && own !== undefined) return rt(own, this.timescale);
    return rt(this.modalDuration(), this.timescale);
  }

  /** The frame on screen at `time`: the last frame presented at or before it. */
  frameAt(time: RationalTime): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (compareTime(this.at(mid), time) <= 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get filmEnd(): RationalTime {
    return this.end(this.count - 1);
  }

  modalDuration(): bigint {
    const counts = new Map<bigint, number>();
    for (const value of this.durations) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best = 0n;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  }

  private clamp(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`frame ${index} is not one of the ${this.count} frames`);
    }
    return index;
  }
}

export class SampleClock {
  readonly rate: number;
  readonly count: number;
  private readonly origin: RationalTime;

  constructor(rate: number, count: number, firstPts: string | null, timebase: { num: number; den: number }) {
    this.rate = rate;
    this.count = count;
    this.origin = firstPts === null ? rt(0, rate) : rt(BigInt(firstPts) * BigInt(timebase.num), timebase.den);
  }

  at(sample: number): RationalTime {
    return addTime(this.origin, rt(Math.max(0, Math.round(sample)), this.rate));
  }

  get start(): RationalTime {
    return this.origin;
  }

  get end(): RationalTime {
    return this.at(this.count);
  }

  /** The time resolution of an event located to the sample. */
  get resolution(): RationalTime {
    return rt(1, this.rate);
  }
}

export function ticksBetween(a: RationalTime, b: RationalTime): bigint {
  // Exact only on a shared clock; callers pass times from one clock.
  if (a.timescale !== b.timescale) throw new RangeError('times on different clocks');
  return ticksOf(b) - ticksOf(a);
}
