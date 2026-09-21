import { describe, expect, it } from 'vitest';
import { findEmphasis, layout, phrasesOf, type AvBeat } from '../narration/av-beat.ts';
import type { SpokenWord } from '../narration/spoken-word.ts';

/** A reading, written as `word@start-end` so the timings are visible in the test. */
const read = (spec: string): SpokenWord[] =>
  spec.split(/\s{2,}/).map((token) => {
    const [word, span] = token.split('@');
    const [start, end] = span!.split('-').map(Number);
    return { word: word!, startSeconds: start!, endSeconds: end! };
  });

const beat = (over: Partial<AvBeat>): AvBeat =>
  ({ id: 'b', line: 'Not one safe idea. Three.', emphasis: 'Three.', reason: 'test', ...over });

describe('finding the emphasis in a real reading', () => {
  const words = read('Not@0-0.21  one@0.27-0.38  safe@0.42-0.61  idea.@0.64-0.88  Three.@0.91-1.35');

  it('matches through punctuation, in both directions', () => {
    // The script says "Three"; the engine reported "Three."
    expect(findEmphasis(words, 'Three')?.startSeconds).toBe(0.91);
    expect(findEmphasis(words, 'Three.')?.startSeconds).toBe(0.91);
  });

  it('matches a phrase at its first word', () => {
    expect(findEmphasis(words, 'safe idea')?.startSeconds).toBe(0.42);
  });

  it('returns nothing for a word that was not said', () => {
    expect(findEmphasis(words, 'four')).toBeNull();
  });
});

describe('breaking a reading into what goes on screen', () => {
  it('breaks where the voice breathes, not where the commas are', () => {
    // A 0.4s gap after "said" and none at the comma inside "one, two".
    const words = read('You@0-0.2  said@0.22-0.5  one,@0.9-1.1  two@1.12-1.3');
    const phrases = phrasesOf(words, null, { breathSeconds: 0.3 });
    expect(phrases.map((p) => p.text)).toEqual(['You said', 'one, two']);
  });

  it('keeps a multi-word emphasis together as one phrase', () => {
    // "not made yet." must not become "not" and then "made yet."
    const words = read('it@0-0.1  has@0.12-0.2  not@0.22-0.4  made@0.42-0.6  yet.@0.62-0.9');
    const phrases = phrasesOf(words, 'not made yet.', { breathSeconds: 0.5 });
    expect(phrases.map((p) => p.text)).toEqual(['it has', 'not made yet.']);
    expect(phrases[1]!.carriesEmphasis).toBe(true);
  });

  it('gives the emphasis word a line of its own', () => {
    const words = read('Not@0-0.21  one@0.27-0.38  safe@0.42-0.61  idea.@0.64-0.88  Three.@0.91-1.35');
    const phrases = phrasesOf(words, 'Three', { breathSeconds: 0.5 });
    expect(phrases.map((p) => p.text)).toEqual(['Not one safe idea.', 'Three.']);
    expect(phrases[1]!.carriesEmphasis).toBe(true);
    expect(phrases[0]!.carriesEmphasis).toBe(false);
  });

  it('will not run more than a few words together however fast the voice is', () => {
    const words = read('a@0-0.1  b@0.1-0.2  c@0.2-0.3  d@0.3-0.4  e@0.4-0.5  f@0.5-0.6');
    expect(phrasesOf(words, null, { breathSeconds: 1, maxWords: 3 }).map((p) => p.text)).toEqual(['a b c', 'd e f']);
  });

  it('has nothing to show for a wordless beat', () => {
    expect(phrasesOf([], null)).toEqual([]);
  });
});

describe('laying beats on one clock', () => {
  const words = read('Not@0-0.21  one@0.27-0.38  safe@0.42-0.61  idea.@0.64-0.88  Three.@0.91-1.35');

  it('takes each beat\'s length from its reading rather than from a schedule', () => {
    const timed = layout([beat({ id: 'a' }), beat({ id: 'b' })],
      new Map([['a', { durationSeconds: 1.35, words }], ['b', { durationSeconds: 2, words: [] }]]),
      { tailSeconds: 0.4 });
    expect(timed[0]!.durationSeconds).toBeCloseTo(1.75, 3);
    expect(timed[1]!.atSeconds).toBeCloseTo(1.75, 3);
  });

  it('shifts the words and the emphasis by the lead, so they stay on the beat clock', () => {
    const [timed] = layout([beat({ leadSeconds: 0.5 })], new Map([['b', { durationSeconds: 1.35, words }]]));
    expect(timed!.voiceAtSeconds).toBe(0.5);
    expect(timed!.words[0]!.startSeconds).toBe(0.5);
    expect(timed!.emphasisAtSeconds).toBeCloseTo(1.41, 3);
    expect(timed!.phrases[0]!.atSeconds).toBe(0.5);
  });

  it('lets a beat be only picture, and still gives it length', () => {
    const [timed] = layout([beat({ id: 'w', line: '', emphasis: null, leadSeconds: 0, tailSeconds: 3 })], new Map());
    expect(timed!.durationSeconds).toBe(3);
    expect(timed!.words).toEqual([]);
    expect(timed!.emphasisAtSeconds).toBeNull();
  });

  it('never gives a beat zero length', () => {
    const [timed] = layout([beat({ id: 'z', line: '', emphasis: null, tailSeconds: 0 })], new Map());
    expect(timed!.durationSeconds).toBeGreaterThan(0);
  });
});
