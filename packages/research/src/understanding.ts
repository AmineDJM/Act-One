import { z } from 'zod';
import {
  newId,
  momentStrength,
  type CallContextLike,
  type Claim,
  type Evidence,
  type LaunchContext,
  type ProductMoment,
  type ProductUnderstanding,
} from './types-bridge.ts';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { evidenceForPrompt } from './evidence.ts';
import { verifyClaims, type VerificationReport } from './claim-verifier.ts';

/**
 * Synthesis of everything we read into one structured understanding.
 *
 * The prompt does one unusual thing: it forbids the model from writing any
 * claim it cannot attribute, and makes attribution mechanical by handing it
 * evidence ids. Anything that comes back unattributed is dropped here rather
 * than trusted — a model told to cite will usually cite, and the cases where
 * it does not are exactly the invented ones.
 */
const ClaimSchema = z.object({
  text: z.string().trim().min(1).max(600),
  evidenceIds: z.array(z.string()).default([]),
});

const UnderstandingResponse = z.object({
  name: z.string().trim().min(1).max(120),
  oneLiner: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(120),
  targetAudience: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  painPoints: z.array(ClaimSchema).max(10).default([]),
  keyBenefits: z.array(ClaimSchema).max(10).default([]),
  differentiators: z.array(ClaimSchema).max(10).default([]),
  coreFeatures: z.array(ClaimSchema).max(14).default([]),
  proofPoints: z.array(ClaimSchema).max(10).default([]),
  tone: z.string().trim().min(1).max(200),
  brandTraits: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  competitorCategory: z.string().max(200).default(''),
  productMaturity: z.enum(['prelaunch', 'early', 'growth', 'established']).default('early'),
  launchContext: z
    .enum([
      'product_launch',
      'feature_launch',
      'fundraise',
      'homepage_hero',
      'product_hunt',
      'paid_social',
      'linkedin',
      'investor_demo',
      'campaign',
    ])
    .default('product_launch'),
  /** Things a film would want that we could not establish from the evidence. */
  gaps: z.array(z.string().max(240)).max(8).default([]),
  /** Filmable moments the copy implies, to be verified against real capture. */
  suggestedMoments: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        // Everything but the title defaults: these are descriptive extras, and
        // losing a whole synthesis because the model omitted one is a bad trade.
        description: z.string().max(600).default(''),
        startState: z.string().max(400).default(''),
        endState: z.string().max(400).default(''),
        relevanceScore: z.number().min(0).max(1).default(0.5),
        evidenceIds: z.array(z.string()).default([]),
      }),
    )
    .max(10)
    .default([]),
});

export type SynthesiseInput = {
  projectId: string;
  websiteUrl: string;
  evidence: Evidence[];
  /** Real moments already captured from the product, if we had access. */
  capturedMoments?: ProductMoment[];
  /** Customer-supplied hints. Optional by design: we infer first. */
  hints?: {
    targetAudience?: string | null;
    goal?: LaunchContext | null;
    keyMessage?: string | null;
  };
};

const SYSTEM_PROMPT = `You are the research lead at a creative studio that makes launch films for software companies.

You have been given verbatim excerpts captured from a company's own website and public profiles. Each excerpt has an id.

Your job is to produce a factual brief the creative team can safely build a film on.

Rules, in order of importance:
1. Every claim you make about the product MUST cite the evidence ids that support it. A claim with no citation will be discarded.
2. Never state a number, metric, customer name, funding amount or award that does not appear verbatim in the evidence. If the evidence does not contain proof, say so in "gaps".
3. Do not soften or embellish. "Cuts onboarding time" is only allowed if the evidence says so; otherwise write what the evidence actually says.
4. Prefer the company's own words for positioning, and their own vocabulary for features.
5. "targetAudience" must never be empty. Name the roles and company types the site is written for, in the site's own vocabulary. If it is not stated outright, infer it from who the copy addresses and which problems it assumes — and say so in "gaps".
6. "suggestedMoments" are things the film could show happening inside the product. Describe them as a before state and an after state. These are hypotheses to be verified against the real product, not facts.
7. If the evidence is thin, return fewer, better-supported items. A short honest brief is more useful than a long speculative one.

Return JSON only.`;

