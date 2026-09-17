import {
  DEFAULT_PLANS,
  Plan,
  effectivePlan,
  hasEntitlement,
  masterQualityFor,
  type Entitlement,
  type RenderQuality,
} from '@act-one/core';
import type { Store } from '@act-one/db';

/**
 * What this organisation's plan entitles it to, resolved in the worker.
 *
 * The worker asks rather than trusting the job payload. A render's watermark
 * and its resolution are the two things a customer is actually paying for, and
 * a job that sat in the queue while a subscription lapsed must not still be
 * carrying the answer from when it was enqueued.
 */
export async function planFor(store: Store, organizationId: string): Promise<Plan> {
  const organization = await store.organizations.get(organizationId);
  if (!organization) return DEFAULT_PLANS.find((plan) => plan.id === 'free') ?? DEFAULT_PLANS[0]!;

  const settings = await store.platform.getSettings();
  const parsed = Plan.array().safeParse(settings.plans);
  // An unreadable or empty catalogue falls back to the seeded one: a platform
  // with no plans would otherwise deny every entitlement to every customer.
  const plans = parsed.success && parsed.data.length > 0 ? parsed.data : DEFAULT_PLANS;

  const subscription = await store.subscriptions.getForOrganization(organizationId);
  return effectivePlan({
    plans,
    organization,
    subscription: subscription
      ? { planId: subscription.planId, status: subscription.status }
      : null,
  });
}

/** How a master should be rendered for this plan: clean or watermarked, HD or 4K. */
export function masterTermsFor(plan: Plan): { quality: RenderQuality; watermarked: boolean } {
  return {
    quality: masterQualityFor(plan),
    watermarked: !hasEntitlement(plan, 'render.clean'),
  };
}

export function planAllows(plan: Plan, entitlement: Entitlement): boolean {
  return hasEntitlement(plan, entitlement);
}
