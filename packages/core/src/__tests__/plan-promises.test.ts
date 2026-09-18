import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  canRender,
  canRevise,
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

describe('limits apply to every plan', () => {
  const org = () => ({ isSuspended: false, creditBalance: 0, planId: 'free' });

  it('holds the free tier to the runtime its pricing page advertises', () => {
    /*
     * `canRender` used to return early for any plan without a clean render, so
     * neither limit below was ever read for a free customer. The pricing page
     * said thirty seconds and a free account rendered forty-eight.
     */
    const free = planById(DEFAULT_PLANS, 'free');
    const long = canRender({
      plan: free,
      organization: org(),
      rendersForProject: 0,
      durationSeconds: free.limits.maxMasterDurationSeconds + 1,
    });

    expect(long.allowed).toBe(false);
    expect(long.reason).toMatch(/renders up to/);
  });

  it('holds the free tier to its render count', () => {
    const free = planById(DEFAULT_PLANS, 'free');
    const again = canRender({
      plan: free,
      organization: org(),
      rendersForProject: free.limits.rendersPerProject,
      durationSeconds: 10,
    });

    expect(again.allowed).toBe(false);
    expect(again.reason).toMatch(/per project/);
    // Said to a customer at the moment they are told no, so it reads properly:
    // "1 renders" next to a disabled button looks careless.
    expect(again.reason).toBe('Free includes 1 render per project.');
  });

  it('still lets a free customer see one film of their own', () => {
    // The free tier's whole job. A paywall here is a paywall in front of the
    // only thing that converts.
    const free = planById(DEFAULT_PLANS, 'free');
    expect(free.limits.rendersPerProject).toBeGreaterThan(0);
    const first = canRender({ plan: free, organization: org(), rendersForProject: 0, durationSeconds: 25 });
    expect(first.allowed).toBe(true);
    expect(first.watermarked).toBe(true);
  });

  it('sells no plan a limit of zero for something it lists as a feature', () => {
    for (const plan of DEFAULT_PLANS) {
      const canRenderAtAll =
        hasEntitlement(plan, 'render.clean') || hasEntitlement(plan, 'render.watermarked');
      if (!canRenderAtAll) continue;
      expect(plan.limits.rendersPerProject, `${plan.id} renders`).not.toBe(0);
      expect(plan.limits.maxMasterDurationSeconds, `${plan.id} runtime`).toBeGreaterThan(0);
    }
  });
});

describe('revisions', () => {
  const organization = { planId: 'free', isSuspended: false, creditBalance: 0 };

  it('sells unlimited revisions only where the entitlement says so, and a number everywhere else', () => {
    for (const plan of DEFAULT_PLANS) {
      const decision = canRevise({ plan, organization, revisionsUsed: 0 });
      if (hasEntitlement(plan, 'revisions.unlimited')) {
        expect(decision.limit, plan.id).toBe(-1);
      } else {
        expect(decision.limit, plan.id).toBeGreaterThan(0);
      }
      expect(decision.allowed).toBe(true);
    }
  });

  it('stops at the number, says which plan and what to do', () => {
    const free = planById(DEFAULT_PLANS, 'free');
    const stopped = canRevise({ plan: free, organization, revisionsUsed: free.limits.revisionsPerProject });
    expect(stopped.allowed).toBe(false);
    expect(stopped.remedy).toBe('upgrade');
    expect(stopped.reason).toMatch(/Free includes/);

    const pro = planById(DEFAULT_PLANS, 'pro');
    expect(canRevise({ plan: pro, organization, revisionsUsed: 40 }).allowed).toBe(true);
  });
});
