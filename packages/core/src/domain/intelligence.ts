import { z } from 'zod';
import { Channel, FilmFormat, lexicalOverlap } from './creative.ts';
import { FilmCut } from './cut.ts';

/**
 * The layer between "what the customer typed" and "what the film should be".
 *
 * Everything in this file exists because of one observation: a model asked to
 * write a launch film writes a launch film, and a model asked to solve a
 * business problem with a film has to decide things first. The existing
 * pipeline was the former. A brief went almost straight to three concepts, the
 * concepts were graded against each other, one was picked, and nothing in
 * between had ever stated what the film was supposed to *do* to the person
 * watching it.
 *
 * So the structures here are not prompt decoration. They are the state a
 * director has that a prompt does not: what is known about the product and on
 * what evidence, who is watching and what they currently believe, what the
 * brand is like as a set of behaviours rather than a palette, what has already
 * been tried, and which of several conflicting expert opinions won and why.
 *
 * Two rules run through all of it.
 *
 * Every inference carries its evidence. A director who cannot say why they
 * believe something about a product is guessing, and a system that cannot say
 * it will repeat the guess forever.
 *
 * And nothing here produces a single number that means "good". Scores are
 * evidence for a decision, never the decision — see `CreativeVerdict`, which
 * has four values and no decimals.
 */

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/**
 * Where a belief came from.
 *
 * Attached to inferences rather than to facts: "the pricing page says $29" is
 * a fact and needs a URL; "this brand is more rational than expressive" is an
 * inference and needs to say what it was read from, because the next person to
 * look — a customer, a critic, the Director on the second pass — has to be
 * able to disagree with it on the same evidence.
 */
export const Provenance = z.object({
  /** How the belief was arrived at. */
  kind: z.enum(['observed', 'inferred', 'stated_by_customer', 'assumed']),
  /** Evidence ids, asset ids or URLs. Empty is allowed for `assumed` and means so. */
  sources: z.array(z.string().max(500)).default([]),
  /** One line: what was read, and what it was read as. */
  because: z.string().max(400).default(''),
  /** 0..1. An honest low number is worth more than a confident wrong one. */
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Provenance = z.infer<typeof Provenance>;

/** A belief with its receipts. */
export function cited<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, provenance: Provenance });
}

// ---------------------------------------------------------------------------
// The assignment
// ---------------------------------------------------------------------------

/**
 * What the business needs, distinct from what the film must do.
 *
 * These were one field. "Increase qualified demo requests" and "make an
 * enterprise CTO understand in eight seconds that this removes a painful
 * infrastructure workflow, and believe it" are not the same sentence, and only
 * the second one can be directed. A film cannot be shot against a funnel
 * metric; it can be shot against a change in what somebody believes.
 */
export const BusinessObjective = z.enum([
  'awareness',
  'brand_desirability',
  'product_understanding',
  'signup',
  'free_trial',
  'app_install',
  'demo_request',
  'lead_generation',
  'purchase',
  'activation',
  'upsell',
  'investor_conviction',
  'recruitment',
  'launch_announcement',
]);
export type BusinessObjective = z.infer<typeof BusinessObjective>;

/** How much the viewer already knows they have a problem, and about this product. */
export const AwarenessStage = z.enum([
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
]);
export type AwarenessStage = z.infer<typeof AwarenessStage>;

/**
 * The transformation the film is for.
 *
 * Before and after, written as sentences a real person would say. This is the
 * single most useful thing in this file: almost every creative decision in a
 * launch film can be argued from it, and almost none can be argued from
 * "increase demo requests".
 */
export const AudienceTransformation = z.object({
  /** What they believe walking in. "AI coding tools are fancy autocomplete." */
  before: nonEmpty(400),
  /** What they should believe walking out. */
  after: nonEmpty(400),
  /** The one thing that has to land for the change to happen. */
  pivot: nonEmpty(300),
});
export type AudienceTransformation = z.infer<typeof AudienceTransformation>;

