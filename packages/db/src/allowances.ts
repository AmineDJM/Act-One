import {
  allowanceKey,
  allowancePeriodAt,
  allowancePeriodsDue,
  planAllowance,
  planById,
  subscriptionIsLive,
  upgradeKey,
  withGrants,
  type Plan,
} from '@act-one/core';
import type { Store } from './store.ts';

export type AllowanceOutcome = {
  /** Periods actually granted by this call. */
  periods: string[];
  creditsAdded: number;
  /** Why nothing was granted, when nothing was. */
  reason: 'granted' | 'nothing_due' | 'no_subscription' | 'not_live' | 'internal' | 'no_allowance';
};

/**
 * Gives a workspace every allowance period it is owed and has not been given.
 *
 * The allowance used to ride on the Stripe invoice that collected money, which
 * made "how often are you billed" and "how often do you get credits" the same
 * question. They are not: an annual subscriber pays once and is still promised
 * their credits every month, and for as long as those were the same thing that
 * customer got one month of credits for the year.
 *
 * So the allowance is computed from the subscription's own anniversary and
 * written under a key built from the period. Running this twice, running it
 * while a webhook runs it, running it from the hourly tick and from the
 * invoice that triggered it — all land on the same key, and the ledger takes
 * the first and refuses the rest.
 *
 * Cheap to call: a workspace with nothing due does one read.
 */
export async function grantDueAllowances(params: {
  store: Store;
  organizationId: string;
  plans: Plan[];
  now?: string;
  maxPeriods?: number;
}): Promise<AllowanceOutcome> {
  const { store, organizationId, plans } = params;
  const now = params.now ?? new Date().toISOString();
  const nothing = (reason: AllowanceOutcome['reason']): AllowanceOutcome => ({
    periods: [],
    creditsAdded: 0,
    reason,
  });

  const organization = await store.organizations.get(organizationId);
  if (!organization) return nothing('no_subscription');

  // The operator's own workspace is not sold anything, so it is owed nothing.
  // Its credit gate is bypassed elsewhere; an allowance here would be a
  // meaningless number growing in a ledger nobody bills.
  if (organization.isInternal) return nothing('internal');

  const subscription = await store.subscriptions.getForOrganization(organizationId);
  if (!subscription) return nothing('no_subscription');
  // A lapsed subscription buys nothing. Credits already given are kept — they
  // were paid for — but no new period is owed.
  if (!subscriptionIsLive(subscription.status)) return nothing('not_live');

  const plan = withGrants(planById(plans, subscription.planId), organization);
  const allowance = planAllowance(plan);

  const due = allowancePeriodsDue({
    startedAt: subscription.createdAt,
    interval: allowance.interval,
    now,
    since: subscription.allowanceGrantedThrough,
    ...(params.maxPeriods === undefined ? {} : { maxPeriods: params.maxPeriods }),
  });
  if (due.length === 0) return nothing('nothing_due');

  const granted: string[] = [];
  let creditsAdded = 0;
  for (const period of due) {
    if (allowance.amount > 0) {
      const posting = await store.creditLedger.post({
        organizationId,
        kind: 'allowance',
        delta: allowance.amount,
        sourceKey: allowanceKey(subscription.id, period),
        description: `${plan.name} allowance for ${period}`,
        planId: plan.id,
        subscriptionId: subscription.id,
        periodKey: period,
      });
      if (posting.applied) creditsAdded += allowance.amount;
    }
    granted.push(period);
  }

  /*
   * The marker moves whether or not anything was posted.
   *
   * A plan with no allowance still passes its periods — otherwise every call
   * would re-evaluate the same months forever — and a period the ledger
   * refused as a duplicate was, by definition, already given.
   */
  const through = granted[granted.length - 1]!;
  await store.subscriptions.upsert({
    ...subscription,
    allowanceGrantedThrough: through,
    updatedAt: now,
  });

  if (allowance.amount === 0) return nothing('no_allowance');
  return { periods: granted, creditsAdded, reason: 'granted' };
}

/**
 * Tops a workspace up when it moves to a bigger plan mid-period.
 *
 * Without this, upgrading on the 11th buys the new plan's features and the old
 * plan's credits until the next anniversary — the customer paid more and can
 * do less work this month than the pricing page says. Only the difference, only
 * upwards, and keyed so the same upgrade cannot pay twice.
 *
 * A downgrade takes nothing back. Credits already given were given.
 */
export async function grantUpgradeDifference(params: {
  store: Store;
  organizationId: string;
  plans: Plan[];
  previousPlanId: string;
  now?: string;
}): Promise<{ credited: number; period: string | null }> {
  const { store, organizationId, plans } = params;
  const now = params.now ?? new Date().toISOString();

  const organization = await store.organizations.get(organizationId);
  if (!organization || organization.isInternal) return { credited: 0, period: null };

  const subscription = await store.subscriptions.getForOrganization(organizationId);
  if (!subscription || !subscriptionIsLive(subscription.status)) return { credited: 0, period: null };
  if (subscription.planId === params.previousPlanId) return { credited: 0, period: null };

  const next = planAllowance(withGrants(planById(plans, subscription.planId), organization));
  const previous = planAllowance(withGrants(planById(plans, params.previousPlanId), organization));
  const difference = next.amount - previous.amount;
  if (difference <= 0) return { credited: 0, period: null };

  const period = allowancePeriodAt({
    startedAt: subscription.createdAt,
    interval: next.interval,
    at: now,
  });
  if (!period) return { credited: 0, period: null };

  const posting = await store.creditLedger.post({
    organizationId,
    kind: 'allowance',
    delta: difference,
    sourceKey: upgradeKey(subscription.id, period, subscription.planId),
    description: `Upgrade to ${subscription.planId}: the rest of ${period}`,
    planId: subscription.planId,
    subscriptionId: subscription.id,
    periodKey: period,
  });

  return { credited: posting.applied ? difference : 0, period };
}

/**
 * Runs the accrual for every workspace that could be owed one.
 *
 * Called from the worker's clock. An annual subscriber generates no Stripe
 * event for eleven months of the year, so nothing else would ever notice that
 * their monthly credits are due.
 */
export async function grantAllowancesForEveryone(params: {
  store: Store;
  plans: Plan[];
  now?: string;
  limit?: number;
}): Promise<{ workspaces: number; creditsAdded: number }> {
  const subscriptions = await params.store.subscriptions.list(params.limit ?? 500);
  let workspaces = 0;
  let creditsAdded = 0;
  for (const subscription of subscriptions) {
    if (!subscriptionIsLive(subscription.status)) continue;
    const outcome = await grantDueAllowances({
      store: params.store,
      organizationId: subscription.organizationId,
      plans: params.plans,
      ...(params.now === undefined ? {} : { now: params.now }),
    });
    if (outcome.creditsAdded > 0) {
      workspaces += 1;
      creditsAdded += outcome.creditsAdded;
    }
  }
  return { workspaces, creditsAdded };
}
