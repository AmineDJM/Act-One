import { describe, it, expect } from 'vitest';
import { breakAllLines, breakLines, fitToLines } from '../typography.ts';

describe('saying the whole line', () => {
  const token = { family: 'Inter', fontSizePx: 90, tracking: -0.01, weight: 700, lineHeight: 1.05 };

  it('shrinks rather than dropping the end of a sentence', () => {
    /*
     * The defect this pins down was on screen in a customer's film: the line
     * "Draft a candidate update from these notes." rendered as "Draft a
     * candidate update from" — a sentence stopped mid-phrase, as though that
     * were the whole of it.
     */
    const fitted = fitToLines('Draft a candidate update from these notes.', {
      ...token,
      maxWidthPx: 700,
      maxLines: 2,
    });
    expect(fitted.truncated).toBe(false);
    expect(fitted.lines.join(' ')).toContain('these notes.');
    expect(fitted.fontSizePx).toBeLessThan(90);
  });

  it('will not shrink past the floor, and says when it gave up', () => {
    const fitted = fitToLines(
      'An extremely long line of copy that no reasonable typographic system could set in a single line at any size a film would tolerate',
      { ...token, maxWidthPx: 300, maxLines: 1, minScale: 0.8 },
    );
    expect(fitted.fontSizePx).toBeGreaterThanOrEqual(90 * 0.8 - 0.1);
    expect(fitted.truncated).toBe(true);
  });

  it('leaves text that already fits at its intended size', () => {
    const fitted = fitToLines('One record.', { ...token, maxWidthPx: 900, maxLines: 2 });
    expect(fitted.fontSizePx).toBe(90);
    expect(fitted.lines).toEqual(['One record.']);
  });

  it('counts the lines a break really needs', () => {
    // `breakLines` slices to maxLines, so asking it whether the result fits
    // in maxLines is a question that cannot fail. This is the honest count.
    const all = breakAllLines('one two three four five six seven eight nine ten', {
      ...token,
      maxWidthPx: 200,
    });
    expect(all.length).toBeGreaterThan(2);
    expect(breakLines('one two three four five six seven eight nine ten', {
      ...token,
      maxWidthPx: 200,
      maxLines: 2,
    })).toHaveLength(2);
  });
});
