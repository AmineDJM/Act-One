import { z } from 'zod';
import { urlString, nonEmpty } from '../zod-helpers.ts';
import { CreativeMode, Channel, VoiceStrategy } from './creative.ts';
import { AspectRatio } from './render.ts';
import { LaunchContext } from './product.ts';

/**
 * The project pipeline state. Exactly one of these is true at a time, and it
 * decides the single primary CTA the customer sees. One strong CTA, always.
 */
export const ProjectStage = z.enum([
  'created',
  'researching',
  'understanding_ready',
  'concepting',
  'concepts_ready',
  'storyboarding',
  'storyboard_ready',
  'capturing_product',
  'generating_assets',
  'rendering',
  'qa',
  'film_ready',
  'failed',
]);
export type ProjectStage = z.infer<typeof ProjectStage>;

/** What the customer is asked to do next, derived from stage. Never stored. */
export const PrimaryCta = z.enum([
  'understand_product',
  'view_understanding',
  'choose_concept',
  'render_film',
  'watch_progress',
  'review_film',
  'create_variants',
  'retry',
]);
export type PrimaryCta = z.infer<typeof PrimaryCta>;

export function primaryCtaFor(stage: ProjectStage): PrimaryCta {
  switch (stage) {
    case 'created':
      return 'understand_product';
    case 'researching':
      return 'watch_progress';
    case 'understanding_ready':
      return 'view_understanding';
    case 'concepting':
      return 'watch_progress';
    case 'concepts_ready':
      return 'choose_concept';
    case 'storyboarding':
      return 'watch_progress';
    case 'storyboard_ready':
      /*
       * The storyboard is already on the page; a button labelled "review the
       * storyboard" would do nothing. The action here is to render — and this
       * returned a CTA the UI had no action for, so at the one moment the
       * customer is ready to make their film, the page rendered no button at
       * all.
       */
      return 'render_film';
    case 'capturing_product':
    case 'generating_assets':
    case 'rendering':
    case 'qa':
      return 'watch_progress';
    case 'film_ready':
      return 'review_film';
    case 'failed':
      return 'retry';
    default:
      return 'watch_progress';
  }
}

/**
 * The CTAs that are a state of waiting rather than something to press.
 *
 * Every other CTA must resolve to an action in the UI. One that does not
 * renders no button at all, which is worse than a wrong button: the page simply
 * stops offering a way forward and the customer has nowhere to go.
 */
export const PASSIVE_CTAS: readonly PrimaryCta[] = ['watch_progress'];

/** True when this CTA needs the UI to give the customer something to press. */
export function ctaNeedsAction(cta: PrimaryCta): boolean {
  return !PASSIVE_CTAS.includes(cta);
}

export const CTA_LABELS: Record<PrimaryCta, string> = {
  understand_product: 'Understand my product',
  view_understanding: 'See what we found',
  choose_concept: 'Choose a concept',
  render_film: 'Render the film',
  watch_progress: 'Working…',
  review_film: 'Watch your film',
  create_variants: 'Create the launch campaign',
  retry: 'Try again',
};

/**
 * Advanced settings. Every one of these is optional and hidden by default;
 * the system infers all of them. Exposing them is an escape hatch, not the flow.
 */
export const ProjectBrief = z.object({
  targetAudience: z.string().max(400).nullable().default(null),
  goal: LaunchContext.nullable().default(null),
  keyMessage: z.string().max(400).nullable().default(null),
  durationSeconds: z.number().int().min(6).max(180).nullable().default(null),
  channels: z.array(Channel).default([]),
  creativeMode: CreativeMode.default('studio'),
  voiceStrategy: VoiceStrategy.nullable().default(null),
  formats: z.array(AspectRatio).default([]),
  /** Claims legal/marketing has told us never to make. Enforced by the fact checker. */
  excludedClaims: z.array(z.string().max(300)).default([]),
  /** Hard "authentic" switch: no generative imagery at all. */
  realMediaOnly: z.boolean().default(false),
});
export type ProjectBrief = z.infer<typeof ProjectBrief>;

export const Project = z.object({
  id: z.string(),
  organizationId: z.string(),
  createdByUserId: z.string(),
  name: nonEmpty(160),
  websiteUrl: urlString,
  /** Product Hunt, LinkedIn, docs — anything that helps us understand faster. */
  supplementalUrls: z.array(urlString).default([]),
  brandId: z.string().nullable().default(null),
  productUnderstandingId: z.string().nullable().default(null),
  selectedConceptId: z.string().nullable().default(null),
  activeStoryboardId: z.string().nullable().default(null),
  latestRenderId: z.string().nullable().default(null),
  stage: ProjectStage.default('created'),
  brief: ProjectBrief,
  /** Set when the customer authorised product access. Secret lives in the vault. */
  productCredentialId: z.string().nullable().default(null),
  costUsd: z.number().min(0).default(0),
  creditsSpent: z.number().min(0).default(0),
  archivedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;
