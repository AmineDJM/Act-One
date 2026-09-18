import { describe, it, expect } from 'vitest';
import {
  FilmScore,
  MOVEMENT_MIN_SECONDS,
  captionsFrom,
  fitScore,
  movementBoundaries,
  scenesInMovement,
  scoreSeconds,
  toWebVtt,
} from '../index.ts';

/**
 * A score is only worth composing if it lands on the picture.
 *
 * Every rule here is one the engine or the edit imposes: a movement shorter
 * than three seconds cannot be composed at all, and a score that is a fraction
 * short of the film leaves the last cut in silence.
 */
const scenes = (durations: number[]) =>
  durations.map((duration, index) => ({
    id: `sc_${index}`,
    duration,
    purpose: `scene ${index}`,
    narration: index === 1 ? 'Something said here.' : '',
    onScreenText: [],
    visualType: 'kinetic_typography' as const,
  }));

const movement = (seconds: number, name = 'Open') => ({
  name,
  direction: 'Hold one idea and let it develop without arriving anywhere yet.',
  seconds,
  styles: ['low sustained synth', 'no percussion'],
  avoid: ['vocals'],
  adherence: 'high' as const,
});

describe('where a film turns', () => {
  it('finds the turns a short film actually has', () => {
    // 4 + 5 + 6 = 15s: three turns, each long enough to compose.
    expect(movementBoundaries({ scenes: scenes([4, 5, 6]) })).toEqual([0, 4, 9]);
  });

  it('merges turns that are too close to be music', () => {
    // A one-second scene is a cut, not a movement.
    expect(movementBoundaries({ scenes: scenes([1, 1, 1, 8, 8]) })).toEqual([0, 3, 11]);
  });

  it('never ends on a turn too short to compose', () => {
    const boundaries = movementBoundaries({ scenes: scenes([6, 6, 1]) });
    const total = 13;
    for (const [index, start] of boundaries.entries()) {
      const end = boundaries[index + 1] ?? total;
      expect(end - start).toBeGreaterThanOrEqual(MOVEMENT_MIN_SECONDS);
    }
  });

  it('keeps a short film to a handful of ideas', () => {
    const many = movementBoundaries({ scenes: scenes([4, 4, 4, 4, 4, 4, 4, 4]) }, 3);
    expect(many.length).toBeLessThanOrEqual(3);
  });

  it('says which scenes play under a movement', () => {
    const board = { scenes: scenes([4, 5, 6]) };
    expect(scenesInMovement(board, 0, 4).map((scene) => scene.id)).toEqual(['sc_0']);
    expect(scenesInMovement(board, 4, 15).map((scene) => scene.id)).toEqual(['sc_1', 'sc_2']);
    expect(scenesInMovement(board, 14.5, 15).map((scene) => scene.id)).toEqual(['sc_2']);
  });
});

describe('fitting a score to the picture', () => {
  it('makes the movements sum to the film exactly', () => {
    const score = FilmScore.parse({ movements: [movement(5), movement(5, 'Build'), movement(5, 'Resolve')] });
    const fitted = fitScore(score, 19.4);
    expect(scoreSeconds(fitted)).toBeCloseTo(19.4, 3);
  });

  it('drops movements a short film cannot hold, rather than composing silence', () => {
    const score = FilmScore.parse({
      movements: [movement(4), movement(4, 'Build'), movement(4, 'Turn'), movement(4, 'Resolve')],
    });
    const fitted = fitScore(score, 8);
    expect(fitted.movements.length).toBeLessThanOrEqual(2);
    expect(scoreSeconds(fitted)).toBeCloseTo(8, 3);
    for (const one of fitted.movements) expect(one.seconds).toBeGreaterThanOrEqual(MOVEMENT_MIN_SECONDS);
  });

  it('puts the rounding remainder on the last movement, where it cannot leave a gap', () => {
    const score = FilmScore.parse({ movements: [movement(6), movement(6, 'Resolve')] });
    const fitted = fitScore(score, 13.333);
    expect(scoreSeconds(fitted)).toBeCloseTo(13.333, 3);
  });

  it('is never sung', () => {
    expect(FilmScore.parse({ movements: [movement(5)] }).instrumental).toBe(true);
  });
});

describe('captions from what was actually said', () => {
  const words = [
    { word: 'A', start: 0, end: 0.2 },
    { word: 'week', start: 0.2, end: 0.5 },
    { word: 'of', start: 0.5, end: 0.6 },
    { word: 'manual', start: 0.6, end: 1.1 },
    { word: 'reconciliation.', start: 1.1, end: 1.9 },
    { word: 'One', start: 2.4, end: 2.7 },
    { word: 'run.', start: 2.7, end: 3.1 },
  ];

  it('breaks where the sentence breaks, not where the character count does', () => {
    const cues = captionsFrom(words, { maxCharacters: 40 });
    expect(cues.length).toBeGreaterThanOrEqual(1);
    expect(cues[0]!.text).toContain('A week of manual reconciliation.');
    expect(cues[0]!.start).toBe(0);
  });

  it('holds every caption long enough to read', () => {
    for (const cue of captionsFrom(words)) expect(cue.end - cue.start).toBeGreaterThanOrEqual(1);
  });

  it('writes the timings a browser can read', () => {
    const vtt = toWebVtt(captionsFrom(words));
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toMatch(/00:00:00\.000 --> 00:00:0\d\.\d{3}/);
  });

  it('says nothing when nothing was said', () => {
    expect(captionsFrom([])).toEqual([]);
    expect(toWebVtt([])).toBe('WEBVTT\n');
  });
});
