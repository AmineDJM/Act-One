import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRODUCTION_BUDGET,
  ProductionBudget,
  budgetAllowsReplan,
  deliveryState,
  isSourceMaterial,
  spendReplan,
  type DeliveryFacts,
} from '../index.ts';

/**
 * The autonomy budget, and what it means for a film to be finished.
 *
 * Two rules that between them keep an autonomous production from running away
 * and from lying about where it got to.
 *
 * The budget only goes down, and it travels on the work. A loop that read its
 * limits from configuration at each step could refill its own tank by
 * enqueueing itself, and would keep paying a director to rewrite the same beat
 * until somebody noticed the invoice.
 *
 * And the delivery state is derived from facts rather than set. A film that
 * rolled back to an earlier whole cut with its defects still in it is a
 * successful transaction and an unfinished production, and reporting it as a
 * pass is the single most expensive kind of wrong this system can be.
 */
describe('how much a production may do on its own', () => {
  it('starts with two deterministic passes, two replans and one restructure', () => {
    expect(DEFAULT_PRODUCTION_BUDGET).toMatchObject({
      deterministicPasses: 2,
      creativeReplans: 2,
      structuralReplans: 1,
    });
  });

  it('spends a replan, and a structural one only when the escalation is structural', () => {
    const start = DEFAULT_PRODUCTION_BUDGET;
    const afterBeat = spendReplan(start, false);
    expect(afterBeat).toMatchObject({ creativeReplans: 1, structuralReplans: 1 });

    const afterStructure = spendReplan(afterBeat, true);
    expect(afterStructure).toMatchObject({ creativeReplans: 0, structuralReplans: 0 });
  });

  it('never goes below zero, and stops allowing replans when it is spent', () => {
    let budget = ProductionBudget.parse({ creativeReplans: 1, structuralReplans: 0 });
    expect(budgetAllowsReplan(budget)).toBe(true);
    budget = spendReplan(budget, true);
    expect(budget.creativeReplans).toBe(0);
    expect(budget.structuralReplans).toBe(0);
    expect(budgetAllowsReplan(budget)).toBe(false);
    // The loop asking again after it is spent must not resurrect it.
    expect(spendReplan(budget, true).creativeReplans).toBe(0);
  });
});

describe('what READY actually means', () => {
  const whole: DeliveryFacts = {
    renderSucceeded: true,
    repairTransactionSucceeded: true,
    globalQaPassed: true,
    creativeEscalationResolved: true,
  };

  it('is ready only when every one of them is true', () => {
    expect(deliveryState(whole)).toBe('ready');
  });

  it('is never ready on a rollback, however successful the rollback was', () => {
    // The exact case: the repairs were refused, the film went back to an
    // earlier whole cut, and its defects went back with it.
    expect(deliveryState({ ...whole, repairTransactionSucceeded: false })).toBe('needs_attention');
  });

  it('is never ready while an escalation is waiting on the director', () => {
    expect(deliveryState({ ...whole, creativeEscalationResolved: false })).toBe('needs_attention');
  });

  it('separates a film that is not good enough from a render that threw', () => {
    expect(deliveryState({ ...whole, globalQaPassed: false })).toBe('needs_attention');
    expect(deliveryState({ ...whole, renderSucceeded: false })).toBe('failed');
  });
});

describe('what a film can be made from', () => {
  it('does not count a film’s own output as material it can use', () => {
    /*
     * A project's assets include everything it produced — the master, its
     * poster, every scene render. Read as "footage we hold", a planner
     * concludes the film can be made out of itself, writes a b-roll shot that
     * does not exist, and the loop spends a replan finding out.
     */
    expect(isSourceMaterial({ kind: 'master_video' })).toBe(false);
    expect(isSourceMaterial({ kind: 'poster_frame' })).toBe(false);
    expect(isSourceMaterial({ kind: 'scene_render' })).toBe(false);
    expect(isSourceMaterial({ kind: 'variant_video' })).toBe(false);
    expect(isSourceMaterial({ kind: 'animatic' })).toBe(false);
  });

  it('counts what was captured, uploaded or commissioned', () => {
    expect(isSourceMaterial({ kind: 'screenshot' })).toBe(true);
    expect(isSourceMaterial({ kind: 'screen_recording' })).toBe(true);
    expect(isSourceMaterial({ kind: 'generated_video' })).toBe(true);
    expect(isSourceMaterial({ kind: 'user_upload' })).toBe(true);
  });
});
