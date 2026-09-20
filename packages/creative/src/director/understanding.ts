import { z } from 'zod';
import {
  AudienceModel,
  AudienceTransformation,
  BRAND_DIMENSIONS,
  BRAND_DIMENSION_POLES,
  BrandArchetype,
  BrandGenome,
  BusinessObjective,
  CreativeBrief,
  GoalModel,
  Provenance,
  newId,
  type BrandSystem,
  type FilmCut,
  type ProductUnderstanding,
  type ProjectBrief,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * Understanding, before creating.
 *
 * Three models the pipeline never had, built once per production and read by
 * everything after: what the film is for, who is watching, and what the brand
 * is actually like.
 *
 * They exist because the old path went from a brief almost straight to three
 * concepts, and a concept written without them is a concept about a product
 * rather than about a person. "Increase demo requests" cannot be directed.
 * "An enterprise CTO should understand in eight seconds that this removes a
 * painful infrastructure workflow, and believe it" can be — every shot in the
 * film can be argued for or against it.
 *
 * Everything inferred carries provenance. A director who cannot say why they
 * believe something about a product is guessing, and a system that cannot say
 * it will repeat the guess on every film it ever makes for that customer.
 */

const BriefResponse = z.object({
  goal: z.object({
    business: BusinessObjective,
    desiredAction: z.string().max(200).nullable().default(null),
    friction: z.enum(['none', 'low', 'medium', 'high', 'enterprise']),
    awarenessStage: z.enum(['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware']),
    proofRequired: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
    ctaStrength: z.enum(['none', 'implied', 'stated', 'insistent']),
  }),
  transformation: AudienceTransformation,
  creativeObjective: z.string().trim().min(1).max(400),
  constraints: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  avoid: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  because: z.string().max(400).default(''),
});

const AudienceResponse = z.object({
  who: z.string().trim().min(1).max(300),
  economicBuyer: z.string().max(300).default(''),
  knows: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  doesNotKnow: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  statusQuo: z.string().max(300).default(''),
  frustrations: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  desires: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  objections: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  decisionCriteria: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  likelyMisconceptions: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  sophistication: z.enum(['lay', 'informed', 'practitioner', 'expert']),
  attentionContext: z.string().max(300).default(''),
  riskTolerance: z.enum(['low', 'medium', 'high']),
  categoryLanguage: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  because: z.string().max(400).default(''),
});

const GenomeResponse = z.object({
  dimensions: z.object(
    Object.fromEntries(BRAND_DIMENSIONS.map((dimension) => [dimension, z.number().min(0).max(1)])) as Record<
      (typeof BRAND_DIMENSIONS)[number],
      z.ZodNumber
    >,
  ),
  archetype: BrandArchetype,
  productPresentation: z.string().max(400).default(''),
  languageBehaviour: z.string().max(400).default(''),
  motionBehaviour: z.string().max(400).default(''),
  taboos: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  because: z.string().max(400).default(''),
});

export type UnderstandingInput = {
  projectId: string;
  brief: ProjectBrief;
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  company: string;
  filmCut: FilmCut;
  durationSeconds: number;
  language: string;
  productionBudgetUsd: number;
  productAccess: 'none' | 'public_site' | 'authenticated';
};

export class UnderstandingEngine {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * All three at once.
   *
   * In parallel because none of them needs the others — they read the same
   * research from three different professional positions — and because this
   * runs at the very front of a production where latency is most visible to
   * the customer. Three cheap calls at once beats one enormous one that has
   * to hold three jobs in its head.
   */
  async build(
    input: UnderstandingInput,
    context: CallContext,
  ): Promise<{
    brief: CreativeBrief;
    audience: AudienceModel;
    genome: BrandGenome;
    costUsd: number;
  }> {
    const [brief, audience, genome] = await Promise.all([
      this.brief(input, context),
      this.audience(input, context),
      this.genome(input, context),
    ]);

    return {
      brief: brief.value,
      audience: audience.value,
      genome: genome.value,
      costUsd: brief.costUsd + audience.costUsd + genome.costUsd,
    };
  }

  private async brief(
    input: UnderstandingInput,
    context: CallContext,
  ): Promise<{ value: CreativeBrief; costUsd: number }> {
    const { value, usage } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content: [
            'You are a strategist writing the brief a director will work from.',
            '',
            'Your one job is to separate two things that are usually written as one. The BUSINESS',
            'objective is a metric: qualified demo requests, signups, investor conviction. The',
            'CREATIVE objective is a change in what one specific person believes, stated so that any',
            'shot in the film can be argued for or against it. A film cannot be shot against a',
            'funnel metric. It can be shot against a belief.',
            '',
            'Write the transformation as sentences a real person would actually say out loud, in',
            'their own words, not in marketing register. "AI coding tools are fancy autocomplete" is',
            'a real before. "Customers are not fully leveraging AI" is not.',
            '',
            'The pivot is the single thing that has to land for the change to happen. One thing.',
            '',
            'Infer what the customer did not say. Where you are guessing, guess well and say so.',
            '',
            'Return JSON only.',
          ].join('\n'),
        },
        { role: 'user', content: briefPrompt(input) },
      ],
      { schema: BriefResponse, schemaName: 'creative_brief', tier: 'balanced', temperature: 0.4, maxOutputTokens: 1800, repairAttempts: 1 },
      context,
    );

    /*
     * A field the customer filled in is a fact about what they want; the same
     * field left blank and worked out here is an inference. They are recorded
     * differently because the next pass — a critic, a revision, the customer
     * reading the Lab — is allowed to argue with one and not the other.
     */
    const stated = (field: string, given: unknown): Provenance =>
      given === null || given === undefined || given === ''
        ? { kind: 'inferred', sources: [], because: value.because || 'Worked out from the research.', confidence: 0.6 }
        : { kind: 'stated_by_customer', sources: [field], because: 'The customer filled this in.', confidence: 1 };

    return {
      costUsd: usage.costUsd,
      value: CreativeBrief.parse({
        id: newId('cbf'),
        projectId: input.projectId,
        version: 1,
        company: input.company,
        product: input.understanding.name,
        filmFormat: input.brief.filmFormat,
        filmCut: input.filmCut,
        durationSeconds: input.durationSeconds,
        language: input.language,
        channels: input.brief.channels,
        goal: GoalModel.parse(value.goal),
        transformation: value.transformation,
        creativeObjective: value.creativeObjective,
        /* What the customer actually said always wins over what we worked out. */
        constraints: value.constraints,
        mustShow: input.brief.keyMessage ? [input.brief.keyMessage] : [],
        avoid: value.avoid,
        productionBudgetUsd: input.productionBudgetUsd,
        productAccess: input.productAccess,
        provenance: {
          goal: stated('brief.goal', input.brief.goal),
          transformation: {
            kind: 'inferred',
            sources: input.understanding.sources.slice(0, 5),
            because: value.because || 'Read from the product research.',
            confidence: 0.6,
          },
          creativeObjective: {
            kind: 'inferred',
            sources: input.understanding.sources.slice(0, 5),
            because: value.because || 'Derived from the business objective and the audience.',
            confidence: 0.6,
          },
        },
        createdAt: new Date().toISOString(),
      }),
    };
  }

  private async audience(
    input: UnderstandingInput,
    context: CallContext,
  ): Promise<{ value: AudienceModel; costUsd: number }> {
    const { value, usage } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content: [
            'You model the person who will watch this film. Not a demographic — a person, with a job,',
            'a Tuesday afternoon, and a reason to close the tab.',
            '',
            'The most useful fields are the uncomfortable ones. What do they NOT know that the company',
            'assumes they do? What will they object to? What are they doing today instead, and why is',
            'it good enough? The status quo is the real competitor and it usually wins.',
            '',
            'Attention context matters more than anything demographic: a film watched muted in a feed',
            'and a film watched in a procurement meeting are different films.',
            '',
            'Use the words this audience uses, not the words the marketing site uses.',
            '',
            'Return JSON only.',
          ].join('\n'),
        },
        { role: 'user', content: audiencePrompt(input) },
      ],
      { schema: AudienceResponse, schemaName: 'audience_model', tier: 'balanced', temperature: 0.5, maxOutputTokens: 1800, repairAttempts: 1 },
      context,
    );

    const { because, ...rest } = value;
    return {
      costUsd: usage.costUsd,
      value: AudienceModel.parse({
        id: newId('aud'),
        projectId: input.projectId,
        version: 1,
        ...rest,
        provenance: {
          who: input.brief.targetAudience
            ? { kind: 'stated_by_customer', sources: ['brief.targetAudience'], because: 'The customer said who this is for.', confidence: 1 }
            : { kind: 'inferred', sources: input.understanding.sources.slice(0, 5), because: because || 'Read from the product and its own site.', confidence: 0.55 },
        },
        createdAt: new Date().toISOString(),
      }),
    };
  }

  private async genome(
    input: UnderstandingInput,
    context: CallContext,
  ): Promise<{ value: BrandGenome; costUsd: number }> {
    const { value, usage } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content: [
            'You read brands as behaviour, not as assets.',
            '',
            'A palette and a typeface are already recorded elsewhere. What is missing is what this',
            'brand is LIKE: how much it explains before it asserts, how loud it lets a frame get,',
            'whether it is ever funny, how it shows its own product, what it would never do.',
            '',
            'The dimensions are 0 to 1 and they are a shared vocabulary, not a measurement. Each',
            'one has two named ends; place this brand between them and use the whole range.',
            '',
            'Read the poles carefully before you answer. The failure mode here is placing every',
            'serious company at the same "professional B2B" point — high rationality, no humour,',
            'high confidence — which is the prior rather than the reading. A luxury atelier and a',
            'database company are both serious and are not remotely the same brand: one is allusive',
            'and reduced and cool, the other is dense and technical and explains everything. If your',
            'numbers would fit any competent software company, you have described the category.',
            '',
            ...BRAND_DIMENSIONS.map(
              (dimension) =>
                `  ${dimension}: 0 = ${BRAND_DIMENSION_POLES[dimension].low}; 1 = ${BRAND_DIMENSION_POLES[dimension].high}`,
            ),
            '',
            'The taboos are the most useful field. Be specific: "never shows a person\'s face",',
            '"never uses an exclamation mark", "never animates the logo".',
            '',
            'Return JSON only.',
          ].join('\n'),
        },
        { role: 'user', content: genomePrompt(input) },
      ],
      { schema: GenomeResponse, schemaName: 'brand_genome', tier: 'balanced', temperature: 0.4, maxOutputTokens: 1600, repairAttempts: 1 },
      context,
    );

    return {
      costUsd: usage.costUsd,
      value: BrandGenome.parse({
        id: newId('gen'),
        projectId: input.projectId,
        brandId: input.brand.id,
        version: 1,
        dimensions: value.dimensions,
        archetype: value.archetype,
        productPresentation: value.productPresentation,
        languageBehaviour: value.languageBehaviour,
        motionBehaviour: value.motionBehaviour,
        taboos: value.taboos,
        provenance: {
          dimensions: {
            kind: 'inferred',
            sources: input.brand.sources.slice(0, 6),
            because: value.because || "Read from the brand's own site and its own writing.",
            confidence: 0.5,
          },
        },
        createdAt: new Date().toISOString(),
      }),
    };
  }
}

