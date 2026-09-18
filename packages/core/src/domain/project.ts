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

/**
 * The order the stages happen in, for the one question worth asking about two
 * of them: has this project already gone past there?
 *
 * `failed` is deliberately last-but-outside: a failed project has not made
 * progress, it has stopped, so comparing it against a stage is meaningless and
 * every caller below treats it as "not past anything".
 */
const STAGE_ORDER: readonly ProjectStage[] = [
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
];

/**
 * True when the project has already reached `stage` or gone beyond it.
 *
 * Used to stop a re-run of an early step dragging a finished project backwards:
 * re-reading a product to pick up newly authorised screens should refresh the
 * understanding, not tell a customer with a finished film that we have just
 * finished reading their website.
 */
export function stageReached(current: ProjectStage, stage: ProjectStage): boolean {
  const at = STAGE_ORDER.indexOf(current);
  const target = STAGE_ORDER.indexOf(stage);
  if (at < 0 || target < 0) return false;
  return at >= target;
}

/** What the customer is asked to do next, derived from stage. Never stored. */
export const PrimaryCta = z.enum([
  'understand_product',
  'choose_concept',
  'render_film',
  'watch_progress',
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
      /*
       * Research enqueues concept generation as it finishes, so this stage
       * always has a job behind it. The understanding itself is on the page
       * already; there is nothing to press.
       */
      return 'watch_progress';
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
      // The film is delivered in its own panel, with a player and a download.
      // What is left to do is cut it for the channels they are launching on.
      return 'create_variants';
    case 'failed':
      return 'retry';
    default:
      return 'watch_progress';
  }
}

/**
 * CTAs that are a state of waiting rather than something to press.
 */
export const PASSIVE_CTAS: readonly PrimaryCta[] = ['watch_progress'];

/**
 * CTAs whose control lives elsewhere on the page.
 *
 * Choosing a concept happens on the three concept cards, each carrying its own
 * button — a fourth button in the banner above them would be asking the same
 * question twice.
 */
export const DELEGATED_CTAS: readonly PrimaryCta[] = ['choose_concept'];

/**
 * True when the CTA itself must carry a button.
 *
 * A CTA that is neither passive nor delegated and has no action renders nothing
 * at all, which is worse than a wrong button: the page stops offering a way
 * forward and the customer has nowhere to go. That is how a finished storyboard
 * became unrenderable, a failed project unrecoverable, and a finished film
 * uncuttable — three times, the same mistake.
 */
export function ctaNeedsAction(cta: PrimaryCta): boolean {
  return !PASSIVE_CTAS.includes(cta) && !DELEGATED_CTAS.includes(cta);
}

/** Exactly the CTAs the project page wires an action to. */
export const ACTIONABLE_CTAS: readonly PrimaryCta[] = [
  'understand_product',
  'render_film',
  'create_variants',
  'retry',
];

export const CTA_LABELS: Record<PrimaryCta, string> = {
  understand_product: 'Understand my product',
  choose_concept: 'Choose a concept',
  render_film: 'Render the film',
  watch_progress: 'Working…',
  create_variants: 'Create the launch campaign',
  retry: 'Try again',
};

/**
 * Advanced settings. Every one of these is optional and hidden by default;
 * the system infers all of them. Exposing them is an escape hatch, not the flow.
 */
/**
 * The voice the film speaks in. Chosen by the customer, or, when they say
 * nothing, read from the brand's own writing.
 */
export const Tone = z.enum(['confident', 'warm', 'playful', 'bold', 'calm', 'technical']);
export type Tone = z.infer<typeof Tone>;

export const TONE_LABELS: Record<Tone, string> = {
  confident: 'Confident — plain, assured, no hedging',
  warm: 'Warm — human, close, on the customer\'s side',
  playful: 'Playful — light, quick, a little wit',
  bold: 'Bold — big claims made calmly, high contrast',
  calm: 'Calm — slow, spacious, understated',
  technical: 'Technical — precise, for people who know the field',
};

/**
 * Languages a film can be written and narrated in. The code is what the
 * creative engines and the voice are told; the name is what the customer sees.
 * Null in a brief means the language of the product's own site.
 */
export const FILM_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'nb', name: 'Norsk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
] as const;
export type FilmLanguage = (typeof FILM_LANGUAGES)[number]['code'];

export function languageName(code: string | null | undefined): string | null {
  return FILM_LANGUAGES.find((language) => language.code === code)?.name ?? null;
}

/** Runtimes offered up front, in seconds. A plan caps which of them apply. */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;

export const ProjectBrief = z.object({
  targetAudience: z.string().max(400).nullable().default(null),
  goal: LaunchContext.nullable().default(null),
  keyMessage: z.string().max(400).nullable().default(null),
  durationSeconds: z.number().int().min(6).max(180).nullable().default(null),
  /** ISO 639-1 code. Null: the language of the product's own site. */
  language: z.string().min(2).max(12).nullable().default(null),
  /** Null: read from the brand's own writing. */
  tone: Tone.nullable().default(null),
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
