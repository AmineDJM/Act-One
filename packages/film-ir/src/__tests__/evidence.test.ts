import { describe, expect, it } from 'vitest';
import { estimated, inferred, measured, provenance, recommended, sourceExact, unknown } from '../evidence.ts';

/** Every value carries how it is known; the constructors are what make that true. */
describe('evidence constructors', () => {
  it('marks what the container states as exact, at full confidence', () => {
    expect(sourceExact(1920, 'container.pyav', ['stream:v0'])).toEqual({
      evidenceType: 'SOURCE_EXACT',
      confidence: 1,
      method: 'container.pyav',
      sourceRefs: ['stream:v0'],
      value: 1920,
    });
  });

  it('keeps bounds, units and a note alongside a measurement', () => {
    const value = measured(0.4, 'text.visibility', ['text:text.0001'], 0.9, { lowerBound: 0.36, upperBound: 0.44, unit: 's', note: 'first visible' });
    expect(value).toMatchObject({ evidenceType: 'MEASURED', confidence: 0.9, lowerBound: 0.36, upperBound: 0.44, unit: 's', note: 'first visible' });
  });

  it('makes an unknown with no value, no confidence and a stated reason', () => {
    const value = unknown<string>('text.glyphs', 'The font family cannot be read from pixels.', ['text:text.0001']);
    expect(value).toEqual({
      evidenceType: 'UNKNOWN',
      confidence: 0,
      method: 'text.glyphs',
      sourceRefs: ['text:text.0001'],
      value: null,
      note: 'The font family cannot be read from pixels.',
    });
  });

  it('clamps confidence into [0, 1] and never lets NaN through', () => {
    expect(inferred('hook', 'model.gemini.p02_narrative', ['pass:p02_narrative'], 1.7).confidence).toBe(1);
    expect(estimated(3, 'fit.curves', [], -0.2).confidence).toBe(0);
    expect(recommended('push in', 'model.gemini.p09_reconstruction', [], Number.NaN).confidence).toBe(0);
  });

  it('copies its references, so a later edit of the caller\'s list cannot change the record', () => {
    const refs: `${string}:${string}`[] = ['shot:shot.001'];
    const value = measured(true, 'boundary.cut', refs);
    refs.push('shot:shot.002');
    expect(value.sourceRefs).toEqual(['shot:shot.001']);
  });

  it('gives measured provenance full confidence by default and interpretations half', () => {
    expect(provenance('MEASURED', 'pixels.luma', []).confidence).toBe(1);
    expect(provenance('INFERRED', 'model.gemini.p01_holistic', []).confidence).toBe(0.5);
  });
});
