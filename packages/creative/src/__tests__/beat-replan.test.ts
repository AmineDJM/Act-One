import { describe, it, expect } from 'vitest';
import { readingSecondsFor, TEXT_ARRIVAL_SECONDS } from '@act-one/core';
import {
  allowedVisualTypesFor,
  estimateOptionCostUsd,
  normalizeOption,
  rejectOption,
  wordBudgetLines,
  type ReplanOption,
} from '../beat-replan.ts';

/**
 * The guard rails on the Creative Director.
 *
 * The Director is a model, and a model told the arithmetic still gets the
 * arithmetic wrong. Every one of these refusals is a way a proposal could have
 * solved the beat and broken the film — which is the same failure the
 * deterministic layer was taught to refuse, arriving by a more expensive
 * route. A director's cut is checked exactly like a trim.
 */
function option(over: Partial<ReplanOption> = {}): ReplanOption {
  return {
    strategy: 'split_scene',
    reasoning: 'One idea is three beats.',
    quality: 'better',
    needsNewMaterial: false,
    shots: [
      { purpose: 'tension', duration: 2, visualType: 'kinetic_typography', motionRecipe: 'word_reveal', onScreenText: ['Close the books.'], narration: '', justification: '' },
      { purpose: 'proof', duration: 2.4, visualType: 'kinetic_typography', motionRecipe: 'editorial_headline', onScreenText: ['A week of manual matching.'], narration: '', justification: '' },
      { purpose: 'payoff', duration: 1.6, visualType: 'kinetic_typography', motionRecipe: 'mask_reveal', onScreenText: ['Gone.'], narration: '', justification: '' },
    ],
    ...over,
  };
}

