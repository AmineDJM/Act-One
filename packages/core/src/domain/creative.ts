import { z } from 'zod';
import { nonEmpty, score01 } from '../zod-helpers.ts';

/** User-facing quality/cost tiers. Model names are never exposed. */
export const CreativeMode = z.enum(['authentic', 'studio', 'cinematic']);
export type CreativeMode = z.infer<typeof CreativeMode>;

/**
 * Creative systems are modular creative languages, not templates. A system
 * supplies opening grammar, type treatment, product staging, transitions and
 * sound behaviour; the Creative Director composes them per project.
 */
export const CreativeSystemId = z.enum([
  'cinematic_black',
  'kinetic_product',
  'editorial_tech',
  'spatial_ui',
  'swiss_product',
  'luxury_minimal',
  'human_product',
  'data_driven',
  'conceptual_ai',
  'high_energy_launch',
  'product_hero',
  'bold_gradient',
]);
export type CreativeSystemId = z.infer<typeof CreativeSystemId>;

export const NarrativeStructure = z.enum([
  'problem_shift_proof',       // the workhorse
  'before_after',
  'demonstration',
  'manifesto',
  'day_in_the_life',
  'metaphor_to_product',
  'question_answer',
  'countdown_reveal',
]);
export type NarrativeStructure = z.infer<typeof NarrativeStructure>;

export const Channel = z.enum([
  'homepage_hero',
  'product_hunt',
  'linkedin',
  'x',
  'youtube',
  'paid_social',
  'tiktok',
  'investor',
  'conference',
]);
export type Channel = z.infer<typeof Channel>;

export const VoiceStrategy = z.enum(['none', 'narrator', 'founder', 'brand_voice']);
export type VoiceStrategy = z.infer<typeof VoiceStrategy>;

export const Concept = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Short, memorable, quotable in a pitch. "One command." */
  name: nonEmpty(80),
  /** The strategic idea in one sentence. */
  keyIdea: nonEmpty(400),
  /** The first three seconds. */
  hook: nonEmpty(300),
  targetEmotion: nonEmpty(120),
  productAngle: nonEmpty(400),
  narrativeStructure: NarrativeStructure,
  visualDirection: nonEmpty(800),
  motionDirection: nonEmpty(600),
  soundDirection: nonEmpty(600),
  productUiUsage: nonEmpty(600),
  generativeUsage: nonEmpty(600),
  creativeSystem: CreativeSystemId,
  estimatedDurationSeconds: z.number().int().min(6).max(180),
  recommendedChannels: z.array(Channel).min(1),
  /** Three or four beats shown on the concept card. */
  keyScenes: z.array(nonEmpty(200)).min(3).max(6),
  /** Moment ids from ProductUnderstanding this concept intends to film. */
  momentIds: z.array(z.string()).default([]),
  /** Set once the animatic preview render exists. */
  animaticAssetId: z.string().nullable().default(null),
  selected: z.boolean().default(false),
  createdAt: z.string(),
});
export type Concept = z.infer<typeof Concept>;

/**
 * Concepts must be genuinely different, not three tints of one idea. We measure
 * divergence structurally so the strategy engine can reject and regenerate.
 */
export function conceptDivergence(a: Concept, b: Concept): number {
  let structural = 0;
  if (a.narrativeStructure !== b.narrativeStructure) structural += 0.3;
  if (a.creativeSystem !== b.creativeSystem) structural += 0.25;
  if (a.targetEmotion.toLowerCase() !== b.targetEmotion.toLowerCase()) structural += 0.15;

  const ideaOverlap = lexicalOverlap(`${a.keyIdea} ${a.hook}`, `${b.keyIdea} ${b.hook}`);
  const score = Math.min(1, structural + 0.3 * (1 - ideaOverlap));

  // The idea can veto the structure.
  //
  // Structural difference alone used to be enough to pass, which meant three
  // restatements of one idea counted as three directions because each had a
  // different narrative shape. But the idea is what the customer reads on the
  // card — three cards all saying "a week collapses into one run" are one
  // concept in three outfits, however differently they are shot.
  if (ideaOverlap > IDEA_RESTATEMENT_THRESHOLD) {
    return Math.min(score, 0.4 * (1 - ideaOverlap));
  }
  return score;
}

/** Above this, two ideas are the same idea reworded. */
export const IDEA_RESTATEMENT_THRESHOLD = 0.6;

export function lexicalOverlap(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    );
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  return shared / Math.min(sa.size, sb.size);
}

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'your', 'their', 'have', 'into', 'about', 'when', 'what',
  'which', 'while', 'they', 'them', 'then', 'than', 'been', 'being', 'were', 'will', 'more',
  'most', 'each', 'some', 'such', 'only', 'over', 'also', 'just', 'like', 'make', 'made',
]);

/** A set of concepts is acceptable when every pair diverges enough. */
export function conceptSetIsDiverse(concepts: Concept[], threshold = 0.45): boolean {
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      if (conceptDivergence(concepts[i]!, concepts[j]!) < threshold) return false;
    }
  }
  return true;
}

export function leastDivergentPair(concepts: Concept[]): [number, number] | null {
  let worst: { pair: [number, number]; score: number } | null = null;
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      const score = conceptDivergence(concepts[i]!, concepts[j]!);
      if (!worst || score < worst.score) worst = { pair: [i, j], score };
    }
  }
  return worst?.pair ?? null;
}

export const CreativeTreatment = z.object({
  id: z.string(),
  conceptId: z.string(),
  projectId: z.string(),
  title: nonEmpty(120),
  tagline: nonEmpty(200),
  /** The written script. Empty string is legal — some films carry no words. */
  script: z.string().max(6000).default(''),
  visualLanguage: nonEmpty(1200),
  typographyDirection: nonEmpty(800),
  cameraLanguage: nonEmpty(800),
  rhythm: nonEmpty(600),
  motionStyleNotes: nonEmpty(600),
  soundStyle: nonEmpty(600),
  voiceStrategy: VoiceStrategy,
  generativeMediaStrategy: nonEmpty(800),
  productUiUsage: nonEmpty(800),
  /** What we deliberately will NOT show. A treatment without this is not a treatment. */
  exclusions: z.array(nonEmpty(200)).default([]),
  cta: nonEmpty(200),
  confidence: score01.default(0.7),
  createdAt: z.string(),
});
export type CreativeTreatment = z.infer<typeof CreativeTreatment>;
