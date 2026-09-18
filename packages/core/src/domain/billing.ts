import { z } from 'zod';
import type { Organization } from './org.ts';

/**
 * Entitlements, not plan-name checks.
 *
 * Plan names change with every pricing experiment; features should never be
 * gated on `plan === 'pro'` anywhere in the codebase. Super Admin edits the
 * plan -> entitlement mapping, and the app only ever asks about entitlements.
 */
export const Entitlement = z.enum([
  'research.run',
  'brand.extract',
  'concepts.generate',
  'storyboard.preview',
  'storyboard.full',
  'render.watermarked',
  'render.clean',
  'render.1080p',
  'render.4k',
  'render.generative',
  'render.threed',
  'variants.basic',
  'variants.campaign',
  'voice.synthetic',
  /** Finals read by the premium engine; without it, the preview voice reads everything. */
  'voice.premium',
  /** Alternative reads of each passage, chosen by QA and offered to the customer. */
  'voice.takes',
  /** A brand voice: one narrator kept across every film and cut. */
  'voice.brand',
  /** Cloning a person's voice, under recorded consent. */
  'voice.clone',
  /** Audio editions: a written piece adapted, read and mastered for listening. */
  'audio.editions',
  /** The same film produced again in another language, written and read natively. */
  'film.languages',
  'formats.vertical',
  'formats.all',
  'team.members',
  'team.approvals',
  'brands.multiple',
  'api.access',
  'product.credentials',
  'revisions.unlimited',
]);
export type Entitlement = z.infer<typeof Entitlement>;

export const PlanLimits = z.object({
  /** -1 means unlimited. */
  projectsPerMonth: z.number().int().default(1),
  rendersPerProject: z.number().int().default(1),
  /** Changes asked for after the storyboard exists. -1 means unlimited. */
  revisionsPerProject: z.number().int().default(1),
  maxMasterDurationSeconds: z.number().int().default(60),
  maxSeats: z.number().int().default(1),
  maxBrands: z.number().int().default(1),
  monthlyCredits: z.number().int().default(0),
  maxGenerativeSecondsPerFilm: z.number().int().default(0),
});
export type PlanLimits = z.infer<typeof PlanLimits>;

export const Plan = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  /** Cents, so we never do float money. */
  monthlyPriceCents: z.number().int().min(0).default(0),
  yearlyPriceCents: z.number().int().min(0).default(0),
  stripeMonthlyPriceId: z.string().nullable().default(null),
  stripeYearlyPriceId: z.string().nullable().default(null),
  entitlements: z.array(Entitlement).default([]),
  limits: PlanLimits,
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type Plan = z.infer<typeof Plan>;

/**
 * Default catalogue. Editable in Super Admin at runtime — this is the seed,
 * not the source of truth once the product is live.
 */
