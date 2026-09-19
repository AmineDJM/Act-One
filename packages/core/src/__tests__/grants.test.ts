import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  INTERNAL_PLAN,
  PlanLimitGrants,
  canRender,
  canSpendCredits,
  effectivePlan,
  planById,
  withGrants,
  type Organization,
} from '../index.ts';

/**
 * What an operator may grant one workspace.
 *
 * A plan is a product and a customer is a person. A deal, a pilot, an apology,
 * a friend of the company: each is a limit lifted for exactly one workspace,
 * and the alternative — a plan per customer — makes a price list unreadable.
 *
 * The thing to be careful about is the shape of "no grant". An empty grant has
 * to mean *nothing*, and the obvious spelling of it did not: `PlanLimits` has
 * a default on every field, Zod applies defaults before optionality, and
 * `PlanLimits.partial().parse({})` therefore returns all eight numbers. Every
 * workspace in the product would have been silently granted the schema's own
 * limits over its plan's — sixty seconds where free sells thirty.
 */

function workspace(over: Partial<Organization> = {}): Organization {
  return {
    id: 'org_1', name: 'Probe', slug: 'probe', planId: 'free', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 120, isSuspended: false,
    limitOverrides: {}, extraEntitlements: [], isInternal: false,
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

const planFor = (organization: Organization) =>
  effectivePlan({ plans: DEFAULT_PLANS, organization, subscription: null });

describe('no grant means no grant', () => {
  it('parses an empty grant as empty, rather than as every default', () => {
    // The bug this file exists for. `PlanLimits.partial().parse({})` returns
    // all eight fields; this must return none.
    expect(PlanLimitGrants.parse({})).toEqual({});
    expect(Object.keys(PlanLimitGrants.parse({}))).toHaveLength(0);
  });

  it('leaves a plan exactly as the catalogue sells it', () => {
    const free = planById(DEFAULT_PLANS, 'free');
    expect(planFor(workspace()).limits).toEqual(free.limits);
    expect(planFor(workspace()).limits.maxMasterDurationSeconds).toBe(30);
  });

  it('does not let a key with no value wipe the plan behind it', () => {
    const plan = planById(DEFAULT_PLANS, 'free');
    const wiped = withGrants(plan, {
      limitOverrides: { maxSeats: undefined, maxMasterDurationSeconds: 240 },
    });
    expect(wiped.limits.maxSeats).toBe(plan.limits.maxSeats);
    expect(wiped.limits.maxMasterDurationSeconds).toBe(240);
  });
});

describe('lifting one limit', () => {
  it('lifts the one, and only the one', () => {
    const free = planById(DEFAULT_PLANS, 'free');
    const granted = planFor(workspace({ limitOverrides: { maxMasterDurationSeconds: 240 } }));
    expect(granted.limits.maxMasterDurationSeconds).toBe(240);
    expect(granted.limits.maxSeats).toBe(free.limits.maxSeats);
    expect(granted.limits.projectsPerMonth).toBe(free.limits.projectsPerMonth);
  });

  it('reaches the thing that actually refuses the render', () => {
    const asked = { rendersForProject: 0, durationSeconds: 90 };
    const plain = workspace();
    const lifted = workspace({ limitOverrides: { maxMasterDurationSeconds: 240 } });

    expect(canRender({ plan: planFor(plain), organization: plain, ...asked }).allowed).toBe(false);
    expect(canRender({ plan: planFor(lifted), organization: lifted, ...asked }).allowed).toBe(true);
  });

  it('grants a feature the plan does not sell', () => {
    const granted = planFor(workspace({ extraEntitlements: ['render.4k'] }));
    expect(granted.entitlements).toContain('render.4k');
    // And does not take away what the plan did sell.
    expect(granted.entitlements).toContain('render.watermarked');
  });

  it('survives an upgrade and a lapse, because it was given for a reason', () => {
    const organization = workspace({
      planId: 'studio',
      limitOverrides: { maxMasterDurationSeconds: 900 },
    });
    // A lapsed subscription falls to free, and the grant is still there: a
    // limit lifted by hand was lifted for a reason, and a failed card is not
    // that reason.
    const lapsed = effectivePlan({
      plans: DEFAULT_PLANS,
      organization,
      subscription: { planId: 'studio', status: 'past_due' },
    });
    expect(lapsed.id).toBe('free');
    expect(lapsed.limits.maxMasterDurationSeconds).toBe(900);
  });
});

describe('the workspace the operator runs', () => {
  it('is not held to the plan the rest of the product is sold on', () => {
    // The complaint this was built for: the person who owns the platform,
    // told by their own software that their film may not exceed thirty
    // seconds, because an unbilled workspace has no subscription and falls to
    // free like anybody else.
    const mine = workspace({ isInternal: true });
    expect(planFor(mine)).toBe(INTERNAL_PLAN);
    expect(planFor(mine).limits.maxMasterDurationSeconds).toBeGreaterThan(600);
    expect(
      canRender({ plan: planFor(mine), organization: mine, rendersForProject: 40, durationSeconds: 600 }).allowed,
    ).toBe(true);
  });

  it('is not reachable by a lapsed subscription or a suspended flag being wrong', () => {
    const mine = workspace({ isInternal: true, planId: 'free' });
    const lapsed = effectivePlan({
      plans: DEFAULT_PLANS,
      organization: mine,
      subscription: { planId: 'studio', status: 'canceled' },
    });
    expect(lapsed).toBe(INTERNAL_PLAN);
    // Suspension still stops it: internal is about billing, not about safety.
    const suspended = workspace({ isInternal: true, isSuspended: true });
    expect(
      canRender({ plan: INTERNAL_PLAN, organization: suspended, rendersForProject: 0, durationSeconds: 20 }).allowed,
    ).toBe(false);
  });

  it('is not in the catalogue, so nobody can buy it', () => {
    expect(DEFAULT_PLANS.some((plan) => plan.id === INTERNAL_PLAN.id)).toBe(false);
    expect(INTERNAL_PLAN.isPublic).toBe(false);
  });

  it('is not stopped by a credit balance it was never sold', () => {
    // The ledger is what a customer buys from us. The operator buys nothing
    // from themselves, so an empty one there is not a decision about money.
    const mine = workspace({ isInternal: true });
    const customer = workspace();
    expect(canSpendCredits({ organization: mine, credits: 4000 }).allowed).toBe(true);
    const refused = canSpendCredits({ organization: customer, credits: 4000 });
    expect(refused.allowed).toBe(false);
    expect(refused.remedy).toBe('billing');
  });
});
