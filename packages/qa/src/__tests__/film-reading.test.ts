import { describe, expect, it } from 'vitest';
import type { VideoAnalysis } from '@act-one/providers';
import { fuse } from '../film-reading.ts';
import type { FilmMeasurement } from '../film-measure.ts';

/**
 * The fusion is the part that can quietly go wrong.
 *
 * Measuring is a subprocess and reading is a model; both are proved against
 * real files. What needs protecting here is the rule between them: a
 * measurement and an interpretation are never averaged, never substituted for
 * one another, and a reading with only one half present must say so rather
 * than implying agreement.
 */

const measurement = (over: Partial<FilmMeasurement> = {}): FilmMeasurement => ({
  durationSeconds: 16,
  boundaries: {
    shot: [],
    scene: [],
    creativeBeat: [
      { at: 2.2, withCut: false },
      { at: 8.4, withCut: false },
      { at: 11, withCut: false },
    ],
    transformation: [{ at: 13, withCut: false }],
  },
  counts: { shot: 0, scene: 0, creativeBeat: 3, transformation: 1 },
  staticShare: 0.9,
  meanFlow: 0.02,
  cameraVsObject: { cameraFrames: 10, objectFrames: 14, cameraShare: 0.42, parallaxShare: 0.11 },
  elements: [],
  elementCounts: {},
  staggerGroups: [],
  audio: {
    voiceSpans: [],
    voiceShareOfRuntime: 0,
    silentSeconds: 4.7,
    longestSilence: 0.31,
    rangeDb: 61.8,
    bpm: 61.9,
    onsets: [0.96],
    impacts: [0.96],
    risers: [],
    sectionsAt: [],
  },
  soundToElement: [{ kind: 'card', enterAt: 4.6, soundOffsetMs: 0 }],
  ...over,
});

const interpretation = (over: Partial<VideoAnalysis> = {}): VideoAnalysis =>
  ({
    source: { reference: 'film.mp4', durationSeconds: 16 },
    depth: 'broad',
    model: 'test-model',
    analysedAt: new Date().toISOString(),
    boundaries: [],
    beats: [],
    narrative: null,
    viewerStates: [],
    visualHierarchy: [],
    typography: [],
    ui: [],
    objectTransformations: [],
    camera: [],
    motion: [],
    transitions: [],
    audio: [],
    voice: [],
    music: [],
    sfx: [],
    sync: [],
    cognitiveLoad: [],
    heroMoments: [],
    memorability: null,
    comprehension: null,
    limitations: [],
    ...over,
  }) as VideoAnalysis;

const boundary = (at: number, kind: VideoAnalysis['boundaries'][number]['kind']) => ({
  at,
  kind,
  mechanism: 'text replacement',
  confidence: 'observed' as const,
  evidence: 'the line changes',
});

describe('cross-checking a reading against a measurement', () => {
  it('corroborates a boundary both halves found', () => {
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        boundaries: [boundary(2.0, 'creative_beat')],
      }),
    );
    expect(reading.boundaries[0]?.verdict).toBe('corroborated');
    expect(reading.boundaries[0]?.deltaSeconds).toBeCloseTo(0.2, 5);
  });

  it('calls a boundary nothing measured "unmeasured", never "contradicted"', () => {
    // An idea changing is not necessarily a pixel event. The instrument having
    // no opinion is the commonest honest outcome and must not read as a clash.
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        boundaries: [boundary(5.5, 'creative_beat')],
      }),
    );
    expect(reading.boundaries[0]?.verdict).toBe('unmeasured');
  });

  it('corroborates across a naming disagreement, and says that is what happened', () => {
    // The instrument called 13.0s a transformation; the analyst called it a
    // scene. They agree that something happened there, which is the part that
    // matters.
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        boundaries: [boundary(12.8, 'scene')],
      }),
    );
    expect(reading.boundaries[0]?.verdict).toBe('corroborated');
    expect(reading.boundaries[0]?.measurement).toContain('different kind');
  });

  it('contradicts a claimed sound offset the instrument disagrees with', () => {
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        sync: [
          {
            at: 4.6,
            visualEvent: 'card enters',
            audioEvent: 'impact',
            offsetMs: -900,
            relationship: 'anticipates',
            confidence: 'inferred',
            evidence: 'the sound seems to lead',
          },
        ] as VideoAnalysis['sync'],
      }),
    );
    expect(reading.sync[0]?.verdict).toBe('contradicted');
    expect(reading.sync[0]?.measurement).toContain('0ms');
  });

  it('accepts a sync claim within tolerance', () => {
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        sync: [
          {
            at: 4.6,
            visualEvent: 'card enters',
            audioEvent: 'impact',
            offsetMs: 60,
            relationship: 'coincides',
            confidence: 'observed',
            evidence: 'the hit lands with the card',
          },
        ] as VideoAnalysis['sync'],
      }),
    );
    expect(reading.sync[0]?.verdict).toBe('corroborated');
  });

  it('cross-checks nothing when there is no measurement, and says why', () => {
    const reading = fuse(
      'film.mp4',
      null,
      'OpenCV is not installed on this host.',
      interpretation({
        boundaries: [boundary(2.0, 'creative_beat')],
      }),
    );
    expect(reading.boundaries).toEqual([]);
    expect(reading.measurementGap).toContain('OpenCV');
    // An absent measurement must never read as a measurement of zero.
    expect(reading.measured).toBeNull();
  });

  it('cross-checks nothing when nobody watched the film', () => {
    const reading = fuse('film.mp4', measurement(), '', null);
    expect(reading.boundaries).toEqual([]);
    expect(reading.summary.every((line) => line.basis === 'measured')).toBe(true);
  });

  it('labels every summary line with where it came from', () => {
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        boundaries: [boundary(2.0, 'creative_beat')],
      }),
    );
    const bases = new Set(reading.summary.map((line) => line.basis));
    expect(bases.has('measured')).toBe(true);
    expect(bases.has('interpreted')).toBe(true);
    expect(bases.has('corroborated')).toBe(true);
    // No line is unlabelled: the whole point is that a reader can tell.
    expect(reading.summary.every((line) => Boolean(line.basis))).toBe(true);
  });

  it('keeps the measured audio when the analyst claims there was none', () => {
    // A live pass reported "no audio present" for a film carrying a 253kb/s
    // AAC track. The instrument is the authority on whether sound exists.
    const reading = fuse(
      'film.mp4',
      measurement(),
      '',
      interpretation({
        audio: [],
        limitations: ['No audio present in media file.'],
      }),
    );
    expect(reading.measured?.audio?.bpm).toBe(61.9);
    expect(reading.measured?.audio?.onsets.length).toBeGreaterThan(0);
  });
});