export const GoalModel = z.object({
  business: BusinessObjective,
  /** What the viewer should do. Null when the film's job is belief, not action. */
  desiredAction: z.string().max(200).nullable().default(null),
  /** How hard that action is: a free signup and a procurement cycle are not alike. */
  friction: z.enum(['none', 'low', 'medium', 'high', 'enterprise']).default('low'),
  awarenessStage: AwarenessStage.default('problem_aware'),
  /** What this audience needs before they will believe a claim. */
  proofRequired: z.array(nonEmpty(200)).max(8).default([]),
  /**
   * How hard the film should push.
   *
   * A luxury launch may deliberately spend its ending on feeling rather than
   * on a call to action; an acquisition ad may not. This is the dial, and the
   * Director is allowed to set it low on purpose.
   */
  ctaStrength: z.enum(['none', 'implied', 'stated', 'insistent']).default('stated'),
});
export type GoalModel = z.infer<typeof GoalModel>;

/**
 * The canonical assignment.
 *
 * Wraps the customer's `ProjectBrief` rather than replacing it: what they
 * typed stays exactly what they typed, and everything Act One worked out for
 * itself sits beside it with its provenance. A field the customer stated is
 * never quietly overwritten by an inference.
 */
export const CreativeBrief = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.number().int().min(1).default(1),
  /** The brief the customer actually filled in, by reference. */
  projectBriefHash: z.string().max(64).default(''),

  company: nonEmpty(200),
  product: nonEmpty(200),
  filmFormat: FilmFormat,
  filmCut: FilmCut,
  durationSeconds: z.number().int().min(6).max(180),
  language: z.string().min(2).max(12),
  channels: z.array(Channel).default([]),
  geography: z.string().max(120).default(''),

  goal: GoalModel,
  transformation: AudienceTransformation,
  /** The one sentence the film exists to make true. Not a tagline. */
  creativeObjective: nonEmpty(400),

  /** Hard constraints: things the brand or the customer will not allow. */
  constraints: z.array(nonEmpty(200)).max(20).default([]),
  /** Features or moments the customer asked to see. */
  mustShow: z.array(nonEmpty(200)).max(12).default([]),
  /** Things to avoid, from the customer or from the brand's own taboos. */
  avoid: z.array(nonEmpty(200)).max(20).default([]),
  /** What can be spent on generated media, in dollars. */
  productionBudgetUsd: z.number().min(0).default(0),
  /** Whether the real product can be reached and filmed. */
  productAccess: z.enum(['none', 'public_site', 'authenticated']).default('public_site'),

  provenance: z.record(z.string(), Provenance).default({}),
  createdAt: z.string(),
});
export type CreativeBrief = z.infer<typeof CreativeBrief>;

// ---------------------------------------------------------------------------
// The audience
// ---------------------------------------------------------------------------

export const AudienceModel = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.number().int().min(1).default(1),
  /** Who is watching. "Staff engineers at 200–2000 person software companies." */
  who: nonEmpty(300),
  /** The person who signs, when that is somebody else. */
  economicBuyer: z.string().max(300).default(''),
  knows: z.array(nonEmpty(200)).max(10).default([]),
  doesNotKnow: z.array(nonEmpty(200)).max(10).default([]),
  /** What they do today instead. The status quo is the real competitor. */
  statusQuo: z.string().max(300).default(''),
  frustrations: z.array(nonEmpty(200)).max(10).default([]),
  desires: z.array(nonEmpty(200)).max(10).default([]),
  objections: z.array(nonEmpty(200)).max(10).default([]),
  decisionCriteria: z.array(nonEmpty(200)).max(10).default([]),
  /** Misreadings the film has to actively prevent. */
  likelyMisconceptions: z.array(nonEmpty(200)).max(8).default([]),
  sophistication: z.enum(['lay', 'informed', 'practitioner', 'expert']).default('informed'),
  /** Where and how this is watched, which decides pacing and sound-off design. */
  attentionContext: z.string().max(300).default(''),
  riskTolerance: z.enum(['low', 'medium', 'high']).default('medium'),
  /** The words this audience uses for the category, in their own register. */
  categoryLanguage: z.array(nonEmpty(80)).max(16).default([]),
  provenance: z.record(z.string(), Provenance).default({}),
  createdAt: z.string(),
});
export type AudienceModel = z.infer<typeof AudienceModel>;

