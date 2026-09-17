import { describe, it, expect } from 'vitest';
import { speakingRateFor } from '../stages/render.ts';

describe('speaking rate', () => {
  it('reads at an unhurried pace when the line fits the scene', () => {
    // Seven words in 2.7s is almost exactly 2.6 words a second.
    expect(speakingRateFor('The work moves the moment it lands', 2.7)).toBeCloseTo(1, 1);
  });

  it('speeds up for a line written long for its scene', () => {
    expect(speakingRateFor('one two three four five six seven eight nine ten', 2)).toBeGreaterThan(1);
  });

  it('slows down for a line with room to spare', () => {
    expect(speakingRateFor('One run.', 4)).toBeLessThan(1);
  });

  it('never rushes past panicked or drags below drugged', () => {
    // Outside this range the copy is wrong for the cut, which the timing engine
    // fixes upstream — pushing the voice further only sounds broken.
    const far = 'word '.repeat(60);
    expect(speakingRateFor(far, 1)).toBeLessThanOrEqual(1.15);
    expect(speakingRateFor('Hi.', 30)).toBeGreaterThanOrEqual(0.85);
  });

  it('does not divide by a zero-length scene', () => {
    expect(speakingRateFor('Anything', 0)).toBe(1);
    expect(Number.isFinite(speakingRateFor('Anything', 0))).toBe(true);
  });
});
