import { z } from 'zod';
import { urlString, score01, nonEmpty } from '../zod-helpers.ts';
import { Claim, Evidence } from './evidence.ts';

export const ProductMaturity = z.enum(['prelaunch', 'early', 'growth', 'established']);
export type ProductMaturity = z.infer<typeof ProductMaturity>;

export const LaunchContext = z.enum([
  'product_launch',
  'feature_launch',
  'fundraise',
  'homepage_hero',
  'product_hunt',
  'paid_social',
  'linkedin',
  'investor_demo',
  'campaign',
]);
export type LaunchContext = z.infer<typeof LaunchContext>;

/**
 * A concrete, filmable moment inside the product. This is what separates a
 * launch film from a screen recording: we do not film "the dashboard", we film
 * "the moment 40 rows of manual triage collapse into one agent run".
 */
export const ProductMoment = z.object({
  id: z.string(),
  title: nonEmpty(120),
  description: z.string().max(1200),
  /** What the viewer sees before the interaction. */
  startState: z.string().max(600),
  /** What changed. The delta is the story. */
  endState: z.string().max(600),
  screenshots: z.array(z.string()).default([]),
  recording: z.string().nullable().default(null),
  sourceUrl: urlString.nullable().default(null),
  /** How visually arresting this is on a timeline. */
  wowScore: score01.default(0.5),
  /** How central it is to the value proposition. */
  relevanceScore: score01.default(0.5),
  /** Interaction steps the browser agent replayed to reach the end state. */
  interactionSteps: z.array(z.string()).default([]),
  requiresAuth: z.boolean().default(false),
  elementBounds: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable()
    .default(null),
});
export type ProductMoment = z.infer<typeof ProductMoment>;

/** Ranking used by the storyboard engine when choosing what to put on screen. */
export function momentStrength(moment: ProductMoment): number {
  // Relevance is weighted higher than spectacle on purpose: a beautiful shot of
  // an irrelevant feature is the most common way these films go wrong.
  return moment.relevanceScore * 0.62 + moment.wowScore * 0.38;
}

export const ProductUnderstanding = z.object({
  id: z.string(),
  projectId: z.string(),
  name: nonEmpty(120),
  oneLiner: nonEmpty(240),
  category: nonEmpty(120),
  targetAudience: z.array(nonEmpty(160)).default([]),
  painPoints: z.array(Claim).default([]),
  keyBenefits: z.array(Claim).default([]),
  differentiators: z.array(Claim).default([]),
  coreFeatures: z.array(Claim).default([]),
  proofPoints: z.array(Claim).default([]),
  productMoments: z.array(ProductMoment).default([]),
  /** Ids of the moments worth building scenes around, best first. */
  strongestVisualMoments: z.array(z.string()).default([]),
  tone: nonEmpty(200),
  brandTraits: z.array(nonEmpty(60)).default([]),
  competitorCategory: z.string().max(200).default(''),
  productMaturity: ProductMaturity.default('early'),
  launchContext: LaunchContext.default('product_launch'),
  evidence: z.array(Evidence).default([]),
  sources: z.array(urlString).default([]),
  /** Things we looked for and could not establish. Drives "ask only when necessary". */
  gaps: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type ProductUnderstanding = z.infer<typeof ProductUnderstanding>;

export function topMoments(u: ProductUnderstanding, limit: number): ProductMoment[] {
  return [...u.productMoments].sort((a, b) => momentStrength(b) - momentStrength(a)).slice(0, limit);
}

export function findMoment(u: ProductUnderstanding, id: string): ProductMoment | undefined {
  return u.productMoments.find((m) => m.id === id);
}