export async function synthesiseUnderstanding(
  llm: LlmProvider,
  input: SynthesiseInput,
  context: CallContext,
): Promise<ProductUnderstanding> {
  const hintLines = [
    input.hints?.targetAudience ? `Customer says the audience is: ${input.hints.targetAudience}` : null,
    input.hints?.goal ? `Customer says the goal is: ${input.hints.goal}` : null,
    input.hints?.keyMessage ? `Customer says the key message is: ${input.hints.keyMessage}` : null,
  ].filter(Boolean);

  const capturedSummary =
    input.capturedMoments && input.capturedMoments.length > 0
      ? `\n\nWe also explored the live product and captured these real moments:\n${input.capturedMoments
          .map((m) => `- ${m.title}: ${m.startState} -> ${m.endState}`)
          .join('\n')}`
      : '';

  const { value } = await llm.completeJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Company website: ${input.websiteUrl}\n` +
          (hintLines.length > 0 ? `\n${hintLines.join('\n')}\n` : '') +
          capturedSummary +
          `\n\nEvidence:\n${evidenceForPrompt(input.evidence)}`,
      },
    ],
    {
      schema: UnderstandingResponse,
      schemaName: 'ProductUnderstanding',
      tier: 'deep',
      temperature: 0.3,
      maxOutputTokens: 6000,
      // This is the most expensive research step to lose; give it a second
      // repair round before abandoning a crawl we already paid for.
      repairAttempts: 2,
    },
    context,
  );

  // Verify against the corpus rather than trusting the model's own citations.
  // A model that writes accurate claims but cites sloppily should not lose the
  // brief; a model that invents a metric must lose that claim every time.
  const reports: VerificationReport[] = [];
  const verify = (claims: Claim[]): Claim[] => {
    const report = verifyClaims(claims, input.evidence);
    reports.push(report);
    return report.kept;
  };

  const capturedMoments = input.capturedMoments ?? [];
  const suggestedMoments: ProductMoment[] = value.suggestedMoments
    // A suggested moment that duplicates something we genuinely captured is
    // noise: the real capture always wins.
    .filter((suggestion) => !capturedMoments.some((m) => similarTitle(m.title, suggestion.title)))
    .map((suggestion) => ({
      id: newId('mom'),
      title: suggestion.title,
      description: suggestion.description,
      startState: suggestion.startState,
      endState: suggestion.endState,
      screenshots: [],
      recording: null,
      sourceUrl: null,
      // Unverified moments are capped below captured ones so the storyboard
      // engine prefers real footage whenever it exists.
      wowScore: 0.35,
      relevanceScore: Math.min(0.75, suggestion.relevanceScore),
      interactionSteps: [],
      requiresAuth: false,
      elementBounds: null,
    }));

  const allMoments = [...capturedMoments, ...suggestedMoments];
  const ranked = [...allMoments].sort((a, b) => momentStrength(b) - momentStrength(a));

  const gaps = [...value.gaps];
  if (capturedMoments.length === 0) {
    gaps.push('No authenticated product access, so no real product footage was captured.');
  }
  const fabricated = [...new Set(reports.flatMap((r) => r.fabricatedFigures))];
  if (fabricated.length > 0) {
    // Surfaced rather than silently swallowed: the customer should know we
    // declined to repeat a figure we could not find on their own site.
    gaps.push(
      `Dropped claims citing figures we could not find in your own material: ${fabricated.join(', ')}.`,
    );
  }

  return {
    id: newId('pun'),
    projectId: input.projectId,
    name: value.name,
    oneLiner: value.oneLiner,
    category: value.category,
    targetAudience: value.targetAudience,
    painPoints: verify(value.painPoints),
    keyBenefits: verify(value.keyBenefits),
    differentiators: verify(value.differentiators),
    coreFeatures: verify(value.coreFeatures),
    proofPoints: verify(value.proofPoints),
    productMoments: allMoments,
    strongestVisualMoments: ranked.slice(0, 6).map((m) => m.id),
    tone: value.tone,
    brandTraits: value.brandTraits,
    competitorCategory: value.competitorCategory,
    productMaturity: value.productMaturity,
    launchContext: input.hints?.goal ?? value.launchContext,
    evidence: input.evidence,
    sources: [...new Set(input.evidence.map((e) => e.sourceUrl))],
    gaps: [...new Set(gaps)],
    createdAt: new Date().toISOString(),
  };
}

function similarTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * How much of the brief is actually supported. Surfaced to the customer as
 * "here is what we could not establish" rather than hidden, which is what makes
 * the free tier feel honest instead of glossy.
 */
export function understandingConfidence(understanding: ProductUnderstanding): {
  score: number;
  supportedClaims: number;
  totalClaims: number;
} {
  const groups = [
    understanding.painPoints,
    understanding.keyBenefits,
    understanding.differentiators,
    understanding.coreFeatures,
    understanding.proofPoints,
  ];
  const all = groups.flat();
  const supported = all.filter((claim) => claim.evidenceIds.length > 0).length;
  const hasRealFootage = understanding.productMoments.some((m) => m.screenshots.length > 0);

  const claimScore = all.length === 0 ? 0 : supported / all.length;
  const breadthScore = Math.min(1, all.length / 18);
  const footageScore = hasRealFootage ? 1 : 0.45;

  return {
    score: Number((claimScore * 0.45 + breadthScore * 0.25 + footageScore * 0.3).toFixed(3)),
    supportedClaims: supported,
    totalClaims: all.length,
  };
}

export type { CallContextLike };