describe('the director authors, the arithmetic is ours', () => {
  it('takes a proposal that already fills the room exactly', () => {
    expect(rejectOption(option(), 6)).toBeNull();
    /*
     * Not round numbers, and that is the point: the shot ceilings are derived
     * from how long the renderer's own type reveal takes, so the arithmetic
     * moves when the animation does rather than when somebody remembers.
     */
    const durations = normalizeOption(option(), 6).durations!;
    expect(round(sum(durations))).toBe(6);
    expect(durations).toHaveLength(3);
  });

  it('corrects a shot that overshoots what its copy earns, rather than refusing the idea', () => {
    /*
     * A proposal eighty milliseconds over on one shot is a good idea with a
     * slip in it. Refusing the whole option over that threw away three sound
     * proposals in a row on a real run — and the slip is something the
     * deterministic layer can fix exactly.
     */
    const over = option({
      shots: option().shots.map((shot, index) => (index === 2 ? { ...shot, duration: 2.5 } : shot)),
    });
    const fixed = normalizeOption(over, 6.5);
    expect(fixed.reason).toBeUndefined();
    expect(round(sum(fixed.durations!))).toBe(6.5);
    /*
     * 'Gone.' is one word. It earns the beat's floor of 1.2s of stillness, and
     * the shot may run the time the type takes to arrive on top of that — and
     * not a frame more, which is the rule the film is judged by.
     */
    expect(fixed.durations![2]).toBeLessThanOrEqual(
      TEXT_ARRIVAL_SECONDS + Math.max(1.2, readingSecondsFor('Gone.')) + 0.001,
    );
  });

  it('stretches a shot that was given less time than its copy needs', () => {
    const short = option({
      shots: option().shots.map((shot, index) => (index === 0 ? { ...shot, duration: 0.9 } : shot)),
    });
    const fixed = normalizeOption(short, 6);
    expect(fixed.durations![0]).toBeGreaterThanOrEqual(readingSecondsFor('Close the books.') - 0.001);
    expect(round(sum(fixed.durations!))).toBe(6);
  });

  it('refuses shots that cannot fill the beat without holding still', () => {
    // Three words and a one-word payoff cannot carry twenty seconds, and
    // stretching them is the defect being repaired.
    const thin = normalizeOption(option(), 20);
    expect(thin.reason).toMatch(/cannot carry|needs more to say/);
    expect(rejectOption(option(), 20)).toMatch(/needs more to say/);
  });

  it('refuses shots that need more time than the beat has', () => {
    const crowded = option({
      shots: [
        { purpose: 'a', duration: 3, visualType: 'kinetic_typography', motionRecipe: 'word_reveal', onScreenText: ['Nine whole words is far too many for this shot'], narration: '', justification: '' },
      ],
    });
    expect(rejectOption(crowded, 1.5)).toMatch(/need .* and the beat has/);
  });

  it('does not bind a shot that plays for its whole length', () => {
    const playing = option({
      shots: [
        { purpose: 'a', duration: 6, visualType: 'generated_broll', motionRecipe: 'footage', onScreenText: [], narration: '', justification: '' },
      ],
    });
    expect(rejectOption(playing, 6, { hasFootage: true })).toBeNull();
    // Footage can carry the whole beat, so there is nothing to correct.
    expect(normalizeOption(playing, 6).durations).toEqual([6]);
  });

  it('does not refuse a recipe the pipeline can swap for free', () => {
    /*
     * `cursor_sequence` needs a captured screen to move a cursor across, so it
     * cannot be drawn by a typographic shot — and the replan stage swaps it
     * for one that can, deterministically, before anything is rendered.
     */
    const mismatched = option({
      shots: [
        { purpose: 'a', duration: 2.1, visualType: 'kinetic_typography', motionRecipe: 'cursor_sequence', onScreenText: ['Close the books.'], narration: '', justification: '' },
      ],
    });
    // Room for the three words and for the reveal that puts them there.
    expect(rejectOption(mismatched, 2.1)).toBeNull();
  });

  it('offers only the kinds of shot the film can actually make', () => {
    expect(allowedVisualTypesFor({ hasFootage: false })).toEqual([
      'kinetic_typography', 'statistic', 'quote', 'logo_reveal', 'transition',
    ]);
    expect(allowedVisualTypesFor({ hasFootage: true })).toContain('generated_broll');
  });

  it('refuses a shot that needs material we do not hold', () => {
    const asking = option({
      shots: [
        { purpose: 'the product', duration: 6, visualType: 'product_ui', motionRecipe: 'product_window', onScreenText: [], narration: '', justification: '' },
      ],
    });
    expect(rejectOption(asking, 6, { hasFootage: false })).toMatch(/hold no material/);
  });

  it('never takes an option the director itself called weaker', () => {
    // Quality first, then cost. A cheap option that makes the film worse is
    // not a saving.
    expect(rejectOption(option({ quality: 'weaker' }), 6)).toMatch(/weaker/);
  });
});

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe('what an option would cost before anything is spent', () => {
  it('prices a recomposition at nothing, because that is what it costs', () => {
    expect(estimateOptionCostUsd(option(), 0.4)).toBe(0);
  });

  it('prices every shot that needs a provider', () => {
    const generating = option({
      shots: [
        { purpose: 'a', duration: 3, visualType: 'generated_broll', motionRecipe: 'footage', onScreenText: [], narration: '', justification: '' },
        { purpose: 'b', duration: 3, visualType: 'generated_broll', motionRecipe: 'footage', onScreenText: [], narration: '', justification: '' },
      ],
    });
    expect(estimateOptionCostUsd(generating, 0.4)).toBeCloseTo(0.8);
  });
});

describe('which question the director is being asked', () => {
  it('tells a starved beat to find more to say', () => {
    const lines = wordBudgetLines(8, 'starved').join(' ');
    expect(lines).toMatch(/too thin for the room is the defect/);
  });

  it('tells a beat that already fits to stay under the count, not reach it', () => {
    /*
     * The real failure: told the problem is always emptiness, the director
     * answered a creative note — "it reads like a deck" — by writing more,
     * and every option it produced needed 8.7 to 14.75 seconds for a beat
     * holding 7.01. All were refused by the arithmetic and the film was held
     * with nothing changed.
     */
    const lines = wordBudgetLines(7.01, 'creative').join(' ');
    expect(lines).toMatch(/stay under those numbers/);
    expect(lines).toMatch(/already full/);
    expect(lines).not.toMatch(/too thin/);
  });

  it('quotes the same arithmetic to both, because the beat is the same length', () => {
    const starved = wordBudgetLines(7.01, 'starved')[1];
    const creative = wordBudgetLines(7.01, 'creative')[1];
    expect(creative).toBe(starved);
  });
});
