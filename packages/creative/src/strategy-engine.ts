import { z } from 'zod';
import { briefDirectionLines, cutDirectionLines, formatDirectionLines } from './brief-lines.ts';
import {
  CreativeSystemId,
  NarrativeStructure,
  Channel,
  lenientEnumArray,
  conceptSetIsDiverse,
  conceptDivergence,
  cutSeconds,
  FILM_CUTS,
  leastDivergentPair,
  newId,
  topMoments,
  type BrandSystem,
  type Concept,
  type FilmCut,
  type ProductUnderstanding,
  type ProjectBrief,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { rankSystems, getSystem } from './systems/index.ts';

/**
 * The Creative Strategy Engine.
 *
 * Its job is to behave like a strategist in the room before anyone opens a
 * design tool: read what the product actually is, and propose three genuinely
 * different ways to sell it.
 *
 * The hard part is not generating three concepts — a model will do that
 * instantly. The hard part is that the three will be the same idea in different
 * fonts, because a model asked for variety produces surface variety. So the
 * engine makes divergence structural rather than hoped for:
 *
 *  - Each concept is assigned a *different* narrative structure and a
 *    *different* creative system before the model writes a word. Structure is
 *    what makes films different; adjectives are not.
 *  - The result is measured (conceptDivergence) and the least distinct concept
 *    is regenerated with an explicit instruction about what to avoid.
 *  - Each concept must commit to a different product angle, so one leads with
 *    the problem, one with the product, one with the consequence.
 */
const ConceptResponse = z.object({
  name: z.string().trim().min(1).max(80),
  keyIdea: z.string().trim().min(1).max(400),
  hook: z.string().trim().min(1).max(300),
  targetEmotion: z.string().trim().min(1).max(120),
  productAngle: z.string().trim().min(1).max(400),
  visualDirection: z.string().trim().min(1).max(800),
  motionDirection: z.string().trim().min(1).max(600),
  soundDirection: z.string().trim().min(1).max(600),
  productUiUsage: z.string().trim().min(1).max(600),
  generativeUsage: z.string().trim().min(1).max(600),
  estimatedDurationSeconds: z.number().int().min(6).max(180),
  // Advisory, so it degrades rather than failing the whole concept. A model
  // returning "website" instead of "homepage_hero" must not cost us the idea.
  recommendedChannels: lenientEnumArray(Channel.options, {
    synonyms: {
      website: 'homepage_hero',
      homepage: 'homepage_hero',
      web: 'homepage_hero',
      landing_page: 'homepage_hero',
      social: 'paid_social',
      social_media: 'paid_social',
      instagram: 'paid_social',
      facebook: 'paid_social',
      meta: 'paid_social',
      ads: 'paid_social',
      twitter: 'x',
      producthunt: 'product_hunt',
      yt: 'youtube',
      shorts: 'youtube',
      reels: 'paid_social',
      email: 'linkedin',
      investors: 'investor',
      pitch: 'investor',
      events: 'conference',
      trade_show: 'conference',
    },
    fallback: ['homepage_hero'],
    max: 5,
  }),
  keyScenes: z.array(z.string().trim().min(1).max(200)).min(3).max(5),
  /** Moment ids from the brief this concept intends to film. */
  momentIds: z.array(z.string()).max(6).default([]),
});
type ConceptResponse = z.infer<typeof ConceptResponse>;

const SYSTEM_PROMPT = `You are a creative strategist at a studio that makes launch films for software companies. Your work has run on homepages for companies people have heard of.

You write concepts the way a strategist pitches them: an idea first, then how it looks and sounds. Not a list of features with adjectives attached.

What makes a concept good:
- It has ONE idea, and you can say it in a sentence without using the word "solution".
- The hook is the first three seconds. It earns the next fifty-seven.
- It is specific to THIS product. If the concept would work for any competitor, it is not a concept.
- It knows what it is NOT going to show.

What makes a concept bad, and what you must avoid:
- Generic AI imagery: glowing brains, neural filigree, humanoid robots, purple gradients, particles.
- Stock-photo people looking pleased at laptops.
- A voice-over explaining what the on-screen text already says.
- "Imagine a world where…"
- Claiming outcomes the evidence does not support.

Return JSON only.`;

export type StrategyInput = {
  projectId: string;
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  brief: ProjectBrief;
  /**
   * The longest film this workspace can actually render.
   *
   * Without it the strategist writes three sixty-second directions for a plan
   * that renders thirty, the customer reads them, picks one, and the
   * storyboard quietly cuts it in half — so the film they approved is not the
   * film they get. A concept is a promise about a film; it should not promise
   * one the account cannot make.
   */
  maxDurationSeconds?: number;
  /** Regenerate away from these, when the customer asked for new directions. */
  rejectedConcepts?: Concept[];
};

export type StrategyResult = {
  concepts: Concept[];
  /** Pairwise divergence after any regeneration. Surfaced for observability. */
  divergence: number;
  regenerated: number;
};

export class CreativeStrategyEngine {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async generate(input: StrategyInput, context: CallContext): Promise<StrategyResult> {
    const assignments = this.assignStructures(input);

    const concepts: Concept[] = [];
    for (const assignment of assignments) {
      concepts.push(await this.generateOne(input, assignment, concepts, context));
    }

    let regenerated = 0;
    // One corrective pass. If three structurally different briefs still produce
    // three similar concepts, a fourth attempt will not help — better to ship
    // and let the customer ask for new directions than to burn tokens.
    if (!conceptSetIsDiverse(concepts)) {
      const pair = leastDivergentPair(concepts);
      if (pair) {
        const [, replaceIndex] = pair;
        const keep = concepts.filter((_, i) => i !== replaceIndex);
        const assignment = assignments[replaceIndex]!;
        concepts[replaceIndex] = await this.generateOne(
          input,
          { ...assignment, avoid: keep },
          keep,
          context,
        );
        regenerated = 1;
      }
    }

    return {
      concepts,
      divergence: minimumPairwiseDivergence(concepts),
      regenerated,
    };
  }

  /**
   * Picks a different narrative structure and creative system for each concept
   * before any writing happens.
   *
   * Structure is assigned rather than requested because a model asked for "three
   * different approaches" reliably returns one approach three times.
   */
  private assignStructures(input: StrategyInput): ConceptAssignment[] {
    const ranked = rankSystems(input.brand, input.understanding).filter(
      (entry) => entry.system.productionReady,
    );
    const pitch = input.brief.filmFormat === 'pitch';
    const hasRealFootage =
      !pitch && input.understanding.productMoments.some((m) => m.screenshots.length > 0);

    /*
     * Three angles that cannot collapse into each other: lead with the
     * problem, lead with the thing itself, lead with the consequence of having
     * it.
     *
     * The middle one is the one the format changes. A product tour leads with
     * the product working, which is a demonstration and needs an interface. A
     * pitch has no interface, so it leads with the thing made concrete — the
     * object, the place, the people — and the demonstration structures are off
     * the table entirely rather than left available to be chosen and then
     * quietly undeliverable.
     */
    const angles: {
      angle: string;
      structures: NarrativeStructure[];
      emotion: string;
    }[] = [
      {
        angle: 'Lead with the problem. The product arrives late and resolves it.',
        structures: ['problem_shift_proof', 'before_after', 'metaphor_to_product'],
        emotion: 'relief',
      },
      pitch
        ? {
            angle:
              'Lead with the thing itself, made concrete. The object, the place, the people, ' +
              'the work — never a screen.',
            structures: ['countdown_reveal', 'question_answer', 'before_after'],
            emotion: 'confidence',
          }
        : {
            angle: 'Lead with the product. Show the thing working, end to end, no preamble.',
            structures: ['demonstration', 'day_in_the_life', 'countdown_reveal'],
            emotion: 'confidence',
          },
      {
        angle: 'Lead with the consequence. What becomes possible once this exists.',
        structures: ['manifesto', 'question_answer', 'metaphor_to_product'],
        emotion: 'ambition',
      },
    ];

    const usedStructures = new Set<NarrativeStructure>();
    const usedSystems = new Set<CreativeSystemId>();

    return angles.map((angle, index) => {
      const structure =
        angle.structures.find((s) => !usedStructures.has(s)) ?? angle.structures[0]!;
      usedStructures.add(structure);

      // A demonstration-led concept is only honest if we have real footage.
      const needsFootage = structure === 'demonstration' || structure === 'day_in_the_life';
      const system =
        ranked.find(
          (entry) =>
            !usedSystems.has(entry.system.id) &&
            (!needsFootage || hasRealFootage || !isFootageHeavy(entry.system.id)),
        )?.system ?? ranked[index % Math.max(1, ranked.length)]?.system ?? getSystem('cinematic_black');
      usedSystems.add(system.id);

      return {
        angle: angle.angle,
        structure,
        emotion: angle.emotion,
        systemId: system.id,
        avoid: input.rejectedConcepts ?? [],
      };
    });
  }

  private async generateOne(
    input: StrategyInput,
    assignment: ConceptAssignment,
    existing: Concept[],
    context: CallContext,
  ): Promise<Concept> {
    const system = getSystem(assignment.systemId);
    const understanding = input.understanding;
    const moments = topMoments(understanding, 6);
    const hasRealFootage = understanding.productMoments.some((m) => m.screenshots.length > 0);

    const avoidLines = [
      ...existing.map((c) => `- "${c.name}": ${c.keyIdea}`),
      ...assignment.avoid.map((c) => `- "${c.name}": ${c.keyIdea}`),
    ];

    /*
     * The cut decides the length, and the customer's own number is pulled into
     * its band rather than obeyed outside it: a request for sixty seconds made
     * before the cut was chosen is not an instruction to deliver a
     * sixty-second reel.
     */
    const cut = input.brief.filmCut;
    /*
     * Three numbers, narrowest wins: what the cut can carry, what the
     * customer asked for, and what their plan will render.
     */
    const planCeiling = input.maxDurationSeconds ?? Number.POSITIVE_INFINITY;
    const duration = Math.min(
      planCeiling,
      cutSeconds(
        cut,
        input.brief.durationSeconds ?? (understanding.launchContext === 'paid_social' ? 20 : null),
      ),
    );
    const [bandFloor, bandCeiling] = FILM_CUTS[cut].seconds;
    const ceilingSeconds = Math.min(bandCeiling, planCeiling);
    const floorSeconds = Math.min(bandFloor, ceilingSeconds);

    const { value } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `# The product`,
            `${understanding.name} — ${understanding.oneLiner}`,
            `Category: ${understanding.category}`,
            `Audience: ${understanding.targetAudience.join(', ') || 'not stated'}`,
            `Tone of their own writing: ${understanding.tone}`,
            ``,
            `What they say hurts today:`,
            ...understanding.painPoints.slice(0, 5).map((c) => `- ${c.text}`),
            ``,
            `What they claim it does (supported by their own material):`,
            ...understanding.keyBenefits.slice(0, 5).map((c) => `- ${c.text}`),
            ``,
            `What makes it different:`,
            ...understanding.differentiators.slice(0, 5).map((c) => `- ${c.text}`),
            ``,
            `Proof we are allowed to use:`,
            ...(understanding.proofPoints.length > 0
              ? understanding.proofPoints.slice(0, 4).map((c) => `- ${c.text}`)
              : ['- none; do not imply any metrics or customer names']),
            ``,
            input.brief.filmFormat === 'pitch'
              ? `Product moments (id — what happens). At most one of these reaches the film:`
              : `Filmable product moments (id — what happens):`,
            ...(input.brief.filmFormat === 'pitch' ? moments.slice(0, 3) : moments).map(
              (m) =>
                `- ${m.id} — ${m.title}: ${m.startState || 'start'} → ${m.endState || 'result'}${
                  m.screenshots.length > 0 ? ' [real capture available]' : ' [not yet captured]'
                }`,
            ),
            ``,
            `# The brand`,
            `Visual language: ${input.brand.visualStyle}, ${input.brand.layoutDensity}, ${input.brand.cornerStyle} corners`,
            `Motion language: ${input.brand.motionStyle}`,
            `Gradients allowed: ${input.brand.allowsGradient}. Glow allowed: ${input.brand.allowsGlow}.`,
            `Brand tone: ${input.brand.tone}`,
            ``,
            `# Your assignment for THIS concept`,
            `Angle (non-negotiable): ${assignment.angle}`,
            `Narrative structure (non-negotiable): ${assignment.structure}`,
            `Emotional target: ${assignment.emotion}`,
            `Creative system: ${system.name} — ${system.essence}`,
            `That system suits: ${system.suitsWhen.join('; ')}`,
            `That system forbids: ${system.prohibitions.join('; ')}`,
            `Target runtime: about ${duration} seconds. "estimatedDurationSeconds" must be between ${floorSeconds} and ${ceilingSeconds}.`,
            ...(input.maxDurationSeconds !== undefined && input.maxDurationSeconds < bandCeiling
              ? [
                  `This account renders films up to ${input.maxDurationSeconds} seconds. That is the`,
                  `real constraint, not a preference: write three directions that are genuinely good`,
                  `at that length rather than three that would be good at twice it. A concept the`,
                  `customer cannot render is a concept they will read, choose, and then be refused.`,
                ]
              : []),
            ...cutDirectionLines(cut),
            ...briefDirectionLines(input.brief),
            ...formatDirectionLines(input.brief.filmFormat),
            `Channels must be chosen from: ${Channel.options.join(', ')}`,
            input.brief.filmFormat === 'pitch'
              ? `This film is led by the story, not the interface. It may cut to the real thing once, held, where that is the strongest shot available — never a walkthrough, never two in a row, never the opening. "productUiUsage" is where you say which single moment, if any, earns it, and what carries every other beat.`
              : hasRealFootage
                ? `We have real captured footage of the product. Use it for anything that shows the product working.`
                : `We have NO captured product footage. Do not describe scenes that depend on showing the real UI in detail, and never invent a fake interface.`,
            input.brief.realMediaOnly
              ? `The customer has asked for real media only: no generated imagery at all.`
              : ``,
            input.brief.keyMessage ? `The customer's key message: ${input.brief.keyMessage}` : ``,
            input.brief.excludedClaims.length > 0
              ? `Never claim: ${input.brief.excludedClaims.join('; ')}`
              : ``,
            ``,
            avoidLines.length > 0
              ? `# Already taken — yours must not be a variation of these\n${avoidLines.join('\n')}`
              : ``,
            ``,
            `Write the concept. "keyScenes" are 3-5 beats, each one sentence, in order.`,
            `"momentIds" are the ids above you intend to film, if any.`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      {
        schema: ConceptResponse,
        schemaName: 'Concept',
        tier: 'deep',
        // High enough to get a real idea, low enough to stay on brief.
        temperature: 0.85,
        maxOutputTokens: 2500,
        repairAttempts: 1,
      },
      context,
    );

    return toConcept(value, {
      projectId: input.projectId,
      structure: assignment.structure,
      systemId: assignment.systemId,
      cut,
      maxDurationSeconds: ceilingSeconds,
      knownMomentIds: new Set(understanding.productMoments.map((m) => m.id)),
    });
  }
}

