import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  planById,
  hasEntitlement,
  withinLimit,
  subscriptionIsLive,
  usdToCredits,
  creditsToUsd,
  grossMargin,
  Entitlement,
} from '../index.ts';

describe('plans', () => {
  it('falls back to free for an unknown plan id', () => {
    expect(planById(DEFAULT_PLANS, 'nope').id).toBe('free');
  });

  it('never lets free render a clean master', () => {
    const free = planById(DEFAULT_PLANS, 'free');
    expect(hasEntitlement(free, 'render.clean')).toBe(false);
    expect(hasEntitlement(free, 'render.watermarked')).toBe(true);
    expect(hasEntitlement(free, 'concepts.generate')).toBe(true);
  });

  it('escalates entitlements monotonically through the paid tiers', () => {
    const tiers = ['launch', 'pro', 'studio'].map((id) => planById(DEFAULT_PLANS, id));
    for (let i = 0; i < tiers.length - 1; i += 1) {
      for (const e of tiers[i]!.entitlements) {
        expect(tiers[i + 1]!.entitlements).toContain(e);
      }
    }
  });

  it('grants studio every entitlement so no feature is unreachable', () => {
    const studio = planById(DEFAULT_PLANS, 'studio');
    for (const e of Entitlement.options) expect(studio.entitlements).toContain(e);
  });
});

describe('limits', () => {
  it('treats -1 as unlimited', () => {
    expect(withinLimit(-1, 9999)).toBe(true);
    expect(withinLimit(3, 2)).toBe(true);
    expect(withinLimit(3, 3)).toBe(false);
  });
});

describe('subscription status', () => {
  it('only grants access while active or trialing', () => {
    expect(subscriptionIsLive('active')).toBe(true);
    expect(subscriptionIsLive('trialing')).toBe(true);
    expect(subscriptionIsLive('past_due')).toBe(false);
    expect(subscriptionIsLive('canceled')).toBe(false);
  });
});

describe('credits', () => {
  it('charges at least one credit and applies the margin multiplier', () => {
    expect(usdToCredits(0)).toBe(1);
    expect(usdToCredits(1, 3.2)).toBe(160);
    expect(creditsToUsd(160)).toBeCloseTo(3.2);
  });

  it('computes gross margin from credits charged against real provider cost', () => {
    const m = grossMargin([
      { actualCostUsd: 1, creditsCharged: 160 },
      { actualCostUsd: 0.5, creditsCharged: 80 },
    ]);
    expect(m.costUsd).toBeCloseTo(1.5);
    expect(m.revenueUsd).toBeCloseTo(4.8);
    expect(m.marginPct).toBeCloseTo(0.6875);
  });
});
