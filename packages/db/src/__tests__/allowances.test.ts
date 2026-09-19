import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  allowanceKey,
  allowancePeriodsDue,
  newId,
  planAllowance,
  planById,
  type NewOrganization,
  type Plan,
  type Subscription,
} from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';
import { grantAllowancesForEveryone, grantDueAllowances, grantUpgradeDifference } from '../allowances.ts';

/**
 * What a plan gives, against how often it is paid for.
 *
 * These were the same thing by accident: the allowance rode on the Stripe
 * invoice that collected money, so an annual subscriber paid once and was
 * given one month of credits for the year, and a customer sold "2,000 a
 * month" got 2,000 once, on the day they signed up, and never again.
 *
 * Every case below is a moment where the two diverge, plus the one rule that
 * has to hold under all of them: an allocation happens exactly once, whoever
 * asks for it and however many times.
 */
const JANUARY = '2026-01-15T09:00:00.000Z';

function org(over: Partial<NewOrganization> = {}): NewOrganization {
  return {
    id: newId('org'), name: 'Acme', slug: `acme-${newId('org').slice(-8)}`, planId: 'free',
    stripeCustomerId: null, creditBalance: 0, maxProjectCostUsd: 120, isSuspended: false,
    createdAt: JANUARY, ...over,
  };
}

function subscription(organizationId: string, over: Partial<Subscription> = {}): Subscription {
  return {
    id: newId('inv'),
    organizationId,
    planId: 'pro',
    status: 'active',
    stripeSubscriptionId: `sub_${newId('inv').slice(-8)}`,
    stripeCustomerId: 'cus_acme',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    seats: 1,
    billingInterval: 'monthly',
    allowanceGrantedThrough: null,
    createdAt: JANUARY,
    updatedAt: JANUARY,
    ...over,
  };
}

async function workspace(store: MemoryStore, over: Partial<NewOrganization> = {}) {
  return store.organizations.create(org(over));
}

const plans: Plan[] = DEFAULT_PLANS;
const proAmount = planAllowance(planById(DEFAULT_PLANS, 'pro')).amount;

