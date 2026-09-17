import type { Entitlement, Plan } from './billing.ts';
import { hasEntitlement, subscriptionIsLive, withinLimit, type SubscriptionStatus } from './billing.ts';

/**
 * Entitlement decisions, as pure functions.
 *
 * These used to live inside the server modules that call them, which made the
 * most consequential logic in the product — who may spend money, who gets a
 * watermark, whose subscription has lapsed — the only logic with no tests. They
 * are pure here so they can be exercised directly, and so the web app and the
 * worker cannot drift into answering the same question differently.
 */
export type AccessDecision = {
  allowed: boolean;
  /** Shown to the customer. Says what to do, not just what went wrong. */
  reason: string;
  /** Distinguishes "upgrade" from "ask your admin" from "wait". */
  remedy: 'none' | 'upgrade' | 'wait' | 'billing' | 'contact';
};

const ALLOWED: AccessDecision = { allowed: true, reason: '', remedy: 'none' };

export type OrganizationState = {
  planId: string;
  isSuspended: boolean;
  creditBalance: number;
};

export type SubscriptionState = {
  status: SubscriptionStatus;
  planId: string;
} | null;

/**
 * The plan actually in force.
 *
 * A lapsed subscription falls back to free rather than keeping paid features:
 * billing failures must degrade, never grant. The organisation's own planId is
 * only trusted when there is no subscription contradicting it — otherwise a
 * failed payment that never updated the organisation row would keep a customer
 * on Pro indefinitely.
 */
export function effectivePlanId(
  organization: OrganizationState,
  subscription: SubscriptionState,
): string {
  if (!subscription) return organization.planId;
  return subscriptionIsLive(subscription.status) ? subscription.planId : 'free';
}

export function canStartProject(params: {
  plan: Plan;
  organization: OrganizationState;
  projectsThisMonth: number;
}): AccessDecision {
  if (params.organization.isSuspended) {
    return {
      allowed: false,
      reason: 'This workspace is suspended.',
      remedy: 'contact',
    };
  }
  if (!hasEntitlement(params.plan, 'research.run')) {
    return {
      allowed: false,
      reason: `${params.plan.name} cannot start new research.`,
      remedy: 'upgrade',
    };
  }
  if (!withinLimit(params.plan.limits.projectsPerMonth, params.projectsThisMonth)) {
    const limit = params.plan.limits.projectsPerMonth;
    return {
      allowed: false,
      reason: `${params.plan.name} includes ${limit} project${limit === 1 ? '' : 's'} a month.`,
      remedy: 'upgrade',
    };
  }
  return ALLOWED;
}

export type RenderDecision = AccessDecision & { watermarked: boolean };

/**
 * Whether a render may start, and whether it carries a watermark.
 *
 * The watermarked path is deliberately *allowed* rather than blocked: the free
 * tier's whole job is to let somebody see their own film before paying, and a
 * paywall in front of the render is a paywall in front of the only thing that
 * converts.
 */
export function canRender(params: {
  plan: Plan;
  organization: OrganizationState;
  rendersForProject: number;
  durationSeconds: number;
}): RenderDecision {
  if (params.organization.isSuspended) {
    return { allowed: false, watermarked: false, reason: 'This workspace is suspended.', remedy: 'contact' };
  }

  const clean = hasEntitlement(params.plan, 'render.clean');
  if (!clean) {
    return hasEntitlement(params.plan, 'render.watermarked')
      ? {
          allowed: true,
          watermarked: true,
          reason: `${params.plan.name} renders a watermarked preview.`,
          remedy: 'upgrade',
        }
      : {
          allowed: false,
          watermarked: false,
          reason: `${params.plan.name} cannot render.`,
          remedy: 'upgrade',
        };
  }

  if (!withinLimit(params.plan.limits.rendersPerProject, params.rendersForProject)) {
    return {
      allowed: false,
      watermarked: false,
      reason: `${params.plan.name} includes ${params.plan.limits.rendersPerProject} renders per project.`,
      remedy: 'upgrade',
    };
  }

  // Checked before rendering rather than after: a customer should not discover
  // their plan's ceiling from a truncated film.
  if (params.durationSeconds > params.plan.limits.maxMasterDurationSeconds) {
    return {
      allowed: false,
      watermarked: false,
      reason: `${params.plan.name} renders up to ${params.plan.limits.maxMasterDurationSeconds}s; this film is ${Math.round(params.durationSeconds)}s.`,
      remedy: 'upgrade',
    };
  }

  return { ...ALLOWED, watermarked: false };
}

export function canSpendCredits(params: {
  organization: OrganizationState;
  credits: number;
}): AccessDecision {
  if (params.credits <= params.organization.creditBalance) return ALLOWED;
  return {
    allowed: false,
    reason: `This needs ${params.credits.toLocaleString('en-US')} credits and the workspace has ${params.organization.creditBalance.toLocaleString('en-US')}.`,
    remedy: 'billing',
  };
}

export function canAddSeat(params: { plan: Plan; currentSeats: number }): AccessDecision {
  if (withinLimit(params.plan.limits.maxSeats, params.currentSeats)) return ALLOWED;
  return {
    allowed: false,
    reason: `${params.plan.name} includes ${params.plan.limits.maxSeats} seats.`,
    remedy: 'upgrade',
  };
}

/** Generative seconds a plan permits in one film. Zero means authentic only. */
export function generativeAllowanceSeconds(plan: Plan): number {
  if (!hasEntitlement(plan, 'render.generative')) return 0;
  return plan.limits.maxGenerativeSecondsPerFilm;
}

export function missingEntitlements(plan: Plan, required: Entitlement[]): Entitlement[] {
  return required.filter((entitlement) => !hasEntitlement(plan, entitlement));
}