function productLines(understanding: ProductUnderstanding): string[] {
  return [
    `PRODUCT: ${understanding.name} — ${understanding.oneLiner}`,
    `Category: ${understanding.category}. Maturity: ${understanding.productMaturity}.`,
    understanding.targetAudience ? `The company says it is for: ${understanding.targetAudience}` : '',
    understanding.painPoints.length > 0 ? `Pain it claims to remove: ${understanding.painPoints.slice(0, 5).map((p) => p.text).join('; ')}` : '',
    understanding.differentiators.length > 0 ? `What it says is different: ${understanding.differentiators.slice(0, 5).map((d) => d.text).join('; ')}` : '',
    understanding.proofPoints.length > 0 ? `Proof on the site: ${understanding.proofPoints.slice(0, 5).map((p) => p.text).join('; ')}` : 'No proof points were found on the site.',
    understanding.competitorCategory ? `Competes with: ${understanding.competitorCategory}` : '',
    understanding.gaps.length > 0 ? `WHAT WE COULD NOT ESTABLISH: ${understanding.gaps.join(' ')}` : '',
  ].filter(Boolean);
}

function briefPrompt(input: UnderstandingInput): string {
  return [
    ...productLines(input.understanding),
    ``,
    `THE CUSTOMER ASKED FOR:`,
    `A ${input.durationSeconds}s ${input.brief.filmFormat.replace(/_/g, ' ')}, ${input.filmCut === 'short' ? 'vertical short' : 'landscape film'}, in ${input.language}.`,
    input.brief.goal ? `Occasion: ${input.brief.goal.replace(/_/g, ' ')}.` : 'They did not say what the occasion is.',
    input.brief.targetAudience ? `Audience: ${input.brief.targetAudience}` : 'They did not say who it is for.',
    input.brief.keyMessage ? `They want it to say: ${input.brief.keyMessage}` : '',
    input.brief.channels.length > 0 ? `It will run on: ${input.brief.channels.join(', ')}.` : '',
    ``,
    `PRODUCT ACCESS: ${input.productAccess.replace(/_/g, ' ')}.`,
    `Write the brief.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function audiencePrompt(input: UnderstandingInput): string {
  return [
    ...productLines(input.understanding),
    ``,
    input.brief.targetAudience
      ? `THE CUSTOMER SAYS THE AUDIENCE IS: ${input.brief.targetAudience}. Take that as given and model that person.`
      : `THE CUSTOMER DID NOT SAY WHO THIS IS FOR. Work it out from the product and say so.`,
    input.brief.channels.length > 0 ? `It will be watched on: ${input.brief.channels.join(', ')}.` : '',
    `Film shape: ${input.filmCut === 'short' ? 'a vertical short in a feed' : 'a landscape film on a page'}.`,
    ``,
    `Model the viewer.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function genomePrompt(input: UnderstandingInput): string {
  const { brand } = input;
  return [
    `THE BRAND: ${brand.name}`,
    `Visual style it was read as: ${brand.visualStyle}, ${brand.layoutDensity} density, ${brand.motionStyle} motion, ${brand.cornerStyle} corners.`,
    `Tone, in its own writing: ${brand.tone}`,
    brand.communication.positioning ? `How it positions itself: ${brand.communication.positioning}` : '',
    brand.communication.tagline ? `Its own tagline: ${brand.communication.tagline}` : '',
    brand.communication.vocabulary.length > 0 ? `Words it reaches for: ${brand.communication.vocabulary.slice(0, 16).join(', ')}` : '',
    brand.communication.wordsToAvoid.length > 0 ? `Words it visibly avoids: ${brand.communication.wordsToAvoid.slice(0, 10).join(', ')}` : '',
    brand.communication.naming ? `How it names its things: ${brand.communication.naming}` : '',
    brand.communication.claims.length > 0 ? `Claims it makes about itself: ${brand.communication.claims.slice(0, 6).join(' | ')}` : '',
    `It allows gradients: ${brand.allowsGradient}. It allows glow: ${brand.allowsGlow}.`,
    ``,
    ...productLines(input.understanding).slice(0, 3),
    ``,
    `Read this brand.`,
  ]
    .filter(Boolean)
    .join('\n');
}