describe('the periods a subscription is owed', () => {
  it('counts anniversaries, not calendar months', () => {
    const due = allowancePeriodsDue({
      startedAt: '2026-01-31T00:00:00.000Z',
      interval: 'monthly',
      now: '2026-04-30T00:00:00.000Z',
      since: '2026-01-31',
    });
    // February has no 31st: the anniversary clamps and does not roll into
    // March, which is how one customer would get thirteen top-ups in a year.
    expect(due).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('owes a subscription with nothing granted only the period it is in', () => {
    const due = allowancePeriodsDue({
      startedAt: '2025-01-15T00:00:00.000Z',
      interval: 'monthly',
      now: JANUARY,
      since: null,
    });
    // Not thirteen months of back-credits on the first run after deploying.
    expect(due).toEqual(['2026-01-15']);
  });

  it('caps a long gap rather than minting a decade of credits', () => {
    const due = allowancePeriodsDue({
      startedAt: '2016-01-15T00:00:00.000Z',
      interval: 'monthly',
      now: JANUARY,
      since: '2016-01-15',
      maxPeriods: 12,
    });
    expect(due).toHaveLength(12);
    expect(due[due.length - 1]).toBe('2026-01-15');
  });

  it('gives an annual allowance one period a year', () => {
    const due = allowancePeriodsDue({
      startedAt: '2024-03-01T00:00:00.000Z',
      interval: 'annual',
      now: '2026-06-01T00:00:00.000Z',
      since: '2024-03-01',
    });
    expect(due).toEqual(['2025-03-01', '2026-03-01']);
  });
});

describe('the allowance, through a subscription’s life', () => {
  it('gives a monthly subscriber their credits every month', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id));

    const first = await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    expect(first.creditsAdded).toBe(proAmount);
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);

    // A month later, the next period.
    const second = await grantDueAllowances({
      store, organizationId: acme.id, plans, now: '2026-02-15T09:00:00.000Z',
    });
    expect(second.periods).toEqual(['2026-02-15']);
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount * 2);
  });

  it('gives an annual subscriber their credits every month, not once a year', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { billingInterval: 'annual' }));

    await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    // Five months of paying annually, and no Stripe event in between.
    for (const month of ['02', '03', '04', '05', '06']) {
      await grantDueAllowances({
        store, organizationId: acme.id, plans, now: `2026-${month}-15T09:00:00.000Z`,
      });
    }
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount * 6);
  });

  it('pools a year at once when the plan actually says so', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { planId: 'pooled' }));
    const pooled: Plan[] = [
      ...plans,
      {
        ...planById(plans, 'pro'),
        id: 'pooled',
        name: 'Pooled',
        // The product definition, stated rather than derived from the invoice.
        allowance: { interval: 'annual', amount: 24_000 },
      },
    ];

    await grantDueAllowances({ store, organizationId: acme.id, plans: pooled, now: JANUARY });
    await grantDueAllowances({
      store, organizationId: acme.id, plans: pooled, now: '2026-06-15T09:00:00.000Z',
    });
    // One lump, and June is inside the same year — nothing more is owed.
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(24_000);
  });

  it('never grants the same period twice, however many times it is asked', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    const sub = await store.subscriptions.upsert(subscription(acme.id));

    // The invoice, the worker's clock and a replayed webhook, all at once.
    await Promise.all([
      grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY }),
      grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY }),
      grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY }),
    ]);
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);

    const entries = await store.creditLedger.listForOrganization(acme.id);
    expect(entries.filter((entry) => entry.kind === 'allowance')).toHaveLength(1);
    expect(entries[0]?.sourceKey).toBe(allowanceKey(sub.id, '2026-01-15'));
  });

  it('tops up the difference when a workspace moves up mid-period, once', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { planId: 'launch' }));
    await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    const launchAmount = planAllowance(planById(plans, 'launch')).amount;
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(launchAmount);

    const existing = (await store.subscriptions.getForOrganization(acme.id))!;
    await store.subscriptions.upsert({ ...existing, planId: 'pro' });

    const upgrade = await grantUpgradeDifference({
      store, organizationId: acme.id, plans, previousPlanId: 'launch', now: '2026-01-20T09:00:00.000Z',
    });
    expect(upgrade.credited).toBe(proAmount - launchAmount);
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);

    // The same upgrade seen again pays nothing.
    const again = await grantUpgradeDifference({
      store, organizationId: acme.id, plans, previousPlanId: 'launch', now: '2026-01-25T09:00:00.000Z',
    });
    expect(again.credited).toBe(0);
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);
  });

  it('takes nothing back on a downgrade', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { planId: 'pro' }));
    await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });

    const existing = (await store.subscriptions.getForOrganization(acme.id))!;
    await store.subscriptions.upsert({ ...existing, planId: 'launch' });
    const down = await grantUpgradeDifference({
      store, organizationId: acme.id, plans, previousPlanId: 'pro', now: '2026-01-20T09:00:00.000Z',
    });

    expect(down.credited).toBe(0);
    // Credits already given were paid for.
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);
  });

  it('owes nothing while a subscription is past due, and resumes when it recovers', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { status: 'past_due' }));

    const refused = await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    expect(refused.reason).toBe('not_live');
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(0);

    const existing = (await store.subscriptions.getForOrganization(acme.id))!;
    await store.subscriptions.upsert({ ...existing, status: 'active' });
    const recovered = await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    expect(recovered.creditsAdded).toBe(proAmount);
  });

  it('stops at cancellation and leaves the balance alone', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id));
    await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });

    const existing = (await store.subscriptions.getForOrganization(acme.id))!;
    await store.subscriptions.upsert({ ...existing, status: 'canceled' });
    const after = await grantDueAllowances({
      store, organizationId: acme.id, plans, now: '2026-02-15T09:00:00.000Z',
    });

    expect(after.reason).toBe('not_live');
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(proAmount);
  });

  it('owes the operator’s own workspace nothing', async () => {
    const store = new MemoryStore();
    const ours = await workspace(store, { isInternal: true });
    await store.subscriptions.upsert(subscription(ours.id));

    const outcome = await grantDueAllowances({ store, organizationId: ours.id, plans, now: JANUARY });
    expect(outcome.reason).toBe('internal');
    expect((await store.organizations.get(ours.id))?.creditBalance).toBe(0);
  });

  it('gives a free workspace nothing, and does not re-ask every time', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store);
    await store.subscriptions.upsert(subscription(acme.id, { planId: 'free' }));

    const outcome = await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    expect(outcome.reason).toBe('no_allowance');
    expect((await store.organizations.get(acme.id))?.creditBalance).toBe(0);
    // The marker still moved, or this would be re-evaluated forever.
    expect((await store.subscriptions.getForOrganization(acme.id))?.allowanceGrantedThrough).toBe('2026-01-15');
  });

  it('honours a monthly allowance an operator lifted for one workspace', async () => {
    const store = new MemoryStore();
    const acme = await workspace(store, { limitOverrides: { monthlyCredits: 9_000 } });
    await store.subscriptions.upsert(subscription(acme.id));

    const outcome = await grantDueAllowances({ store, organizationId: acme.id, plans, now: JANUARY });
    expect(outcome.creditsAdded).toBe(9_000);
  });

  it('runs for everyone on the clock, and skips the ones that owe nothing', async () => {
    const store = new MemoryStore();
    const paying = await workspace(store, { name: 'Paying' });
    const lapsed = await workspace(store, { name: 'Lapsed' });
    await store.subscriptions.upsert(subscription(paying.id));
    await store.subscriptions.upsert(subscription(lapsed.id, { status: 'canceled' }));

    const outcome = await grantAllowancesForEveryone({ store, plans, now: JANUARY });
    expect(outcome).toEqual({ workspaces: 1, creditsAdded: proAmount });
    expect((await store.organizations.get(lapsed.id))?.creditBalance).toBe(0);
  });
});