type ConceptAssignment = {
  angle: string;
  structure: NarrativeStructure;
  emotion: string;
  systemId: CreativeSystemId;
  avoid: Concept[];
};

function toConcept(
  response: ConceptResponse,
  params: {
    projectId: string;
    structure: NarrativeStructure;
    systemId: CreativeSystemId;
    cut: FilmCut;
    maxDurationSeconds: number;
    knownMomentIds: Set<string>;
  },
): Concept {
  return {
    id: newId('cpt'),
    projectId: params.projectId,
    name: response.name,
    keyIdea: response.keyIdea,
    hook: response.hook,
    targetEmotion: response.targetEmotion,
    productAngle: response.productAngle,
    // Structure and system are ours, not the model's — they are how divergence
    // is guaranteed, so they are not up for negotiation.
    narrativeStructure: params.structure,
    creativeSystem: params.systemId,
    visualDirection: response.visualDirection,
    motionDirection: response.motionDirection,
    soundDirection: response.soundDirection,
    productUiUsage: response.productUiUsage,
    generativeUsage: response.generativeUsage,
    /*
     * Neither the cut nor the plan is a suggestion.
     *
     * A concept estimated outside the cut's band would be storyboarded to a
     * length the format cannot carry; one estimated above the plan's ceiling
     * is a promise the account cannot keep, and the customer finds that out
     * after they have chosen it.
     */
    estimatedDurationSeconds: Math.min(
      params.maxDurationSeconds,
      cutSeconds(params.cut, response.estimatedDurationSeconds),
    ),
    recommendedChannels: response.recommendedChannels,
    keyScenes: response.keyScenes,
    // A hallucinated moment id would silently become an empty scene later.
    momentIds: response.momentIds.filter((id) => params.knownMomentIds.has(id)),
    animaticAssetId: null,
    selected: false,
    createdAt: new Date().toISOString(),
  };
}

export function minimumPairwiseDivergence(concepts: Concept[]): number {
  if (concepts.length < 2) return 1;
  let min = 1;
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      min = Math.min(min, conceptDivergence(concepts[i]!, concepts[j]!));
    }
  }
  return Number(min.toFixed(3));
}

function isFootageHeavy(id: CreativeSystemId): boolean {
  const system = getSystem(id);
  return system.archetypes.filter((a) => a.requiresProductAsset).length / system.archetypes.length > 0.5;
}
