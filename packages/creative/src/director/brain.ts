import { z } from 'zod';
import {
  CriticId,
  DirectorDecision,
  RejectionReason,
  newId,
  disagreements,
  paretoFront,
  strictestVerdict,
  type AudienceModel,
  type BrandGenome,
  type CreativeBrief,
  type CreativeEvaluation,
  type CreativeTerritory,
  type CreativeVerdict,
  type CriticReview,
  type TerritoryVerdict,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * The Director Brain.
 *
 * One authority. The critics advise and the search proposes; this decides, and
 * it is the only thing in the creative layer that does.
 *
 * That constraint is the whole design. The obvious way to build this is a room
 * full of personas talking until they agree, and it produces work that is
 * agreeable and forgettable — nine specialists negotiating converge on the
 * intersection of nine sets of caution, which is the safest and dullest film
 * available. So the panel never converges: the critics are run apart, they are
 * told to argue their own position as hard as it deserves, and their
 * disagreements are handed here as the most useful thing they produced.
 *
 * What this returns is never a score. It is a decision with a reason, the
 * options it did not take, and the conflicts it had to settle — persisted, so
 * that six months from now the question "why does this film end on silence"
 * has an answer written by whoever ended it on silence.
 */

export const DIRECTOR_VERSION = 'v1';

const Arbitration = z.object({
  between: z.array(CriticId).min(2).max(4),
  conflict: z.string().trim().min(1).max(300),
  resolution: z.string().trim().min(1).max(300),
});

const SelectionResponse = z.object({
  /** The id of the chosen candidate. */
  selectedId: z.string().min(1),
  /** One sentence, past tense, naming the evidence. */
  reason: z.string().trim().min(1).max(600),
  /** What this direction commits the film to. */
  thesis: z.string().trim().min(1).max(300),
  /** Candidates rejected, with the reason each died. */
  rejections: z
    .array(z.object({ id: z.string(), reason: RejectionReason, note: z.string().max(200).default('') }))
    .max(40)
    .default([]),
  /** Conflicts between critics that the director settled. */
  arbitrations: z.array(Arbitration).max(6).default([]),
  /**
   * Where the chosen direction is weak, stated by the director itself.
   *
   * Required. A director who cannot name the weakest part of their own choice
   * has not examined it, and this is the field that most often turns into the
   * next revision.
   */
  weakest: z.string().trim().min(1).max(400),
});

const GateResponse = z.object({
  verdict: z.enum(['pass', 'pass_with_concerns', 'revise', 'block']),
  reason: z.string().trim().min(1).max(600),
  /** What specifically to change, when the verdict is revise. */
  changes: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  arbitrations: z.array(Arbitration).max(6).default([]),
  weakest: z.string().trim().min(1).max(400),
});

const SYSTEM_PROMPT = [
  'You are the creative director of a studio that makes launch films for software companies.',
  'The work in front of you was developed by your team and reviewed by nine specialists.',
  '',
  'You are the only one who decides. The specialists were deliberately kept apart and told to',
  'argue their own position as hard as it deserves, so some of them contradict each other. That is',
  'the input you asked for, not a problem to be averaged: when the conversion specialist wants a',
  'louder call to action and the film critic says it would destroy the ending, one of them is',
  'right about this particular film and you know which, because you know what the film is for.',
  '',
  'Record every conflict you settle and how you settled it.',
  '',
  'You are choosing, not scoring. Do not pick the candidate that is second-best at everything over',
  'the one that is extraordinary at the two things this brief is actually about. A film that is',
  'merely competent is a failure — it is the normal output of an automated process and the reason',
  'you exist.',
  '',
  'Name the weakest part of what you chose. Every time. A director who cannot is not looking.',
  '',
  'Return JSON only.',
].join('\n');

export type DirectorContext = {
  projectId: string;
  brief: CreativeBrief;
  audience: AudienceModel;
  genome: BrandGenome;
};

export type SelectionInput = DirectorContext & {
  territories: readonly CreativeTerritory[];
  reviews: readonly CriticReview[];
  evaluations?: readonly CreativeEvaluation[];
  /** Devices this studio has used recently, as a warning rather than a ban. */
  repeatedDevices?: readonly string[];
};

export type Selection = {
  territory: CreativeTerritory;
  decision: DirectorDecision;
  /** Everything not chosen, with the reason it died. */
  verdicts: TerritoryVerdict[];
  costUsd: number;
};

export class DirectorBrain {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * Chooses a direction from what the search found.
   *
   * The field is narrowed first by `paretoFront`, which is the only narrowing
   * that costs nothing creatively: a candidate another one beats on every
   * single dimension is not a trade-off, it is simply worse. Everything that
   * survives is a genuine trade-off, and choosing between trade-offs is the
   * job this class exists to do rather than something arithmetic should be
   * allowed to settle.
   */
  async select(input: SelectionInput, context: CallContext): Promise<Selection> {
    if (input.territories.length === 0) {
      throw new Error('The director was given no directions to choose between.');
    }

    const shortlist = this.shortlist(input);
    const { value, usage } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.selectionPrompt(input, shortlist) },
      ],
      {
        schema: SelectionResponse,
        schemaName: 'director_selection',
        // The one call in this layer worth the deep tier: everything upstream
        // was breadth and everything downstream is execution.
        tier: 'deep',
        temperature: 0.7,
        maxOutputTokens: 3000,
        repairAttempts: 1,
      },
      context,
    );

    const chosen =
      shortlist.find((territory) => territory.id === value.selectedId) ??
      /*
       * A model naming an id that is not on the shortlist has answered a
       * question nobody asked. Rather than failing the production, the first
       * of the shortlist stands — it is the one the search itself ranked
       * highest — and the decision record says the choice was not honoured.
       */
      shortlist[0]!;
    const honoured = chosen.id === value.selectedId;

    const stated = new Map(value.rejections.map((entry) => [entry.id, entry] as const));
    const verdicts: TerritoryVerdict[] = input.territories.map((territory) => {
      if (territory.id === chosen.id) return { territoryId: territory.id, kept: true, reason: null, note: '' };
      const said = stated.get(territory.id);
      return {
        territoryId: territory.id,
        kept: false,
        reason: said?.reason ?? (shortlist.includes(territory) ? 'commercially_weak' : 'too_generic'),
        note: said?.note ?? (shortlist.includes(territory) ? '' : 'Beaten outright by another direction on every dimension.'),
      };
    });

    const decision: DirectorDecision = {
      id: newId('ddn'),
      projectId: input.projectId,
      stage: 'territories',
      decision: `Directed the film as "${chosen.name}": ${value.thesis}`,
      reason: honoured
        ? value.reason
        : `${value.reason} (The director named a direction that was not on the shortlist; the strongest shortlisted direction stands.)`,
      selected: chosen.id,
      rejected: input.territories.filter((t) => t.id !== chosen.id).map((t) => t.id),
      reviewIds: input.reviews.map((review) => review.id),
      arbitrations: value.arbitrations,
      resultArtifactId: chosen.id,
      directorVersion: DIRECTOR_VERSION,
      createdAt: new Date().toISOString(),
    };

    return { territory: chosen, decision, verdicts, costUsd: usage.costUsd };
  }

  /**
   * A gate: does this artifact go on, go back, or stop.
   *
   * The same shape at every stage — concept, animatic, master — because the
   * question is the same one and the only thing that changes is what is being
   * looked at. `revise` comes back with the specific changes, because a gate
   * that says "make it better" has not gated anything.
   */
  async gate(
    input: DirectorContext & {
      stage: DirectorDecision['stage'];
      artifactId: string;
      artifact: string;
      reviews: readonly CriticReview[];
    },
    context: CallContext,
  ): Promise<{ verdict: CreativeVerdict; changes: string[]; decision: DirectorDecision; costUsd: number }> {
    const { value, usage } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.gatePrompt(input) },
      ],
      {
        schema: GateResponse,
        schemaName: 'director_gate',
        tier: 'deep',
        temperature: 0.5,
        maxOutputTokens: 2500,
        repairAttempts: 1,
      },
      context,
    );

    /*
     * The director may be kinder than the panel but never kinder than a block.
     * A critic that found something disqualifying has found it whatever the
     * director thinks of the film overall, and overruling that silently is the
     * behaviour this whole layer exists to prevent.
     */
    const panel = strictestVerdict(input.reviews.map((review) => review.verdict));
    const verdict: CreativeVerdict = panel === 'block' ? 'block' : value.verdict;

    return {
      verdict,
      changes: value.changes,
      costUsd: usage.costUsd,
      decision: {
        id: newId('ddn'),
        projectId: input.projectId,
        stage: input.stage,
        decision: `${verdict.replace(/_/g, ' ')} at the ${input.stage} gate.`,
        reason: value.reason,
        selected: input.artifactId,
        rejected: [],
        reviewIds: input.reviews.map((review) => review.id),
        arbitrations: value.arbitrations,
        resultArtifactId: input.artifactId,
        directorVersion: DIRECTOR_VERSION,
        createdAt: new Date().toISOString(),
      },
    };
  }

  /** Everything nothing else beats outright, capped so the prompt stays readable. */
  private shortlist(input: SelectionInput): CreativeTerritory[] {
    const evaluations = input.evaluations ?? [];
    if (evaluations.length === 0) return [...input.territories].slice(0, 12);

    const byId = new Map(input.territories.map((territory) => [territory.id, territory] as const));
    const front = paretoFront(
      evaluations.filter((evaluation) => byId.has(evaluation.artifactId)),
    );
    const kept = front.map((evaluation) => byId.get(evaluation.artifactId)!).filter(Boolean);
    return (kept.length > 0 ? kept : [...input.territories]).slice(0, 12);
  }

  private selectionPrompt(input: SelectionInput, shortlist: readonly CreativeTerritory[]): string {
    const { brief, audience, genome } = input;
    const conflicts = disagreements(input.reviews);
    const byArtifact = new Map<string, CriticReview[]>();
    for (const review of input.reviews) {
      byArtifact.set(review.artifactId, [...(byArtifact.get(review.artifactId) ?? []), review]);
    }

    return [
      `THE ASSIGNMENT`,
      `${brief.company} — ${brief.product}. A ${brief.durationSeconds}s ${brief.filmFormat.replace(/_/g, ' ')} in ${brief.language}.`,
      `The film must: ${brief.creativeObjective}`,
      `Business objective: ${brief.goal.business.replace(/_/g, ' ')} · call to action: ${brief.goal.ctaStrength}.`,
      `Viewer walks in believing: ${brief.transformation.before}`,
      `They should walk out believing: ${brief.transformation.after}`,
      `The thing that has to land: ${brief.transformation.pivot}`,
      ``,
      `AUDIENCE: ${audience.who} (${audience.sophistication}). ${audience.attentionContext}`,
      audience.objections.length > 0 ? `Objections: ${audience.objections.slice(0, 5).join('; ')}.` : '',
      `BRAND: ${genome.archetype.replace(/_/g, ' ')}. ${genome.languageBehaviour}`,
      genome.taboos.length > 0 ? `Never: ${genome.taboos.slice(0, 5).join('; ')}.` : '',
      ``,
      input.repeatedDevices && input.repeatedDevices.length > 0
        ? `A WARNING, NOT A BAN — this studio has recently used: ${input.repeatedDevices.slice(0, 8).join('; ')}. A direction that repeats one of these needs to be better than one that does not.`
        : '',
      ``,
      `THE DIRECTIONS ON THE TABLE (${shortlist.length} of ${input.territories.length}; the rest were beaten outright):`,
      ...shortlist.map((territory) => describeTerritory(territory, byArtifact.get(territory.id) ?? [])),
      ``,
      conflicts.length > 0
        ? `YOUR SPECIALISTS DISAGREE: ${conflicts.map((c) => `${c.a} vs ${c.b}`).join(', ')}. Settle it and record how.`
        : '',
      ``,
      `Choose one. Say why, name what you are giving up, and name the weakest part of your choice.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private gatePrompt(
    input: DirectorContext & {
      stage: DirectorDecision['stage'];
      artifact: string;
      reviews: readonly CriticReview[];
    },
  ): string {
    const conflicts = disagreements(input.reviews);
    return [
      `THE ASSIGNMENT`,
      `${input.brief.company} — ${input.brief.product}.`,
      `The film must: ${input.brief.creativeObjective}`,
      `Viewer walks in believing: ${input.brief.transformation.before}`,
      `They should walk out believing: ${input.brief.transformation.after}`,
      ``,
      `THE WORK, at the ${input.stage} gate:`,
      input.artifact,
      ``,
      `YOUR SPECIALISTS:`,
      ...input.reviews.map(
        (review) =>
          `- ${review.critic.replace(/_/g, ' ')} — ${review.verdict.replace(/_/g, ' ')}` +
          (review.findings.length > 0
            ? `\n${review.findings
                .map((finding) => `    [${finding.severity}] ${finding.observation}${finding.evidence.length > 0 ? ` (${finding.evidence.join(', ')})` : ''}${finding.recommendation ? ` → ${finding.recommendation}` : ''}`)
                .join('\n')}`
            : '\n    nothing to raise'),
      ),
      ``,
      conflicts.length > 0
        ? `THEY DISAGREE: ${conflicts.map((c) => `${c.a} vs ${c.b}`).join(', ')}. You decide, and record how.`
        : '',
      ``,
      `Does this go on, go back, or stop? If it goes back, say exactly what to change.`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}

function describeTerritory(territory: CreativeTerritory, reviews: readonly CriticReview[]): string {
  const notes = reviews
    .flatMap((review) =>
      review.findings
        .filter((finding) => finding.severity === 'high' || finding.severity === 'critical')
        .map((finding) => `    [${review.critic}] ${finding.observation}`),
    )
    .slice(0, 4);
  return [
    ``,
    `${territory.id} — "${territory.name}" (${territory.mechanism.replace(/_/g, ' ')}, product as ${territory.productRole})`,
    `  ${territory.premise}`,
    `  Opens on: ${territory.opening}`,
    `  Why: ${territory.rationale}`,
    `  Could fail because: ${territory.risk}`,
    reviews.length > 0
      ? `  Panel: ${reviews.map((review) => `${review.critic} ${review.verdict.replace(/_/g, ' ')}`).join(', ')}`
      : '',
    ...notes,
  ]
    .filter(Boolean)
    .join('\n');
}
