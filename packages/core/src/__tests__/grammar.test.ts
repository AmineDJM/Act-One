import { describe, it, expect } from 'vitest';
import { CONTINUOUS_HANDOVERS, Handover, REFERENCE_BANDS, againstGrammar } from '../index.ts';

/**
 * The grammar, checked against the film it was derived to explain.
 *
 * The numbers here are the real ones measured off ashby-G.mp4 and off the
 * four references. If a future change to the bands stops calling that film
 * out on cutting instead of transforming, the bands have stopped describing
 * the thing they were built to describe.
 */
const ASHBY_G = {
  runtimeSeconds: 29.22,
  creativeBeatsPerMinute: 37.0,
  shotsPerMinute: 26.7,
  transformationsPerMinute: 6.2,
  transformationsPerShot: 0.23,
  staticShare: 0.49,
  movingElementsPerMinute: 107,
  typeShareOfElements: 0.8,
  easingFamilies: 6,
  cameraShare: 0.7,
  parallaxShare: 0.13,
  impactsPerSecond: 1.57,
  longestSilenceSeconds: 0.0,
  soundLockShare: 0.76,
};

describe('the measured grammar of a premium product film', () => {
  it('names every structural way the Ashby cut is outside the references', () => {
    const findings = againstGrammar(ASHBY_G);
    const bands = findings.map((finding) => finding.band);
    expect(bands).toContain('transformationsPerShot');
    expect(bands).toContain('shotsPerMinute');
    expect(bands).toContain('transformationsPerMinute');
    expect(bands).toContain('runtimeSeconds');
    expect(bands).toContain('typeShareOfElements');
    expect(bands).toContain('impactsPerSecond');
    expect(bands).toContain('longestSilenceSeconds');
    expect(bands).toContain('parallaxShare');
  });

  it('says the thing the whole analysis was for', () => {
    const ratio = againstGrammar(ASHBY_G).find((f) => f.band === 'transformationsPerShot');
    expect(ratio?.side).toBe('below');
    expect(ratio?.says).toMatch(/hard cuts/);
    expect(ratio?.says).toMatch(/sequence of compositions/);
  });

  it('leaves alone the measures the film already gets right', () => {
    const bands = againstGrammar(ASHBY_G).map((finding) => finding.band);
    // Act One changes its idea at very nearly the reference rate. That was
    // never the problem and the grammar must not invent one.
    expect(bands).not.toContain('creativeBeatsPerMinute');
    expect(bands).not.toContain('movingElementsPerMinute');
    expect(bands).not.toContain('soundLockShare');
    expect(bands).not.toContain('cameraShare');
  });

  it('is silent about a film sitting inside every band', () => {
    const middle = Object.fromEntries(
      Object.entries(REFERENCE_BANDS).map(([name, b]) => [name, (b.low + b.high) / 2]),
    );
    expect(againstGrammar(middle)).toEqual([]);
  });

  it('does not complain in the direction that is not a defect', () => {
    // Cutting less than the quietest reference, and more parallax than the
    // flattest, are not faults. A band is a description, not a target.
    const calm = { ...ASHBY_G, shotsPerMinute: 1, parallaxShare: 0.9, staticShare: 0.05 };
    const bands = againstGrammar(calm).map((finding) => finding.band);
    expect(bands).not.toContain('shotsPerMinute');
    expect(bands).not.toContain('parallaxShare');
    expect(bands).not.toContain('staticShare');
  });

  it('ignores a measurement it was not given', () => {
    expect(againstGrammar({})).toEqual([]);
    expect(againstGrammar({ staticShare: Number.NaN })).toEqual([]);
  });

  it('counts a cut as the only handover that is not continuous', () => {
    const all = Handover.options;
    expect([...CONTINUOUS_HANDOVERS].sort()).toEqual(all.filter((h) => h !== 'cut').sort());
  });
});
