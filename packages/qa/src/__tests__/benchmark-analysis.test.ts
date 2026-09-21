import { describe, expect, it } from 'vitest';
import { countMoments } from '../benchmark-analysis.ts';

/**
 * The empty reading is the case this exists for.
 *
 * A model can return a well-formed reading that describes nothing, and such a
 * film sits in the corpus looking analysed while answering no query. One of the
 * first three reference films was in exactly that state and it went unnoticed
 * until a retrieval was run by hand.
 */
describe('countMoments', () => {
  it('counts only entries that have BOTH a time and a description', () => {
    expect(countMoments({
      boundaries: [
        { at: 2.25, mechanism: 'text scales up to fill the frame' },
        { at: 5.0, mechanism: '' },              // described nothing
        { mechanism: 'a cut somewhere' },        // no time: unusable
        { at: 9.0 },                             // no description: unusable
      ],
      typography: [{ atSeconds: 12, what: 'one word at image scale' }],
    })).toBe(2);
  });

  it('reports zero for a well-formed reading that describes nothing', () => {
    // This is the shape that shipped: every key present, every array empty.
    expect(countMoments({
      boundaries: [], beats: [], typography: [], ui: [], camera: [],
      transitions: [], audio: [], sync: [], heroMoments: [],
      narrative: { thesis: 'a film about speed' },
    })).toBe(0);
  });

  it('reports zero rather than throwing when there is no reading at all', () => {
    expect(countMoments(null)).toBe(0);
    expect(countMoments({})).toBe(0);
  });
});
