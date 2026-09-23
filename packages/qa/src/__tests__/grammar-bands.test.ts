import { describe, expect, it } from 'vitest';
import { REFERENCE_BANDS } from '@act-one/core';
import { bandMeasures, benchmarkGrammar, FilmGrammarReport } from '../grammar-bands.ts';

function report(overrides: Partial<FilmGrammarReport> = {}): FilmGrammarReport {
  return {
    durationSeconds: 60,
    counts: { shot: 6, scene: 3, creativeBeat: 30, transformation: 18 },
    staticShare: 0.2,
    cameraVsObject: { cameraShare: 0.6, parallaxShare: 0.2 },
    elements: [
      { kind: 'type', enterAt: 1, seconds: 1.2, easing: 'ease_out_cubic' },
      { kind: 'type', enterAt: 2, seconds: 0.8, easing: 'ease_in_cubic' },
      { kind: 'card', enterAt: 3, seconds: 2, easing: 'overshoot' },
      { kind: 'panel', enterAt: 4, seconds: 0.1, easing: null },
    ],
    audio: { voiceShareOfRuntime: 0.5, longestSilence: 1.1, bpm: 96, onsets: [1, 2, 3], impacts: [3, 30, 50] },
    soundToElement: [
      { kind: 'type', enterAt: 1, soundOffsetMs: 40 },
      { kind: 'card', enterAt: 3, soundOffsetMs: -300 },
    ],
    ...overrides,
  };
}

describe('bandMeasures', () => {
  it('reads the analyser report as per-minute and per-cut rates', () => {
    const measures = bandMeasures(report());
    expect(measures.runtimeSeconds).toBe(60);
    expect(measures.shotsPerMinute).toBe(6);
    expect(measures.creativeBeatsPerMinute).toBe(30);
    expect(measures.transformationsPerMinute).toBe(18);
    expect(measures.transformationsPerShot).toBe(3);
    expect(measures.movingElementsPerMinute).toBe(4);
    expect(measures.typeShareOfElements).toBe(0.5);
    expect(measures.easingFamilies).toBe(3);
    expect(measures.impactsPerSecond).toBeCloseTo(0.05);
    expect(measures.longestSilenceSeconds).toBe(1.1);
  });

  it('counts a sound lock only within the lock window, over entries long enough to be entries', () => {
    // Three elements last at least 0.2s; one of the two syncs is within 80ms.
    expect(bandMeasures(report()).soundLockShare).toBeCloseTo(1 / 3);
  });

  it('measures a film that never cuts against a single shot', () => {
    const measures = bandMeasures(report({ counts: { shot: 0, scene: 1, creativeBeat: 20, transformation: 12 } }));
    expect(measures.transformationsPerShot).toBe(12);
  });

  it('leaves out what it cannot read rather than reporting zero', () => {
    const silent = bandMeasures(report({ audio: null, elements: [] }));
    expect(silent.impactsPerSecond).toBeUndefined();
    expect(silent.soundLockShare).toBeUndefined();
    expect(silent.typeShareOfElements).toBeUndefined();
    expect(bandMeasures(report({ durationSeconds: 0 }))).toEqual({});
  });
});

describe('benchmarkGrammar', () => {
  it('places each measure on its band and sums the gap only on the defect side', () => {
    const benchmark = benchmarkGrammar(report({ durationSeconds: 30, counts: { shot: 13, scene: 3, creativeBeat: 15, transformation: 3 } }));
    const runtime = benchmark.readings.find((reading) => reading.band === 'runtimeSeconds')!;
    expect(runtime.position).toBe('below');
    const { low, high } = REFERENCE_BANDS.runtimeSeconds;
    expect(runtime.gap).toBeCloseTo((low - 30) / (high - low), 3);
    expect(benchmark.findings.some((finding) => finding.band === 'runtimeSeconds')).toBe(true);
    expect(benchmark.defectGap).toBeGreaterThan(runtime.gap);
  });

  it('reports a film inside every band as having no gap', () => {
    const inside = benchmarkGrammar(
      report({
        durationSeconds: 75,
        counts: { shot: 6, scene: 3, creativeBeat: 38, transformation: 20 },
        elements: Array.from({ length: 110 }, (_, index) => ({
          kind: index % 3 === 0 ? 'type' : 'card',
          enterAt: index * 0.6,
          seconds: 1,
          easing: ['linear', 'ease_out_quad', 'ease_out_cubic', 'ease_out_quint', 'ease_in_cubic', 'ease_in_out_cubic'][index % 6]!,
        })),
        audio: { voiceShareOfRuntime: 0.5, longestSilence: 1, bpm: 100, onsets: [], impacts: Array.from({ length: 15 }, (_, i) => i * 5) },
        soundToElement: Array.from({ length: 70 }, (_, index) => ({ kind: 'card', enterAt: index * 0.6, soundOffsetMs: 20 })),
      }),
    );
    expect(inside.findings).toEqual([]);
    expect(inside.defectGap).toBe(0);
  });

  it('refuses an analyser report that is not the shape it claims to be', () => {
    expect(FilmGrammarReport.safeParse({ durationSeconds: 'long' }).success).toBe(false);
    expect(FilmGrammarReport.safeParse({ ...report(), staticShare: 3 }).success).toBe(false);
  });
});