// ---------------------------------------------------------------------------
// The brand
// ---------------------------------------------------------------------------

/**
 * The brand as behaviour, not as a palette.
 *
 * `BrandSystem` holds colour, type and spacing and is the thing the renderer
 * uses. This holds what the brand is *like*, which is what the Director needs
 * and what nothing previously represented: how much it explains, how loud it
 * is, whether it is ever funny, how dense it lets a frame get.
 *
 * The numbers are deliberately not called measurements. They are a shared
 * vocabulary for arguing about a brand, and they are revisable: the Director
 * may overrule one after looking at more of the site, and a customer saying
 * "that is too aggressive for us" is evidence that an inference was wrong.
 */
export const BRAND_DIMENSIONS = [
  'rationality',
  'expressiveness',
  'visualDensity',
  'motionEnergy',
  'humour',
  'sophistication',
  'warmth',
  'confidence',
  'minimalism',
  'technicality',
] as const;
export type BrandDimension = (typeof BRAND_DIMENSIONS)[number];

/**
 * What 0 and 1 mean on each dimension.
 *
 * Added because the first benchmark run failed: asked to read four companies
 * that share no register — a reconciliation tool, a rude consumer app, a
 * luxury atelier and a developer-infrastructure product — the genome placed
 * three of them within 0.07 of each other. Everything that was not playful
 * collapsed into one "serious B2B" cluster at rationality 0.9, humour 0.03.
 *
 * The cause was not the model. It was that a bare number between 0 and 1 with
 * no stated poles is an invitation to return the prior, and the prior for a
 * software company is "professional". Naming both ends makes the scale mean
 * something, and a luxury atelier and a database company stop being the same
 * brand because neither of them is funny.
 */
export const BRAND_DIMENSION_POLES: Record<BrandDimension, { low: string; high: string }> = {
  rationality: {
    low: 'argues by feeling, image and association; shows rather than explains',
    high: 'argues by evidence, mechanism and number; explains before it asserts',
  },
  expressiveness: {
    low: 'flat, even, deliberately undramatic; nothing is emphasised',
    high: 'vivid and emphatic; reaches for images, contrast and surprise',
  },
  visualDensity: {
    low: 'one thing on a page, acres of space around it',
    high: 'packed; many elements, small type, a lot to read at once',
  },
  motionEnergy: {
    low: 'still, or one slow move; nothing hurries',
    high: 'fast, kinetic, many things moving at once',
  },
  humour: {
    low: 'entirely straight; an exclamation mark would be a mistake',
    high: 'genuinely funny; jokes at its own expense',
  },
  sophistication: {
    low: 'plain, direct, no airs; talks like a tool',
    high: 'refined and allusive; assumes taste and does not explain itself',
  },
  warmth: {
    low: 'cool and impersonal; the product, not the people',
    high: 'personal and human; names, faces, the second person',
  },
  confidence: {
    low: 'hedged and careful; "helps you", "can", "may"',
    high: 'declarative; states things as fact and does not qualify',
  },
  minimalism: {
    low: 'maximal; ornament, texture, colour, many voices',
    high: 'reduced to the fewest possible elements, by conviction',
  },
  technicality: {
    low: 'no jargon at all; a stranger to the category understands every word',
    high: 'speaks to practitioners in their own terms and assumes the background',
  },
};

export const BrandArchetype = z.enum([
  'the_engineer',
  'the_craftsman',
  'the_challenger',
  'the_guide',
  'the_insider',
  'the_minimalist',
  'the_maximalist',
  'the_institution',
  'the_upstart',
]);
export type BrandArchetype = z.infer<typeof BrandArchetype>;

