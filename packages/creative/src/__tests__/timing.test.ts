import { describe, it, expect } from 'vitest';
import { fitToDuration, varyRhythm, readingSeconds, narrationSeconds, copyFits, rewrap, type TimingConstraint } from '../index.ts';

describe('readingSeconds', () => {
  it('gives the eye time to arrive and the cut time to land', () => {
    // Six words at ~2.6 wps is 2.3s of reading; a scene of exactly 2.3s feels snatched.
    expect(readingSeconds(['Close the books without manual matching'])).toBeGreaterThan(2.3);
  });

  it('returns zero for no text', () => {
    expect(readingSeconds([])).toBe(0);
    expect(readingSeconds([''])).toBe(0);
  });

  it('scales with word count', () => {
    const short = readingSeconds(['One command']);
    const long = readingSeconds(['One command replaces a week of manual reconciliation work entirely']);
    expect(long).toBeGreaterThan(short * 1.8);
  });
});

describe('narrationSeconds', () => {
  it('accounts for sentence pauses', () => {
    expect(narrationSeconds('One. Two. Three.')).toBeGreaterThan(narrationSeconds('one two three'));
  });
});

describe('fitToDuration', () => {
  const constraints: TimingConstraint[] = [
    { id: 'a', preferred: 3, min: 2.4, max: 4, rigid: true },
    { id: 'b', preferred: 4, min: 1.5, max: 6, rigid: false },
    { id: 'c', preferred: 2, min: 1.2, max: 3, rigid: false },
    { id: 'd', preferred: 3, min: 2, max: 3.5, rigid: true },
  ];

  it('hits the target runtime', () => {
    const fitted = fitToDuration(constraints, 15);
    const total = [...fitted.values()].reduce((s, d) => s + d, 0);
    expect(total).toBeCloseTo(15, 0);
  });

  it('never moves a rigid scene — the hook and the ending are protected', () => {
    const fitted = fitToDuration(constraints, 15);
    expect(fitted.get('a')).toBe(3);
    expect(fitted.get('d')).toBe(3);
  });

  it('never violates a legibility floor even when it cannot hit the target', () => {
    const fitted = fitToDuration(constraints, 4);
    for (const c of constraints) {
      expect(fitted.get(c.id)!, c.id).toBeGreaterThanOrEqual(c.min);
    }
  });

  it('respects ceilings when asked for an impossible runtime', () => {
    const fitted = fitToDuration(constraints, 200);
    for (const c of constraints) {
      expect(fitted.get(c.id)!, c.id).toBeLessThanOrEqual(c.max);
    }
  });

  it('preserves dynamics: a long hold gives up more than a short beat', () => {
    const fitted = fitToDuration(constraints, 7);
    // b started longest and has the most room, so it should absorb most of the cut.
    const bDelta = 4 - fitted.get('b')!;
    const cDelta = 2 - fitted.get('c')!;
    expect(bDelta).toBeGreaterThan(cDelta);
  });
});

describe('varyRhythm', () => {
  it('breaks up a run of identical durations', () => {
    const constraints: TimingConstraint[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id, preferred: 3, min: 1.5, max: 4.5, rigid: false,
    }));
    const flat = new Map(constraints.map((c) => [c.id, 3]));
    const varied = varyRhythm(flat, constraints);
    const values = [...varied.values()];
    expect(new Set(values).size).toBeGreaterThan(1);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(1.5);
      expect(value).toBeLessThanOrEqual(4.5);
    }
  });

  it('leaves an already-varied edit alone', () => {
    const constraints: TimingConstraint[] = [
      { id: 'a', preferred: 1, min: 0.8, max: 4, rigid: false },
      { id: 'b', preferred: 3.5, min: 0.8, max: 4, rigid: false },
      { id: 'c', preferred: 1.2, min: 0.8, max: 4, rigid: false },
    ];
    const durations = new Map(constraints.map((c) => [c.id, c.preferred]));
    expect(varyRhythm(durations, constraints)).toEqual(durations);
  });
});

describe('copyFits', () => {
  const limits = { maxLineLength: 28, maxLines: 2 };

  it('accepts copy that fits the treatment', () => {
    expect(copyFits(['One command.'], limits).fits).toBe(true);
  });

  it('rejects copy that cannot be set in the allowed lines', () => {
    const result = copyFits(
      ['A week of manual reconciliation work collapses into a single automated run'],
      limits,
    );
    expect(result.fits).toBe(false);
    expect(result.suggestedBreak.length).toBeGreaterThan(limits.maxLines);
  });

  it('suggests a break that never splits a word', () => {
    const lines = rewrap(['Close the books without manual matching'], 18);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(18);
    expect(lines.join(' ')).toBe('Close the books without manual matching');
  });
});
