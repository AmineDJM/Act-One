import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';
import type { HeroCandidate, ProductUnderstanding } from '@act-one/core';

/**
 * Choosing the hero shot, by looking at it.
 *
 * The search below this produces a shortlist of frames out of the customer's
 * own captures, ranked on properties that can be measured: sharpness,
 * isolation, how the subject sits in the frame. Those properties are real and
 * none of them is the question. The question is which of these six frames a
 * person would still be able to describe tomorrow, and there is no arithmetic
 * for that.
 *
 * So the shortlist is rendered — through the actual renderer, at the actual
 * frame size, with the actual treatment — and the frames are shown. What is
 * being judged is the picture that will ship, not a description of it and not
 * a proxy for it.
 *
 * Two things this is not allowed to do. It cannot invent a shot: the only
 * answer it can give is the index of a frame it was shown. And it cannot pass
 * — a refusal to choose is a choice for whatever the deterministic score
 * happened to rank first, so it says which and why, and the why is kept.
 */
const HeroChoice = z.object({
  /** 1-based, as the frames were labelled. */
  chosen: z.number().int().min(1),
  /** Written for the person who has to live with the film. */
  reason: z.string().min(1).max(600),
  /** What the runner-up had that this one does not, if anything. */
  giveUp: z.string().max(400).default(''),
});

const SYSTEM_PROMPT = [
  'You are a film director choosing the single most memorable frame from a shortlist.',
  '',
  'Each image is one shot from a product film, rendered exactly as it will appear.',
  'Every pixel is the customer\'s real interface; none of it was generated or redrawn.',
  '',
  'You are choosing the frame the film is remembered for. That frame is usually the one',
  'where a specific thing is happening at a size you can read it — a message being sent,',
  'a decision landing, a number arriving — and rarely the one showing the most of the',
  'product. A frame that could belong to any product in this category is not the answer',
  'however well composed it is.',
  '',
  'Judge only what you can see. Do not reward a frame for what the product might do',
  'elsewhere, and do not penalise a frame for cropping: the crop is the shot.',
  'You must pick one of the frames you were shown, by its number.',
].join('\n');

export type HeroChoiceInput = {
  candidates: readonly HeroCandidate[];
  /** Data URLs of the rendered frames, in the same order as the candidates. */
  frames: readonly string[];
  understanding: ProductUnderstanding | null;
  /** The direction the film is being made in, so the hero serves the film. */
  direction: string;
};

export class HeroShotDirector {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async choose(
    input: HeroChoiceInput,
    context: CallContext,
  ): Promise<{ index: number; reason: string; giveUp: string; costUsd: number; asked: boolean }> {
    if (input.candidates.length === 0) {
      throw new Error('The hero shot director was given no frames to choose between.');
    }
    /*
     * One candidate is not a choice. Asking anyway costs a vision call to be
     * told what we already know, and invites a model to talk itself into
     * rejecting the only frame there is.
     */
    if (input.candidates.length === 1) {
      return {
        index: 0,
        reason: 'The only frame the captures could carry as a hero shot.',
        giveUp: '',
        costUsd: 0,
        asked: false,
      };
    }

    const { value, usage } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `The film is directed as: ${input.direction}`,
            input.understanding ? `The product: ${input.understanding.oneLiner}` : '',
            '',
            `${input.frames.length} frames follow, numbered 1 to ${input.frames.length} in order.`,
            'Pick the one this film should be remembered for.',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        },
      ],
      {
        schema: HeroChoice,
        schemaName: 'hero_choice',
        tier: 'balanced',
        temperature: 0.3,
        maxOutputTokens: 900,
        images: input.frames.map((url) => ({ url, detail: 'high' as const })),
      },
      context,
    );

    // A number outside the shortlist is a frame that does not exist; the best
    // measured candidate is the honest fallback, and the reason says so.
    const index = value.chosen - 1;
    const valid = index >= 0 && index < input.candidates.length;
    return {
      index: valid ? index : 0,
      reason: valid
        ? value.reason
        : `${value.reason} (chose frame ${value.chosen}, which was not on the shortlist; kept the best measured frame instead)`,
      giveUp: value.giveUp,
      costUsd: usage.costUsd,
      asked: true,
    };
  }
}
