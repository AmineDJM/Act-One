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
      reason: `${params.plan.name} includes ${plural(limit, 'project')} a month.`,
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
  const watermarked = !clean;

  if (!clean && !hasEntitlement(params.plan, 'render.watermarked')) {
    return {
      allowed: false,
      watermarked: false,
      reason: `${params.plan.name} cannot render.`,
      remedy: 'upgrade',
    };
  }

  /*
   * The limits below apply to every plan.
   *
   * This used to return early for any plan without `render.clean`, so a free
   * customer was checked for neither. The pricing page advertised two renders
   * a month and a thirty-second ceiling, and a free account rendered a
   * forty-eight second film — whether the output carries a watermark is a
   * different question from whether the render is allowed at all, and
   * conflating them meant the cheapest plan was the only one with no limits.
   */
  if (!withinLimit(params.plan.limits.rendersPerProject, params.rendersForProject)) {
    return {
      allowed: false,
      watermarked,
      reason: `${params.plan.name} includes ${plural(params.plan.limits.rendersPerProject, 'render')} per project.`,
      remedy: 'upgrade',
    };
  }

  // Checked before rendering rather than after: a customer should not discover
  // their plan's ceiling from a truncated film.
  if (params.durationSeconds > params.plan.limits.maxMasterDurationSeconds) {
    return {
      allowed: false,
      watermarked,
      reason: `${params.plan.name} renders up to ${params.plan.limits.maxMasterDurationSeconds}s; this film is ${Math.round(params.durationSeconds)}s.`,
      remedy: 'upgrade',
    };
  }

  return {
    ...ALLOWED,
    watermarked,
    ...(watermarked
      ? { reason: `${params.plan.name} renders a watermarked preview.`, remedy: 'upgrade' as const }
      : {}),
  };
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
    reason: `${params.plan.name} includes ${plural(params.plan.limits.maxSeats, 'seat')}.`,
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

/**
 * A count with its noun, pluralised.
 *
 * These strings are shown to a customer at the moment they are being told no,
 * which is the worst possible moment to look careless — "Free includes 1
 * renders per project" was on screen next to a disabled button.
 */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Whether one more revision may be asked for on this project.
 *
 * A revision is a change requested once a storyboard exists — "the opening
 * holds too long", "remove the voice-over" — and each one is work and, after
 * the film exists, a re-render. Plans include a number of them; the plans that
 * sell unlimited revisions say so with the entitlement, and the limit agrees.
 */
export function canRevise(params: {
  plan: Plan;
  organization: OrganizationState;
  revisionsUsed: number;
}): AccessDecision & { limit: number } {
  const limit = hasEntitlement(params.plan, 'revisions.unlimited')
    ? -1
    : params.plan.limits.revisionsPerProject;
  if (params.organization.isSuspended) {
    return { allowed: false, reason: 'This workspace is suspended.', remedy: 'contact', limit };
  }
  if (!withinLimit(limit, params.revisionsUsed)) {
    return {
      allowed: false,
      reason: `${params.plan.name} includes ${plural(limit, 'revision')} per project, and this one has had ${params.revisionsUsed}.`,
      remedy: 'upgrade',
      limit,
    };
  }
  return { ...ALLOWED, limit };
}
