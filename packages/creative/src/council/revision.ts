/**
 * ROUND 5 — the Revision Room. Not more criticism: causes.
 *
 * THE DIFFERENCE THIS ROOM EXISTS TO ENFORCE. "The typography is weak" is a
 * criticism. "The emphasis reads as colour-only because the hero phrase and the
 * rest never appear in the same frame, so there is no size comparison available
 * to the eye" is a cause, and only one of them can be acted on. Round 4 says
 * what is wrong; this room says why, and what single change would remove the
 * why rather than the symptom.
 *
 * WHAT IT IS GIVEN THAT NO EARLIER ROOM HAD. Two things, and they are the
 * reason this is not just another critique pass.
 *
 * The OUTCOME MEMORY: what has already been tried on a problem like this one,
 * and how it went. This project replaced its opening with a different stock
 * image three separate times, the third time having commissioned it to a
 * written brief, and each attempt was proposed by somebody who could not see
 * the previous two. A room that cannot remember its own experiments runs them
 * again at full price.
 *
 * The BENCHMARK MECHANISMS: what other films did in comparable situations,
 * retrieved for THIS problem rather than dumped wholesale, each still attached
 * to the film and second it came from. Not a template — a set of moves that
 * have worked somewhere, which is what a room needs when the honest answer to
 * "what should we do instead" is "nobody here has an idea yet".
 *
 * THREE INTERVENTIONS, NOT FORTY. Forty cosmetic edits with a storytelling
 * problem still in place is the failure mode, and it is seductive because
 * cosmetic edits are easy to agree on.
 */
import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { EXECUTIVE } from './directors.ts';
import { Intervention } from './types.ts';

export type RevisionInput = {
  thesis: string;
  /** What the room saw, already clustered by how many directors saw it. */
  observations: string;
  /** What has been tried on problems like these, from the outcome memory. */
  priors: string;
  /** Mechanisms other films used in comparable situations. */
  mechanisms: string;
  /** What the engine can actually do, so a proposal is executable. */
  capabilities: string;
  /** Decisions taken on purpose that a fresh reader would report as faults. */
  journal: string;
};

export type RevisionResult = {
  interventions: Intervention[];
  /** Why these three and not the others — the part that is usually lost. */
  rationale: string;
  costUsd: number;
};

const Plan = z.object({
  interventions: z.array(Intervention).max(4).default([]),
  rationale: z.string().max(900).default(''),
});

export class RevisionRoom {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async plan(input: RevisionInput, context: CallContext): Promise<RevisionResult> {
    const { value, usage } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content: [
            `You are the ${EXECUTIVE.title}, running the revision room.`,
            '',
            'Round 4 found problems. Your job is CAUSES and the smallest changes that remove them.',
            'A restatement of a symptom is not an intervention. For each one you must be able to say',
            'what is actually producing the problem, and what would be different in the rendered',
            'film if the change were made.',
            '',
            'RULES THAT ARE NOT NEGOTIABLE:',
            '- At most three. A long list with a storytelling problem still in it is a failure.',
            '- Every intervention names a REGRESSION it might cause. A change with no predicted cost',
            '  has not been thought about.',
            '- Do not propose something the outcome memory says was already tried and made the film',
            '  worse, unless you say what is different this time.',
            '- Do not undo a decision the journal records as deliberate without arguing with the',
            '  reason it was taken.',
            '- Prefer one change that removes a cause over three that hide symptoms.',
            '- `scope` says where the fix belongs: round_3 for execution, round_2 for construction,',
            '  audiovisual design or continuity, round_1 only when the concept itself is wrong.',
            '',
            'Banned: premium, polished, professional, elevated, sleek, modern, clean, dynamic,',
            'engaging. Name shots, words, colours and seconds.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `THE FILM WAS MADE TO THIS THESIS: ${input.thesis}`,
            '',
            'WHAT THE ROOM SAW — clustered, most-witnessed first:',
            input.observations,
            '',
            'ALREADY TRIED, IN THIS PROJECT:',
            input.priors,
            '',
            input.mechanisms,
            '',
            'DECISIONS TAKEN ON PURPOSE — argue with the reason, do not silently undo:',
            input.journal,
            '',
            'WHAT THE ENGINE CAN ACTUALLY DO:',
            input.capabilities,
            '',
            'Choose the highest-leverage changes and say why these rather than the others you',
            'considered. If the strongest available change is out of scope for a rebuild, say so in',
            'the rationale rather than substituting a weaker one silently.',
          ].join('\n'),
        },
      ],
      { schema: Plan, schemaName: 'revision_plan', tier: 'deep', temperature: 0.4, maxOutputTokens: 2400, repairAttempts: 1 },
      context,
    );

    /*
     * Sorted by leverage as the room itself reported it — confidence against
     * cost — rather than by the order the model happened to emit. A plan whose
     * first item is its weakest gets executed weakest-first.
     */
    const weight = { low: 1, medium: 0.6, high: 0.35 } as const;
    const interventions = [...value.interventions]
      .sort((a, b) => b.confidence * weight[b.cost] - a.confidence * weight[a.cost])
      .slice(0, 3);

    return { interventions, rationale: value.rationale, costUsd: usage.costUsd };
  }
}

/** The plan as a person should read it before anything is rebuilt. */
export function planBrief(result: RevisionResult): string {
  if (result.interventions.length === 0) return 'The room proposed nothing.';
  return [
    ...result.interventions.map((i, n) => [
      `${n + 1}. [${i.scope}, ${i.cost} cost, confidence ${i.confidence.toFixed(2)}] — ${i.from}`,
      `   PROBLEM    ${i.problem}`,
      `   CAUSE      ${i.rootCause}`,
      `   DO         ${i.intervention}`,
      `   EXPECT     ${i.expected}`,
      `   MIGHT COST ${i.regression || '(nothing predicted — treat that as unexamined)'}`,
    ].join('\n')),
    '',
    `WHY THESE: ${result.rationale}`,
  ].join('\n');
}