export const BrandGenome = z.object({
  id: z.string(),
  projectId: z.string(),
  brandId: z.string(),
  version: z.number().int().min(1).default(1),
  /** 0..1 on each dimension. Internal representation, not a measurement. */
  dimensions: z.record(z.enum(BRAND_DIMENSIONS), z.number().min(0).max(1)),
  archetype: BrandArchetype,
  /** How this brand shows its own product. */
  productPresentation: z.string().max(400).default(''),
  /** Sentence rhythm, register, the words it reaches for. */
  languageBehaviour: z.string().max(400).default(''),
  motionBehaviour: z.string().max(400).default(''),
  /** What this brand would never do. The most useful field here. */
  taboos: z.array(nonEmpty(200)).max(12).default([]),
  provenance: z.record(z.string(), Provenance).default({}),
  createdAt: z.string(),
});
export type BrandGenome = z.infer<typeof BrandGenome>;

/** Per-dimension gaps between two genomes, largest first. */
function gaps(a: BrandGenome, b: BrandGenome): { dimension: BrandDimension; gap: number }[] {
  return BRAND_DIMENSIONS.filter(
    (dimension) => a.dimensions[dimension] !== undefined && b.dimensions[dimension] !== undefined,
  )
    .map((dimension) => ({
      dimension,
      gap: Math.abs((a.dimensions[dimension] ?? 0) - (b.dimensions[dimension] ?? 0)),
    }))
    .sort((left, right) => right.gap - left.gap);
}

/**
 * How far apart two brands are overall: the mean gap across the dimensions
 * they both state.
 *
 * Honest and, on its own, misleading — which is why `genomeContrast` exists
 * beside it. Two serious, reduced, unfunny companies agree on most of these
 * dimensions because they really are both serious, reduced and unfunny, so
 * the mean is small however sharply they differ where it counts.
 */
export function genomeDistance(a: BrandGenome, b: BrandGenome): number {
  const measured = gaps(a, b);
  if (measured.length === 0) return 0;
  return measured.reduce((total, entry) => total + entry.gap, 0) / measured.length;
}

/**
 * How sharply two brands differ where they differ at all.
 *
 * The mean of the three largest gaps, and the right instrument for the
 * question the benchmark actually asks: is there any dimension on which these
 * two are clearly not the same brand? A reconciliation tool and a luxury
 * atelier agree on seven dimensions and separate hard on rationality,
 * sophistication and technicality — averaged over all ten that reads as 0.09
 * and looks like a genome that read nothing, which is the opposite of true.
 *
 * Character lives in the dimensions where a brand is distinctive. This
 * measures those and ignores the agreement, which is also how anybody
 * describes a brand out loud.
 */
export function genomeContrast(a: BrandGenome, b: BrandGenome): { score: number; on: BrandDimension[] } {
  const measured = gaps(a, b).slice(0, 3);
  if (measured.length === 0) return { score: 0, on: [] };
  return {
    score: measured.reduce((total, entry) => total + entry.gap, 0) / measured.length,
    on: measured.map((entry) => entry.dimension),
  };
}

// ---------------------------------------------------------------------------
// Creative search
// ---------------------------------------------------------------------------

/**
 * The axis along which a direction is different from the others.
 *
 * Not a template and not a list to pick from — the names below are the kinds
 * of structural difference that exist, and the Director may invent one that is
 * not here. What they are for is measurement: two territories that share a
 * mechanism are the same territory however differently they are worded, and
 * "Fast modern launch" against "Bold dynamic launch" is the failure mode this
 * enum exists to make visible.
 */
export const TerritoryMechanism = z.enum([
  'product_as_hero',
  'human_transformation',
  'visual_metaphor',
  'problem_inversion',
  'documentary_realism',
  'extreme_close_up',
  'data_proof',
  'narrative_reveal',
  'world_building',
  'single_shot_choreography',
  'typographic_manifesto',
  'ui_ballet',
  'contrarian_statement',
  'before_after',
  'founder_voice',
  'category_destruction',
  'other',
]);
export type TerritoryMechanism = z.infer<typeof TerritoryMechanism>;

