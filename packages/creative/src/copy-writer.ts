import { z } from 'zod';
import {
  COPY_LABELS,
  COPY_LIMITS,
  COPY_ORDER,
  CopySurface,
  WEASEL_PHRASES,
  newId,
  usableCopy,
  type Concept,
  type CopyKit,
  type CopyLine,
  type CreativeTreatment,
  type ProductUnderstanding,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * The launch copy that goes around the film.
 *
 * A film is not a launch. The same day it goes out, somebody needs a headline
 * for the page it sits on, a post for two networks, a subject line, and a
 * tagline short enough for Product Hunt — written from the same argument the
 * film makes rather than by a different person guessing at it.
 *
 * The discipline is the one the rest of the product already holds itself to:
 * every line that asserts something checkable cites the verified claim it rests
 * on, verbatim, and anything citing a claim we did not verify is discarded
 * rather than softened. A film inventing a number is watched once; a launch
 * post inventing one is quoted back at the company for years.
 */
const CopyPlan = z.object({
  lines: z
    .array(
      z.object({
        surface: CopySurface,
        text: z.string().min(1).max(800),
        /** Copied verbatim from the supported claims, or empty. */
        claim: z.string().max(400).default(''),
      }),
    )
    .min(4)
    .max(24),
});

/*
 * The banned phrases are generated from the standard rather than typed out
 * again here. Two lists of forbidden words drift the moment one of them is
 * edited, and the failure is silent: the model keeps writing a phrase the
 * filter then throws away, and the customer gets fewer lines than they should
 * with no explanation of why.
 */
const SYSTEM_PROMPT = `You are writing the launch copy that surrounds a film, in the company's own voice.

Rules:
- Write from the approved concept. This copy and the film must sound like one argument, not two.
- Use the company's own words and tone. Do not write like an advertisement for a different company.
- Any line asserting something checkable — a number, a comparison, a named customer — must set "claim" to the supported claim it rests on, copied character for character from the list you are given. If no claim supports it, do not write the line.
- Lines that assert nothing checkable leave "claim" empty. Most lines are these.
- No superlatives and no priority claims: no "the best", "the only X that", "world's first", "#1", "guaranteed". They are objective claims in advertising law and this company cannot substantiate them.
- No exclamation marks. None of these, in any form: ${WEASEL_PHRASES.join(', ')}.
- Respect the length limit given for each surface. A line over its limit is discarded.
- Write two or three options for the short surfaces, one for the long ones.

Return JSON only.`;

export type CopyInput = {
  projectId: string;
  organizationId: string;
  concept: Concept;
  treatment: CreativeTreatment;
  understanding: ProductUnderstanding;
};

export class CopyWriter {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async write(input: CopyInput, context: CallContext): Promise<CopyKit> {
    const claims = [
      ...input.understanding.keyBenefits,
      ...input.understanding.differentiators,
      ...input.understanding.proofPoints,
    ].map((claim) => claim.text);

    const { value } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `# The product`,
            `${input.understanding.name} — ${input.understanding.oneLiner}`,
            `Audience: ${input.understanding.targetAudience.join(', ') || 'unspecified'}`,
            `Their own tone: ${input.understanding.tone}`,
            ``,
            `# The approved concept, which this copy must agree with`,
            `"${input.concept.name}"`,
            `Idea: ${input.concept.keyIdea}`,
            `Hook: ${input.concept.hook}`,
            `The film ends on: ${input.treatment.cta}`,
            ``,
            `# Supported claims — copy one of these verbatim into "claim", or leave it empty`,
            ...(claims.length > 0 ? claims.map((claim) => `- ${claim}`) : ['- none. Do not assert any figure.']),
            ``,
            `# Surfaces and their limits`,
            ...COPY_ORDER.map(
              (surface) => `- ${surface} (${COPY_LABELS[surface]}): ${COPY_LIMITS[surface]} characters`,
            ),
          ].join('\n'),
        },
      ],
      { schema: CopyPlan, schemaName: 'launch_copy', tier: 'deep' },
      context,
    );

    const lines: CopyLine[] = value.lines.map((line) => ({
      surface: line.surface,
      text: line.text.trim(),
      claim: line.claim.trim(),
    }));

    return {
      id: newId('cpy'),
      organizationId: input.organizationId,
      projectId: input.projectId,
      conceptId: input.concept.id,
      // Enforced here rather than trusted from the model: a length limit and a
      // claim that does not exist are both things a model gets wrong quietly.
      lines: usableCopy(lines, claims),
      createdAt: new Date().toISOString(),
    };
  }
}
