/**
 * A Room: private thinking, then an argument, then somebody decides.
 *
 * THE THREE FAILURE MODES THIS IS BUILT AGAINST.
 *
 * One: parallel monologues. Seven agents answering the same prompt and a
 * summariser stapling the answers together is not a discussion, and it is what
 * most "multi-agent" systems actually do. Here a director in the confrontation
 * phase is shown what the others said and may only respond with a MOVE — attack
 * a specific proposal, steal from one, combine two, name what is missing, ask
 * for evidence, or change its own mind. There is no 'agree'.
 *
 * Two: convergence. Personas in conversation are agreeable by construction and
 * drift toward the first strong opinion in the room. So the ideation happens in
 * PRIVATE — nobody sees anybody until every proposal exists — which is the only
 * cheap way to get genuine diversity out of one model. The order proposals are
 * shown in is rotated per director as well, because whatever is first on the
 * page gets argued with most.
 *
 * Three: the conversation that will not end. Every note must carry a `delta`
 * saying what changes if it is accepted, and a cycle that produces no new
 * deltas ends the room whether or not its budget is spent. Repetition in
 * different words is the signal to stop, not the signal to add a cycle.
 *
 * COST. Ideation and confrontation run on the balanced tier and in parallel;
 * only the Executive's synthesis runs deep, because that is the call that
 * cannot be taken again cheaply. Seven directors at maximum reasoning depth on
 * every message is how a council becomes more expensive than the film.
 */
import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { DIRECTORS, DirectorId, EXECUTIVE, type DirectorSpec } from './directors.ts';
import { CouncilNote, FilmThesis, Proposal } from './types.ts';

/** What every director in a room is given, before its own lens is added. */
export type RoomBrief = {
  /** What the product actually is and does, in claims that were verified. */
  productTruth: string;
  audience: string;
  objective: string;
  durationSeconds: number;
  brandEssence: string;
  /** What the reference films do, and what makes them work. */
  benchmarks: string;
  /** Anything already decided that the room may not re-open. */
  constraints?: readonly string[];
};

export type RoomResult = {
  proposals: Proposal[];
  notes: CouncilNote[];
  thesis: FilmThesis;
  costUsd: number;
  /** Directors that did not answer, so a thin room is visible rather than silent. */
  absent: DirectorId[];
  cycles: number;
};

const ROSTER = Object.keys(DIRECTORS) as DirectorId[];

function lens(id: DirectorId, spec: DirectorSpec): string {
  return [
    `You are ${spec.title}.`,
    '',
    'You are a world-class commercial film director, responsible for the ENTIRE finished film:',
    'story, picture, camera, edit, motion, sound, music, product communication and what the viewer',
    'is left with. The lens below is what you notice FIRST and argue from. It is not your department',
    'and it is not a boundary. You may redesign a shot, challenge the narration, reject a beautiful',
    'scene, or say the sound is the problem. A director who only ever discusses their own specialty',
    'is not doing this job.',
    '',
    `YOUR OBJECTIVE: ${spec.objective}`,
    `YOU OPEN WITH: ${spec.opening}`,
    '',
    'FAULTS YOU SEE BEFORE ANYBODY ELSE DOES:',
    ...spec.blindToNobody.map((f) => `- ${f}`),
    '',
    `EVIDENCE YOU TRUST: ${spec.evidence}`,
    `THE BIAS YOU ARE ALLOWED: ${spec.bias}`,
    '',
    'Be specific. Name beats, seconds, words, colours. A note that cannot be executed is worthless,',
    'and these words are banned in every field you write: premium, polished, professional, elevated,',
    'sleek, modern, clean, dynamic, engaging.',
    `You are ${id}.`,
  ].join('\n');
}

