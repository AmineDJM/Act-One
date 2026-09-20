import { z } from 'zod';
import {
  CreativeTerritory,
  TerritoryMechanism,
  collapsedTerritories,
  newId,
  territorySpread,
  type AudienceModel,
  type BrandGenome,
  type CreativeBrief,
  type CreativeSignature,
  type ProductUnderstanding,
  type TerritoryVerdict,
} from '@act-one/core';
import { repetitionAgainst, REPETITION_WARNING_THRESHOLD } from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * Creative search, as a search.
 *
 * The strategy engine asks for three concepts and gets three concepts, and
 * three is not a search — it is the first idea and two alternates written to
 * make the first one look considered. This asks for many more, cheaply, at the
 * only stage where exploring is nearly free: before anything has been written
 * in detail, rendered, or paid a provider for.
 *
 * The hard part is not volume. A model asked for twenty directions returns
 * twenty differently-worded versions of about three, because variety in
 * language is what "be diverse" means to it. So diversity is structural and it
 * is measured: a territory declares the *mechanism* it works by and the role
 * the product plays, `territoryDistance` compares those first and the wording
 * last, and a set that collapses is sent back with the collapse described.
 *
 * Nothing here writes a film. A territory is a direction — a premise, a
 * mechanism, an opening image and the reason it might fail. What it is for is
 * to be rejected: most of these should die, and the record of why they died is
 * the part that is worth keeping.
 */

const TerritoryResponse = z.object({
  name: z.string().trim().min(1).max(80),
  premise: z.string().trim().min(1).max(300),
  mechanism: TerritoryMechanism,
  rationale: z.string().trim().min(1).max(400),
  emotion: z.string().trim().min(1).max(80),
  productRole: z.enum(['hero', 'evidence', 'context', 'absent']),
  opening: z.string().trim().min(1).max(300),
  risk: z.string().trim().min(1).max(300),
});

const Batch = z.object({ territories: z.array(TerritoryResponse).min(1).max(40) });

const SYSTEM_PROMPT = [
  'You are in the room at the start of a launch film project, before anybody has written a script.',
  'Your job is to put genuinely different directions on the table — not variations, directions.',
  '',
  'Two directions are different when the FILM would be structurally different: what carries it,',
  'what the product does in it, what the first image is, what emotion it works on. Two directions',
  'are the same when only the adjectives changed. "Fast modern launch", "Bold dynamic launch" and',
  '"Energetic contemporary launch" are one direction written three times, and returning that is',
  'the single failure mode of this task.',
  '',
  'Each direction must name the mechanism it works by, and different directions must use',
  'different mechanisms. A direction must also name how it could fail — a direction with no risk',
  'in it is a cliché that nobody has examined.',
  '',
  'Write like somebody pitching, in concrete nouns. "The cursor hesitates, then commits."',
  'Not "dynamic and engaging interactions".',
  '',
  'Avoid: glowing brains, neural filigree, humanoid robots, purple gradients, particles, stock',
  'people pleased at laptops, "imagine a world where", and any opening that would work equally',
  'well for a competitor.',
  '',
  'Return JSON only.',
].join('\n');

export type TerritorySearchInput = {
  brief: CreativeBrief;
  understanding: ProductUnderstanding;
  audience: AudienceModel;
  genome: BrandGenome;
  /** What this workspace has made lately, so the search can avoid repeating itself. */
  recentSignatures: readonly CreativeSignature[];
  /**
   * How wide to search.
   *
   * Adaptive rather than fixed: a thirty-second product tour for a small
   * workspace does not need fifty directions explored, and spending fifty
   * model calls to prove it would be the wrong kind of rigour. The caller
   * decides from the budget and the ambition of the brief.
   */
  target?: number;
};

export type TerritorySearch = {
  territories: CreativeTerritory[];
  verdicts: TerritoryVerdict[];
  /** Mean pairwise distance of what survived. Diagnostic, not a quality score. */
  spread: number;
  /** Devices already used recently that this search reached for again. */
  repeated: string[];
  costUsd: number;
  rounds: number;
};

/** Below this spread, a set is one idea wearing several hats. */
export const COLLAPSE_THRESHOLD = 0.4;

export class TerritorySearchEngine {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async explore(input: TerritorySearchInput, context: CallContext): Promise<TerritorySearch> {
    const target = Math.max(4, Math.min(40, input.target ?? 16));
    const verdicts: TerritoryVerdict[] = [];
    let costUsd = 0;
    let rounds = 0;

