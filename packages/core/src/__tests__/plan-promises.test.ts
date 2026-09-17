import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  effectivePlan,
  hasEntitlement,
  masterQualityFor,
  planById,
} from '../index.ts';

const org = (planId: string) => ({ planId });

/**
 * A plan is a promise with a price on it. These are the promises the pricing
 * page makes, checked against what the code will actually do.
 */
describe('plan promises', () => {
  it('gives 4K to the plan that sells 4K, and 1080p to the ones that do not', () => {
    for (const plan of DEFAULT_PLANS) {
      const expected = hasEntitlement(plan, 'render.4k') ? 'uhd' : 'hd';
      expect(masterQualityFor(plan), plan.id).toBe(expected);
    }
    // The specific promise: Pro costs more than Launch and must deliver more.
    expect(masterQualityFor(planById(DEFAULT_PLANS, 'pro'))).toBe('uhd');
    expect(masterQualityFor(planById(DEFAULT_PLANS, 'launch'))).toBe('hd');
  });

  it('never sells 4K without also selling a clean master', () => {
    // A watermarked 4K film is four times the pixels of something nobody can
    // use. Any plan offering one must offer the other.
    for (const plan of DEFAULT_PLANS) {
      if (!hasEntitlement(plan, 'render.4k')) continue;
      expect(hasEntitlement(plan, 'render.clean'), plan.id).toBe(true);
    }
  });

  it('falls back to free when a subscription lapses, whatever the org record says', () => {
    const plan = effectivePlan({
      plans: DEFAULT_PLANS,
      organization: org('studio'),
      subscription: { planId: 'studio', status: 'past_due' },
    });
    expect(plan.id).toBe('free');
    expect(masterQualityFor(plan)).toBe('hd');
    expect(hasEntitlement(plan, 'render.clean')).toBe(false);
  });

  it('honours a live subscription over the organisation record', () => {
    const plan = effectivePlan({
      plans: DEFAULT_PLANS,
      organization: org('free'),
      subscription: { planId: 'pro', status: 'active' },
    });
    expect(plan.id).toBe('pro');
  });

  it('honours a trial', () => {
    const plan = effectivePlan({
      plans: DEFAULT_PLANS,
      organization: org('free'),
      subscription: { planId: 'launch', status: 'trialing' },
    });
    expect(plan.id).toBe('launch');
  });

  it('uses the organisation record when there is no subscription at all', () => {
    expect(
      effectivePlan({ plans: DEFAULT_PLANS, organization: org('launch'), subscription: null }).id,
    ).toBe('launch');
  });
});