function briefText(brief: RoomBrief): string {
  return [
    `PRODUCT TRUTH (verified):\n${brief.productTruth}`,
    `AUDIENCE:\n${brief.audience}`,
    `OBJECTIVE:\n${brief.objective}`,
    `DURATION: about ${brief.durationSeconds} seconds.`,
    `BRAND ESSENCE:\n${brief.brandEssence}`,
    `BENCHMARK REFERENCES:\n${brief.benchmarks}`,
    ...(brief.constraints && brief.constraints.length > 0
      ? [`ALREADY DECIDED — do not re-open:\n${brief.constraints.map((c) => `- ${c}`).join('\n')}`]
      : []),
  ].join('\n\n');
}

/** Proposals as the room reads them, rotated so nobody's is always first. */
function proposalsFor(reader: DirectorId, proposals: readonly Proposal[]): string {
  const others = proposals.filter((p) => p.from !== reader);
  const offset = ROSTER.indexOf(reader);
  const rotated = [...others.slice(offset % Math.max(1, others.length)), ...others.slice(0, offset % Math.max(1, others.length))];
  return rotated
    .map((p) => [
      `--- ${p.from} ---`,
      `THESIS: ${p.thesis}`,
      p.opening && `OPENING: ${p.opening}`,
      p.heroMoment && `HERO: ${p.heroMoment}`,
      p.ending && `ENDING: ${p.ending}`,
      p.bold && `BOLD: ${p.bold}`,
      p.wouldBeGeneric && `WOULD BE GENERIC IF: ${p.wouldBeGeneric}`,
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

export class CreativeRoom {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * ROUND 1. What film should we make?
   *
   * Private ideation, then up to `maxCycles` confrontation cycles, then one
   * synthesis. The default of two cycles is the brief's, and the room will
   * usually stop at one: the second cycle only happens if the first produced
   * deltas, which is the test for whether anybody is still saying anything.
   */
  async creativeRoom(
    brief: RoomBrief,
    context: CallContext,
    options: { maxCycles?: number; roster?: readonly DirectorId[] } = {},
  ): Promise<RoomResult> {
    const roster = options.roster ?? ROSTER;
    const maxCycles = options.maxCycles ?? 2;
    let costUsd = 0;
    const absent: DirectorId[] = [];

    // --- private ideation ---------------------------------------------------
    const settled = await Promise.allSettled(
      roster.map(async (id) => {
        const { value, usage } = await this.llm.completeJson(
          [
            { role: 'system', content: lens(id, DIRECTORS[id]) },
            {
              role: 'user',
              content: [
                briefText(brief),
                '',
                'You have not heard anybody else and you will not until you have finished.',
                'Propose YOUR film. Do not hedge toward what a group would accept: the room needs',
                'your actual position, and a proposal that could have come from any of the seven',
                'is worth nothing to it.',
              ].join('\n'),
            },
          ],
          { schema: Proposal.omit({ from: true }), schemaName: 'proposal', tier: 'balanced', temperature: 0.85, maxOutputTokens: 1400, repairAttempts: 1 },
          context,
        );
        return { proposal: { ...value, from: id } as Proposal, costUsd: usage.costUsd };
      }),
    );

    const proposals: Proposal[] = [];
    for (const [i, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        proposals.push(result.value.proposal);
        costUsd += result.value.costUsd;
      } else {
        absent.push(roster[i]!);
        console.error(`[council] ${roster[i]} did not propose:`, (result.reason as Error).message.slice(0, 160));
      }
    }
    if (proposals.length === 0) throw new Error('No director proposed a film; the room cannot sit.');

    // --- confrontation ------------------------------------------------------
    const notes: CouncilNote[] = [];
    let cycles = 0;
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      const before = notes.length;
      const speaking = proposals.map((p) => p.from);
      const round = await Promise.allSettled(
        speaking.map(async (id) => {
          const { value, usage } = await this.llm.completeJson(
            [
              { role: 'system', content: lens(id, DIRECTORS[id]) },
              {
                role: 'user',
                content: [
                  briefText(brief),
                  '',
                  'THE ROOM. These are the other directors\' films.',
                  '',
                  proposalsFor(id, proposals),
                  ...(notes.length > 0
                    ? ['', 'WHAT HAS BEEN SAID SO FAR:', notes.slice(-14).map((n) => `${n.from} [${n.move}] ${n.text}`).join('\n')]
                    : []),
                  '',
                  'Say up to three things. Every one must be a MOVE that changes the state of the',
                  'argument: attack a specific proposal and say why it fails; steal an idea and say',
                  'what it is better for than its author said; combine two into one that needs both;',
                  'name what nobody has said; ask for the evidence a decision cannot responsibly be',
                  'made without; or change your own mind and say what changed it.',
                  '',
                  'Agreement is not a move. Praise is not a move. Restating your proposal is not a',
                  'move. If you have nothing that changes the argument, return an empty list — that',
                  'is a real and useful answer and it ends the room sooner.',
                  '',
                  'Every note must say, in `delta`, what would be DIFFERENT about the film if it were',
                  'accepted. A note whose delta is vague is a note you have not thought through.',
                ].join('\n'),
              },
            ],
            { schema: z.object({ notes: z.array(CouncilNote.omit({ from: true })).max(3).default([]) }), schemaName: 'council_notes', tier: 'balanced', temperature: 0.7, maxOutputTokens: 1200, repairAttempts: 1 },
            context,
          );
          return { notes: value.notes.map((n) => ({ ...n, from: id }) as CouncilNote), costUsd: usage.costUsd };
        }),
      );
      for (const result of round) {
        if (result.status === 'fulfilled') {
          notes.push(...result.value.notes);
          costUsd += result.value.costUsd;
        }
      }
      cycles = cycle + 1;
      /*
       * Diminishing returns, detected rather than assumed. A cycle in which
       * nobody found anything to change is the room telling you it is finished,
       * and running the next one buys seven restatements at full price.
       */
      if (notes.length === before) break;
    }

    // --- synthesis ----------------------------------------------------------
    const { value: thesis, usage } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content: [
            `You are the ${EXECUTIVE.title}.`,
            '',
            'You did not propose a film and you did not argue. You read the room and you decide.',
            '',
            ...EXECUTIVE.duty.map((d) => `- ${d}`),
            '',
            'You may take an idea only ONE director argued for, if that argument is the strongest in',
            'the room. What you may not do is average, split the difference, or pick the proposal with',
            'the most support. The idea everyone could live with is usually the one nobody remembers,',
            'and rejecting it is the main thing you are for.',
            '',
            'Banned in every field: premium, polished, professional, elevated, sleek, modern, clean,',
            'dynamic, engaging.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            briefText(brief),
            '',
            'THE PROPOSALS:',
            proposals.map((p) => [
              `--- ${p.from} ---`,
              `THESIS: ${p.thesis}`,
              `EXPERIENCE: ${p.viewerExperience}`,
              `OPENING: ${p.opening}`,
              `NARRATIVE: ${p.narrativeIdea}`,
              `HERO: ${p.heroMoment}`,
              `ENDING: ${p.ending}`,
              `MEMORABLE: ${p.memorableMoments.join(' / ')}`,
              `AVOID: ${p.avoid.join(' / ')}`,
              `GENERIC IF: ${p.wouldBeGeneric}`,
              `BOLD: ${p.bold}`,
            ].join('\n')).join('\n\n'),
            '',
            'THE ARGUMENT:',
            notes.map((n) => `${n.from} [${n.move}${n.at.length ? ' -> ' + n.at.join(',') : ''}] ${n.text}\n    DELTA: ${n.delta}`).join('\n'),
            '',
            'Decide. Record what you rejected and why, including ideas you found tempting, so that',
            'nobody re-proposes them next loop. Record the disagreements you are choosing to keep',
            'rather than settle — a film can ship with an argument still live inside it, and pretending',
            'the room agreed is how an intentional decision gets undone later by somebody who thought',
            'it was an oversight.',
          ].join('\n'),
        },
      ],
      { schema: FilmThesis, schemaName: 'film_thesis', tier: 'deep', temperature: 0.5, maxOutputTokens: 2200, repairAttempts: 1 },
      context,
    );
    costUsd += usage.costUsd;

    return { proposals, notes, thesis, costUsd, absent, cycles };
  }
}
