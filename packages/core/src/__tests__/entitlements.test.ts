import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  canAddSeat,
  canRender,
  canSpendCredits,
  canStartProject,
  effectivePlanId,
  generativeAllowanceSeconds,
  missingEntitlements,
  planById,
} from '../index.ts';

const free = planById(DEFAULT_PLANS, 'free');
const launch = planById(DEFAULT_PLANS, 'launch');
const pro = planById(DEFAULT_PLANS, 'pro');

const org = (over: Partial<{ planId: string; isSuspended: boolean; creditBalance: number }> = {}) => ({
  planId: 'free',
  isSuspended: false,
  creditBalance: 0,
  ...over,
});

describe('effectivePlanId', () => {
  it('trusts the organisation when there is no subscription', () => {
    expect(effectivePlanId(org({ planId: 'pro' }), null)).toBe('pro');
  });

  it('honours a live subscription over the organisation row', () => {
    expect(effectivePlanId(org({ planId: 'free' }), { status: 'active', planId: 'pro' })).toBe('pro');
    expect(effectivePlanId(org({ planId: 'free' }), { status: 'trialing', planId: 'pro' })).toBe('pro');
  });

  it('degrades to free when billing lapses, whatever the organisation row says', () => {
    // A failed payment that never updated the organisation row must not leave
    // a customer on Pro indefinitely.
    for (const status of ['past_due', 'canceled', 'incomplete', 'none'] as const) {
      expect(effectivePlanId(org({ planId: 'pro' }), { status, planId: 'pro' }), status).toBe('free');
    }
  });
});

describe('canStartProject', () => {
  it('allows a first project on free', () => {
    expect(canStartProject({ plan: free, organization: org(), projectsThisMonth: 0 }).allowed).toBe(true);
  });

  it('refuses past the monthly limit, and says to upgrade', () => {
    const decision = canStartProject({ plan: free, organization: org(), projectsThisMonth: 2 });
    expect(decision.allowed).toBe(false);
    expect(decision.remedy).toBe('upgrade');
    expect(decision.reason).toContain('2 projects');
  });

  it('refuses a suspended workspace before anything else', () => {
    const decision = canStartProject({
      plan: pro,
      organization: org({ isSuspended: true }),
      projectsThisMonth: 0,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.remedy).toBe('contact');
  });

  it('treats -1 as unlimited', () => {
    const studio = planById(DEFAULT_PLANS, 'studio');
    expect(
      canStartProject({ plan: studio, organization: org(), projectsThisMonth: 9999 }).allowed,
    ).toBe(true);
  });
});

describe('canRender', () => {
  it('lets free render — watermarked', () => {
    // The free tier's whole job is to let somebody see their own film. A
    // paywall here is a paywall in front of the only thing that converts.
    const decision = canRender({ plan: free, organization: org(), rendersForProject: 0, durationSeconds: 25 });
    expect(decision.allowed).toBe(true);
    expect(decision.watermarked).toBe(true);
    expect(decision.remedy).toBe('upgrade');
  });

  it('renders clean on a paid plan', () => {
    const decision = canRender({ plan: launch, organization: org(), rendersForProject: 0, durationSeconds: 60 });
    expect(decision.allowed).toBe(true);
    expect(decision.watermarked).toBe(false);
  });

  it('refuses a film longer than the plan allows, before rendering it', () => {
    const decision = canRender({ plan: launch, organization: org(), rendersForProject: 0, durationSeconds: 200 });
    expect(decision.allowed).toBe(false);
    // A customer should not discover their ceiling from a truncated film.
    expect(decision.reason).toContain('75s');
  });

  it('refuses past the per-project render limit', () => {
    const decision = canRender({ plan: launch, organization: org(), rendersForProject: 3, durationSeconds: 40 });
    expect(decision.allowed).toBe(false);
    expect(decision.remedy).toBe('upgrade');
  });

  it('refuses a suspended workspace even on the best plan', () => {
    const decision = canRender({
      plan: pro,
      organization: org({ isSuspended: true }),
      rendersForProject: 0,
      durationSeconds: 30,
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('canSpendCredits', () => {
  it('allows spend within the balance and refuses beyond it', () => {
    expect(canSpendCredits({ organization: org({ creditBalance: 500 }), credits: 400 }).allowed).toBe(true);
    const short = canSpendCredits({ organization: org({ creditBalance: 100 }), credits: 400 });
    expect(short.allowed).toBe(false);
    expect(short.remedy).toBe('billing');
  });

  it('allows spending exactly the balance', () => {
    expect(canSpendCredits({ organization: org({ creditBalance: 400 }), credits: 400 }).allowed).toBe(true);
  });
});

describe('seats and generative allowance', () => {
  it('holds free to a single seat', () => {
    expect(canAddSeat({ plan: free, currentSeats: 1 }).allowed).toBe(false);
    expect(canAddSeat({ plan: pro, currentSeats: 1 }).allowed).toBe(true);
  });

  it('gives no generative seconds to a plan without the entitlement', () => {
    // Launch has a generative limit set but not the entitlement; the
    // entitlement wins, or the limit would silently grant the feature.
    expect(generativeAllowanceSeconds(free)).toBe(0);
    expect(generativeAllowanceSeconds(launch)).toBe(0);
    expect(generativeAllowanceSeconds(pro)).toBeGreaterThan(0);
  });

  it('reports exactly which entitlements a plan is missing', () => {
    expect(missingEntitlements(free, ['render.clean', 'render.4k', 'concepts.generate'])).toEqual([
      'render.clean',
      'render.4k',
    ]);
  });
});
