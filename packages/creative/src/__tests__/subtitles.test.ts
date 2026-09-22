import { describe, expect, it } from 'vitest';
import { subtitlesFollow, subtitlesFor } from '../narration/subtitles.ts';
import type { Phrase } from '../narration/av-beat.ts';

const phrase = (text: string, atSeconds: number, endSeconds: number, carriesEmphasis = false): Phrase =>
  ({ text, atSeconds, endSeconds, carriesEmphasis });

/**
 * This film has shipped twice with subtitles that did not follow the voice.
 * Both regressions are in here as cases, because both looked like improvements
 * when they were made.
 */
describe('subtitles', () => {
  /** The opening beat, at the timings the voice actually produced. */
  const spoken = [
    phrase('Every company has a film', 0.6, 2.7),
    phrase('it has', 2.79, 3.0),
    phrase('not made yet.', 3.02, 4.4, true),
  ];

  /** A reading where every phrase is long enough to read on its own. */
  const roomy = [
    phrase('Not one safe idea.', 0, 1.6),
    phrase('Three.', 1.71, 2.4, true),
  ];

  it('carries every spoken phrase, not only the one the beat turns on', () => {
    const rows = subtitlesFor(roomy, 2.69);
    expect(rows.map((r) => r.text)).toEqual(['Not one safe idea.', 'Three.']);
    // The regression: keeping only the emphasis phrase.
    expect(subtitlesFollow(rows.filter((_, i) => i === 1), roomy).ok).toBe(false);
  });

  it('appears when the words were spoken, never before', () => {
    const rows = subtitlesFor(roomy, 2.69);
    expect(rows.map((r) => r.atSeconds)).toEqual([0, 1.71]);
    // The regression: leading the text to fill a silent stretch.
    const led = rows.map((r) => ({ ...r, atSeconds: Math.max(0, r.atSeconds - 1) }));
    const verdict = subtitlesFollow(led, roomy);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toContain('spoken from');
  });

  it('holds each row until the next one, so the screen is never empty mid-sentence', () => {
    const rows = subtitlesFor(roomy, 2.69);
    expect(rows[0]!.untilSeconds).toBe(1.71);
    // The last one runs to the end of the beat rather than to a fixed timer.
    expect(rows[1]!.untilSeconds).toBe(2.69);
  });

  it('joins a phrase too brief to read to the one that follows it', () => {
    // "it has" was on screen for 0.21s between two readable captions: a
    // flicker, which a viewer reads as a fault rather than as words.
    const rows = subtitlesFor(spoken, 5.65);
    expect(rows.map((r) => r.text)).toEqual([
      'Every company has a film',
      'it has not made yet.',
    ]);
    // Joined FORWARD: it arrives when "it has" is said, not when the beat began.
    expect(rows[1]!.atSeconds).toBe(2.79);
    expect(subtitlesFollow(rows, spoken).ok).toBe(true);
  });

  it('leaves a single short phrase alone rather than inventing a neighbour', () => {
    const alone = [phrase('Three.', 0, 0.3, true)];
    expect(subtitlesFor(alone, 0.4)).toEqual([
      { text: 'Three.', atSeconds: 0, untilSeconds: 0.4 },
    ]);
  });

  it('cannot rewrite what was said', () => {
    const rows = subtitlesFor(roomy, 2.69);
    const edited = rows.map((r, i) => (i === 0 ? { ...r, text: 'Not one idea.' } : r));
    expect(subtitlesFollow(edited, roomy).ok).toBe(false);
  });

  it('cannot silently drop a phrase off the end', () => {
    const rows = subtitlesFor(roomy, 2.69);
    const verdict = subtitlesFollow(rows.slice(0, 1), roomy);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toContain('never reach the screen');
  });

  it('gives a wordless beat no subtitle at all', () => {
    expect(subtitlesFor([], 3.4)).toEqual([]);
    expect(subtitlesFollow([], []).ok).toBe(true);
  });
});