export const CreativeTerritory = z.object({
  id: z.string(),
  /** Two or three words. "The quiet close." */
  name: nonEmpty(80),
  /** One sentence. What the film is, not how it looks. */
  premise: nonEmpty(300),
  mechanism: TerritoryMechanism,
  /** Why this would work on this audience, in strategic terms. */
  rationale: nonEmpty(400),
  /** The emotional lever. */
  emotion: nonEmpty(80),
  /** What the product does in this territory: hero, evidence, absent. */
  productRole: z.enum(['hero', 'evidence', 'context', 'absent']),
  /** The opening image or move, specifically. */
  opening: nonEmpty(300),
  /** Why this territory might fail. Required: a direction with no risk is a cliché. */
  risk: nonEmpty(300),
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type CreativeTerritory = z.infer<typeof CreativeTerritory>;

/**
 * How different two territories actually are.
 *
 * Structure first, wording last, and in that proportion on purpose: the
 * mechanism and the product's role are what make two films different, and the
 * adjectives are what make them *sound* different. A model asked for twenty
 * directions will return twenty differently-worded versions of three unless
 * something measures the structure.
 *
 * Returns 0..1, where 1 is "these have nothing in common".
 */
export function territoryDistance(a: CreativeTerritory, b: CreativeTerritory): number {
  let structural = 0;
  if (a.mechanism !== b.mechanism) structural += 0.4;
  if (a.productRole !== b.productRole) structural += 0.2;
  if (a.emotion.trim().toLowerCase() !== b.emotion.trim().toLowerCase()) structural += 0.1;

  const wording = lexicalOverlap(`${a.premise} ${a.opening}`, `${b.premise} ${b.opening}`);
  const score = Math.min(1, structural + 0.3 * (1 - wording));

  /*
   * The premise can veto the structure, exactly as it can for concepts: two
   * territories restating one idea are one territory, whatever mechanism each
   * claims. The threshold is the same one the concept layer already uses,
   * because it is the same judgement about the same kind of text.
   */
  if (wording > 0.6) return Math.min(score, 0.4 * (1 - wording));
  return score;
}

/**
 * Which territories are near-duplicates of an earlier one.
 *
 * Returns the indices to drop, keeping the first of each cluster. Deliberately
 * greedy rather than a proper clustering: the input is a few dozen items, the
 * order carries the model's own confidence, and an exact answer here would not
 * change a single creative decision.
 */
export function collapsedTerritories(
  territories: readonly CreativeTerritory[],
  threshold = 0.45,
): number[] {
  const drop: number[] = [];
  const kept: CreativeTerritory[] = [];
  for (const [index, territory] of territories.entries()) {
    if (kept.some((other) => territoryDistance(territory, other) < threshold)) drop.push(index);
    else kept.push(territory);
  }
  return drop;
}

/**
 * The spread of a set, as the mean distance between every pair.
 *
 * One number, used for one purpose: deciding whether a search collapsed. Not a
 * quality score, and never compared across briefs.
 */
export function territorySpread(territories: readonly CreativeTerritory[]): number {
  if (territories.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < territories.length; i += 1) {
    for (let j = i + 1; j < territories.length; j += 1) {
      total += territoryDistance(territories[i]!, territories[j]!);
      pairs += 1;
    }
  }
  return total / pairs;
}

/** Why a territory did not go through. Stated so the Lab can show the reasoning. */
export const RejectionReason = z.enum([
  'too_generic',
  'duplicate',
  'off_brand',
  'unfilmable',
  'commercially_weak',
  'reference_copying',
  'self_repetition',
  'too_expensive',
  'audience_mismatch',
  'no_product_role',
]);
export type RejectionReason = z.infer<typeof RejectionReason>;

export const TerritoryVerdict = z.object({
  territoryId: z.string(),
  kept: z.boolean(),
  reason: RejectionReason.nullable().default(null),
  note: z.string().max(300).default(''),
});
export type TerritoryVerdict = z.infer<typeof TerritoryVerdict>;

// ---------------------------------------------------------------------------
// Critics
// ---------------------------------------------------------------------------

export const CriticId = z.enum([
  'film',
  'art_direction',
  'brand',
  'product_marketing',
  'conversion',
  'copy',
  'sound',
  'originality',
  'production',
]);
export type CriticId = z.infer<typeof CriticId>;

export const CriticSeverity = z.enum(['note', 'medium', 'high', 'critical']);
export type CriticSeverity = z.infer<typeof CriticSeverity>;

export const CriticFinding = z.object({
  severity: CriticSeverity,
  /** What is wrong, in one sentence, about this artifact. */
  observation: nonEmpty(400),
  /** Shot ids, timecodes, copy lines — whatever the claim rests on. */
  evidence: z.array(z.string().max(200)).max(10).default([]),
  /** What it costs if nothing changes. */
  risk: z.string().max(300).default(''),
  recommendation: z.string().max(400).default(''),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type CriticFinding = z.infer<typeof CriticFinding>;

/**
 * Four words, no decimals.
 *
 * "Creative quality: 94.7" is a number nobody calibrated pretending creativity
 * is solved arithmetic. A critic says which of four things it thinks and shows
 * what it read; the Director decides what happens.
 */
export const CreativeVerdict = z.enum(['pass', 'pass_with_concerns', 'revise', 'block']);
export type CreativeVerdict = z.infer<typeof CreativeVerdict>;

export const CriticReview = z.object({
  id: z.string(),
  projectId: z.string(),
  /** What was looked at: a territory, a concept, an animatic, a master. */
  artifactKind: z.enum(['territory', 'concept', 'treatment', 'storyboard', 'animatic', 'master']),
  artifactId: z.string(),
  critic: CriticId,
  verdict: CreativeVerdict,
  findings: z.array(CriticFinding).max(12).default([]),
  /** Which evaluator produced this, so a change of critic is visible later. */
  criticVersion: z.string().max(40).default('v1'),
  model: z.string().max(80).default(''),
  costUsd: z.number().min(0).default(0),
  createdAt: z.string(),
});
export type CriticReview = z.infer<typeof CriticReview>;

/** The verdict a set of findings adds up to, before any critic states one. */
export function verdictForFindings(findings: readonly CriticFinding[]): CreativeVerdict {
  if (findings.some((finding) => finding.severity === 'critical')) return 'block';
  if (findings.some((finding) => finding.severity === 'high')) return 'revise';
  if (findings.some((finding) => finding.severity === 'medium')) return 'pass_with_concerns';
  return 'pass';
}

const VERDICT_ORDER: Record<CreativeVerdict, number> = {
  pass: 0,
  pass_with_concerns: 1,
  revise: 2,
  block: 3,
};

/** The strictest verdict in a panel. Used to decide whether a gate opens. */
export function strictestVerdict(verdicts: readonly CreativeVerdict[]): CreativeVerdict {
  return verdicts.reduce<CreativeVerdict>(
    (worst, verdict) => (VERDICT_ORDER[verdict] > VERDICT_ORDER[worst] ? verdict : worst),
    'pass',
  );
}

/**
 * Where two critics genuinely disagree.
 *
 * Not noise to be averaged away — the most useful thing a panel produces. The
 * conversion critic wanting a louder call to action and the film critic saying
 * it would destroy the ending is a real creative decision that somebody has to
 * make, and the record of who won is worth more later than either opinion.
 */
export function disagreements(
  reviews: readonly CriticReview[],
): { a: CriticId; b: CriticId; distance: number }[] {
  const out: { a: CriticId; b: CriticId; distance: number }[] = [];
  for (let i = 0; i < reviews.length; i += 1) {
    for (let j = i + 1; j < reviews.length; j += 1) {
      const left = reviews[i]!;
      const right = reviews[j]!;
      const distance = Math.abs(VERDICT_ORDER[left.verdict] - VERDICT_ORDER[right.verdict]);
      if (distance >= 2) out.push({ a: left.critic, b: right.critic, distance });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation, as evidence
// ---------------------------------------------------------------------------

/**
 * The dimensions a film is judged on, which do not collapse into one number.
 *
 * A weighted sum of these would pick the concept that is second-best at
 * everything over the one that is extraordinary at the two things this brief
 * is actually about. So they are kept apart and the Director reasons over the
 * trade-off, with `paretoFront` below to narrow the field honestly first.
 */
export const EVALUATION_DIMENSIONS = [
  'brandFit',
  'productClarity',
  'attention',
  'memorability',
  'emotionalPower',
  'conversionRelevance',
  'visualSophistication',
  'originality',
  'narrativeCoherence',
  'productionFeasibility',
  'platformFit',
] as const;
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export const CreativeEvaluation = z.object({
  id: z.string(),
  projectId: z.string(),
  artifactKind: z.enum(['territory', 'concept', 'treatment', 'storyboard', 'animatic', 'master']),
  artifactId: z.string(),
  /** 0..1 per dimension. Evidence for a decision, never the decision. */
  scores: z.record(z.enum(EVALUATION_DIMENSIONS), z.number().min(0).max(1)),
  verdict: CreativeVerdict,
  /** What the evaluator would change first. */
  weakest: z.string().max(300).default(''),
  evaluatorVersion: z.string().max(40).default('v1'),
  model: z.string().max(80).default(''),
  createdAt: z.string(),
});
export type CreativeEvaluation = z.infer<typeof CreativeEvaluation>;

/**
 * The candidates nothing else beats outright.
 *
 * A candidate is dominated when another is at least as good on every dimension
 * and better on one. Removing the dominated ones is the only narrowing that
 * costs nothing in creative terms — everything left is genuinely a trade-off,
 * and choosing between trade-offs is the Director's job rather than
 * arithmetic's.
 */
export function paretoFront<T extends { scores: Partial<Record<EvaluationDimension, number>> }>(
  candidates: readonly T[],
  dimensions: readonly EvaluationDimension[] = EVALUATION_DIMENSIONS,
): T[] {
  const at = (candidate: T, dimension: EvaluationDimension) => candidate.scores[dimension] ?? 0;
  return candidates.filter((candidate) =>
    !candidates.some((other) => {
      if (other === candidate) return false;
      const everywhereAtLeast = dimensions.every((d) => at(other, d) >= at(candidate, d));
      const somewhereBetter = dimensions.some((d) => at(other, d) > at(candidate, d));
      return everywhereAtLeast && somewhereBetter;
    }),
  );
}

// ---------------------------------------------------------------------------
// Decisions and memory
// ---------------------------------------------------------------------------

export const DirectorDecision = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Which step of the production this decision belongs to. */
  stage: z.enum([
    'brief',
    'territories',
    'concept',
    'treatment',
    'storyboard',
    'animatic',
    'production',
    'creative_qa',
  ]),
  /** One sentence, in the past tense. "Moved the proof from 14.2s to 6.8s." */
  decision: nonEmpty(300),
  /** Why. Names the evidence, not the reasoning. */
  reason: nonEmpty(600),
  /** What was chosen. */
  selected: z.string().max(200).default(''),
  /** What was not, so the Lab can show the road not taken. */
  rejected: z.array(z.string().max(200)).max(20).default([]),
  /** Critic reviews that informed it. */
  reviewIds: z.array(z.string()).max(20).default([]),
  /** Conflicts the Director had to settle, and how. */
  arbitrations: z
    .array(
      z.object({
        between: z.array(CriticId).min(2).max(4),
        conflict: nonEmpty(300),
        resolution: nonEmpty(300),
      }),
    )
    .max(8)
    .default([]),
  /** The artifact this produced, when it produced one. */
  resultArtifactId: z.string().max(80).default(''),
  directorVersion: z.string().max(40).default('v1'),
  createdAt: z.string(),
});
export type DirectorDecision = z.infer<typeof DirectorDecision>;

/**
 * A device Act One has used before.
 *
 * The memory that stops the studio developing a house style by accident. A
 * signature is deliberately coarse — "opening on a held black frame with one
 * word", not the shot itself — because what makes work feel repetitive is the
 * mechanism, not the pixels.
 */
export const SIGNATURE_KINDS = [
  'opening',
  'shot_archetype',
  'transition',
  'camera_pattern',
  'copy_pattern',
  'sound_motif',
  'ui_treatment',
  'ending',
] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const CreativeSignature = z.object({
  id: z.string(),
  /** Scoped so one customer's work is never a reason to change another's. */
  organizationId: z.string(),
  projectId: z.string(),
  kind: z.enum(SIGNATURE_KINDS),
  /** The device, in the words a director would use in the edit. */
  device: nonEmpty(200),
  /** Normalised for comparison. Derived; never written by a model. */
  key: z.string().max(200),
  createdAt: z.string(),
});
export type CreativeSignature = z.infer<typeof CreativeSignature>;

/**
 * The comparison key for a device.
 *
 * Lowercase, stopword-free, order-independent and lightly stemmed, so that
 * "opens on a held black frame" and "opening on a held black frame" are
 * recognised as the same device — which they are. Without the stemming the
 * memory only catches a repetition somebody happened to describe in the same
 * tense, which is most of the way to not catching repetition at all.
 *
 * Deliberately crude. This is a hint to a director, not a retrieval index, and
 * a real stemmer here would be precision nobody could use.
 */
export function signatureKey(kind: SignatureKind, device: string): string {
  const words = device
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .map(stem)
    .sort();
  return `${kind}:${[...new Set(words)].slice(0, 6).join('-')}`;
}

/** Enough of a stem to survive a tense change. Nothing shorter than four letters. */
function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * How much a proposed set of devices repeats what has been made recently.
 *
 * Returns 0..1. The point is not to ban a device — a studio has a voice, and
 * some repetition is that voice — but to put a number in front of the Director
 * when the last seven films all opened the same way.
 */
export function repetitionAgainst(
  recent: readonly CreativeSignature[],
  proposed: readonly { kind: SignatureKind; device: string }[],
): { score: number; repeated: string[] } {
  if (proposed.length === 0) return { score: 0, repeated: [] };
  const seen = new Map<string, number>();
  for (const signature of recent) seen.set(signature.key, (seen.get(signature.key) ?? 0) + 1);

  const repeated: string[] = [];
  let hits = 0;
  for (const candidate of proposed) {
    const key = signatureKey(candidate.kind, candidate.device);
    const count = seen.get(key) ?? 0;
    if (count > 0) {
      hits += 1;
      repeated.push(`${candidate.device} (used ${count}×)`);
    }
  }
  return { score: hits / proposed.length, repeated };
}

/** Above this share of repeated devices, the Director is told to look again. */
export const REPETITION_WARNING_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Preference data, for a taste model that does not exist yet
// ---------------------------------------------------------------------------

/**
 * One pairwise judgement, from whoever made it.
 *
 * Collected now and used now only to check ourselves; the reason it exists is
 * that preference data is the one asset a foundation model cannot hand us. The
 * judge is recorded because a customer's preference, a director's and an
 * evaluator's are three different signals and must never be averaged into one.
 *
 * There is no trained Act One taste model. `judge: 'act_one_evaluator'` means
 * the current multimodal evaluator, and the schema says so rather than
 * implying a proprietary model exists.
 */
export const PreferenceJudge = z.enum([
  'act_one_evaluator',
  'customer',
  'creative_director',
  'internal_operator',
  'external_panel',
]);
export type PreferenceJudge = z.infer<typeof PreferenceJudge>;

export const CreativePreference = z.object({
  id: z.string(),
  organizationId: z.string(),
  /** The brief both artifacts were answering, so a preference is comparable. */
  briefId: z.string().max(80).default(''),
  artifactA: z.string(),
  artifactB: z.string(),
  judge: PreferenceJudge,
  /** Null is a real answer and worth recording: these two are equally good. */
  winner: z.enum(['a', 'b', 'tie']),
  /** Which dimension the judgement was about, when it was about one. */
  dimension: z.enum(EVALUATION_DIMENSIONS).nullable().default(null),
  reason: z.string().max(600).default(''),
  confidence: z.number().min(0).max(1).default(0.6),
  /** True when the judge was not told which was which. */
  blind: z.boolean().default(false),
  createdAt: z.string(),
});
export type CreativePreference = z.infer<typeof CreativePreference>;