export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Understand the product, see the brand, get three concepts.',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    entitlements: [
      'research.run',
      'brand.extract',
      'concepts.generate',
      'storyboard.preview',
      'render.watermarked',
    ],
    limits: {
      projectsPerMonth: 2,
      /*
       * One watermarked render, which is what the pricing page sells and what
       * the free tier is for: seeing your own film. This said 0 — a number
       * that never mattered because `canRender` returned before reading it for
       * any plan without a clean render, so free had no limits at all rather
       * than none it could use.
       */
      rendersPerProject: 1,
      revisionsPerProject: 1,
      maxMasterDurationSeconds: 30,
      maxSeats: 1,
      maxBrands: 1,
      monthlyCredits: 0,
      maxGenerativeSecondsPerFilm: 0,
    },
    isPublic: true,
    sortOrder: 0,
  },
  {
    id: 'launch',
    name: 'Launch',
    description: 'One master film, cut for every channel you are launching on.',
    monthlyPriceCents: 49_000,
    yearlyPriceCents: 0,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    entitlements: [
      'research.run',
      'brand.extract',
      'concepts.generate',
      'storyboard.preview',
      'storyboard.full',
      'render.clean',
      'render.1080p',
      'render.threed',
      'variants.basic',
      'formats.vertical',
      'voice.synthetic',
      'voice.premium',
      'product.credentials',
    ],
    limits: {
      projectsPerMonth: 1,
      rendersPerProject: 3,
      revisionsPerProject: 3,
      maxMasterDurationSeconds: 75,
      maxSeats: 3,
      maxBrands: 1,
      monthlyCredits: 400,
      maxGenerativeSecondsPerFilm: 10,
    },
    isPublic: true,
    sortOrder: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Ongoing launches, full campaign cuts, generative cinematography.',
    monthlyPriceCents: 149_000,
    yearlyPriceCents: 1_490_000,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    entitlements: [
      'research.run',
      'brand.extract',
      'concepts.generate',
      'storyboard.preview',
      'storyboard.full',
      'render.clean',
      'render.1080p',
      'render.4k',
      'render.generative',
      'render.threed',
      'variants.basic',
      'variants.campaign',
      'formats.all',
      'formats.vertical',
      'voice.synthetic',
      'voice.premium',
      'voice.takes',
      'voice.brand',
      'audio.editions',
      'film.languages',
      'product.credentials',
      'revisions.unlimited',
      'team.members',
    ],
    limits: {
      projectsPerMonth: 4,
      rendersPerProject: 10,
      revisionsPerProject: -1,
      maxMasterDurationSeconds: 120,
      maxSeats: 8,
      maxBrands: 3,
      monthlyCredits: 2000,
      maxGenerativeSecondsPerFilm: 20,
    },
    isPublic: true,
    sortOrder: 2,
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'Teams, multiple brands, approval workflow, bulk campaigns.',
    monthlyPriceCents: 449_000,
    yearlyPriceCents: 4_490_000,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    entitlements: Entitlement.options,
    limits: {
      projectsPerMonth: -1,
      rendersPerProject: -1,
      revisionsPerProject: -1,
      maxMasterDurationSeconds: 180,
      maxSeats: 25,
      maxBrands: 15,
      monthlyCredits: 8000,
      maxGenerativeSecondsPerFilm: 40,
    },
    isPublic: true,
    sortOrder: 3,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom.',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    entitlements: Entitlement.options,
    limits: {
      projectsPerMonth: -1,
      rendersPerProject: -1,
      revisionsPerProject: -1,
      maxMasterDurationSeconds: 600,
      maxSeats: -1,
      maxBrands: -1,
      monthlyCredits: 40000,
      maxGenerativeSecondsPerFilm: 120,
    },
    isPublic: false,
    sortOrder: 4,
  },
];

export function planById(plans: Plan[], id: string): Plan {
  return plans.find((p) => p.id === id) ?? plans.find((p) => p.id === 'free') ?? plans[0]!;
}

export function hasEntitlement(plan: Plan, entitlement: Entitlement): boolean {
  return plan.entitlements.includes(entitlement);
}

export function withinLimit(limit: number, current: number): boolean {
  return limit < 0 || current < limit;
}

export const SubscriptionStatus = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'none',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const Subscription = z.object({
  id: z.string(),
  organizationId: z.string(),
  planId: z.string(),
  status: SubscriptionStatus,
  stripeSubscriptionId: z.string().nullable().default(null),
  stripeCustomerId: z.string().nullable().default(null),
  currentPeriodEnd: z.string().nullable().default(null),
  cancelAtPeriodEnd: z.boolean().default(false),
  seats: z.number().int().min(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Subscription = z.infer<typeof Subscription>;

/** A plan grants entitlements only while the subscription is in good standing. */
export function subscriptionIsLive(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * The plan an organisation is actually entitled to right now.
 *
 * One definition, because two would drift: the web layer answers this to decide
 * what to offer, and the worker answers it to decide what to make. If the
 * worker were more generous than the page, we would render something nobody
 * bought; if it were meaner, somebody would pay for 4K and get 1080p.
 *
 * A lapsed subscription falls back to free rather than keeping paid features.
 * Billing failures must degrade, not grant.
 */
export function effectivePlan(params: {
  plans: Plan[];
  organization: Pick<Organization, 'planId'>;
  subscription: { planId: string; status: SubscriptionStatus } | null;
}): Plan {
  const { plans, organization, subscription } = params;
  if (subscription && !subscriptionIsLive(subscription.status)) return planById(plans, 'free');
  return planById(plans, subscription ? subscription.planId : organization.planId);
}

/**
 * The resolution a plan is owed for its master.
 *
 * Pro sells 4K and the renderer used to hardcode 1080p, so the most expensive
 * plan delivered exactly what the one below it did.
 */
export function masterQualityFor(plan: Plan): 'hd' | 'uhd' {
  return hasEntitlement(plan, 'render.4k') ? 'uhd' : 'hd';
}