    let kept: CreativeTerritory[] = [];
    /*
     * Two rounds at most. The first asks broadly; the second, only if the
     * first collapsed, asks again naming the mechanisms already spent and the
     * devices this workspace has been leaning on. A third round has never once
     * been the difference between a good film and a bad one, and it is a model
     * call somebody pays for.
     */
    for (let round = 0; round < 2; round += 1) {
      const need = target - kept.length;
      if (need <= 0) break;
      rounds += 1;

      const { value, usage } = await this.llm.completeJson(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: this.prompt(input, need, kept) },
        ],
        {
          schema: Batch,
          schemaName: 'creative_territories',
          // Cheap on purpose. This is the widest, least committed stage of the
          // whole production and the place where breadth beats depth.
          tier: 'fast',
          temperature: 1,
          maxOutputTokens: 6000,
          repairAttempts: 1,
        },
        context,
      );
      costUsd += usage.costUsd;

      const proposed: CreativeTerritory[] = value.territories.map((territory) =>
        CreativeTerritory.parse({ id: newId('ter'), ...territory }),
      );

      /*
       * Duplicates are removed against everything already kept, not only
       * within the batch — otherwise the second round happily re-proposes the
       * first round's best idea and the search looks twice as wide as it is.
       */
      const pool = [...kept, ...proposed];
      const drop = new Set(collapsedTerritories(pool, COLLAPSE_THRESHOLD));
      for (const [index, territory] of pool.entries()) {
        if (index < kept.length) continue;
        if (drop.has(index)) {
          verdicts.push({
            territoryId: territory.id,
            kept: false,
            reason: 'duplicate',
            note: 'Another direction on the table already works the same way.',
          });
        } else {
          kept.push(territory);
          verdicts.push({ territoryId: territory.id, kept: true, reason: null, note: '' });
        }
      }

      if (territorySpread(kept) >= COLLAPSE_THRESHOLD && kept.length >= Math.ceil(target * 0.6)) break;
    }

    const repetition = repetitionAgainst(
      input.recentSignatures,
      kept.map((territory) => ({ kind: 'opening' as const, device: territory.opening })),
    );

    return {
      territories: kept,
      verdicts,
      spread: territorySpread(kept),
      repeated: repetition.score >= REPETITION_WARNING_THRESHOLD ? repetition.repeated : [],
      costUsd,
      rounds,
    };
  }

  private prompt(input: TerritorySearchInput, need: number, already: CreativeTerritory[]): string {
    const { brief, understanding, audience, genome } = input;
    const spent = [...new Set(already.map((territory) => territory.mechanism))];
    const recentOpenings = [...new Set(input.recentSignatures.filter((s) => s.kind === 'opening').map((s) => s.device))];

    return [
      `THE ASSIGNMENT`,
      `${brief.company} — ${brief.product}.`,
      `A ${brief.durationSeconds}s ${brief.filmFormat.replace(/_/g, ' ')}, ${brief.filmCut === 'short' ? 'vertical short' : 'landscape film'}, in ${brief.language}.`,
      ``,
      `THE BUSINESS NEEDS: ${brief.goal.business.replace(/_/g, ' ')}.`,
      brief.goal.desiredAction ? `The viewer should: ${brief.goal.desiredAction}.` : 'No action is asked for; this film is about belief.',
      `THE FILM MUST: ${brief.creativeObjective}`,
      ``,
      `THE VIEWER WALKS IN BELIEVING: ${brief.transformation.before}`,
      `THEY SHOULD WALK OUT BELIEVING: ${brief.transformation.after}`,
      `THE THING THAT HAS TO LAND: ${brief.transformation.pivot}`,
      ``,
      `WHO THEY ARE: ${audience.who}. ${audience.sophistication}.`,
      audience.objections.length > 0 ? `They will object: ${audience.objections.slice(0, 4).join('; ')}.` : '',
      audience.statusQuo ? `Today they instead: ${audience.statusQuo}.` : '',
      ``,
      `THE PRODUCT: ${understanding.oneLiner}`,
      understanding.differentiators.length > 0
        ? `What is actually different: ${understanding.differentiators.slice(0, 4).map((d) => d.text).join('; ')}.`
        : '',
      understanding.productMoments.length > 0
        ? `Moments we can actually film: ${understanding.productMoments.slice(0, 6).map((m) => m.title).join('; ')}.`
        : 'We hold no captures of the product in use.',
      ``,
      `THE BRAND BEHAVES LIKE THIS: ${genome.archetype.replace(/_/g, ' ')}. ${genome.languageBehaviour}`,
      genome.taboos.length > 0 ? `It would never: ${genome.taboos.slice(0, 5).join('; ')}.` : '',
      brief.avoid.length > 0 ? `The customer asked to avoid: ${brief.avoid.join('; ')}.` : '',
      brief.mustShow.length > 0 ? `The customer asked to show: ${brief.mustShow.join('; ')}.` : '',
      ``,
      spent.length > 0
        ? `ALREADY ON THE TABLE, so do not propose these mechanisms again: ${spent.join(', ')}.`
        : '',
      recentOpenings.length > 0
        ? `This studio has opened films like this recently and should not again: ${recentOpenings.slice(0, 6).join('; ')}.`
        : '',
      ``,
      `Give me ${need} directions. Structurally different from each other. JSON only.`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
