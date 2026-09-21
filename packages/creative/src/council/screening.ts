/**
 * ROUND 4 — the Screening Room. What did we actually make?
 *
 * EVERYONE WATCHES THE REAL FILM. Not the beat sheet, not the scene graph, not
 * the intent. This project has repeatedly reported a defect fixed on the
 * strength of the code that was supposed to fix it — a crop the renderer
 * discarded, a caption band behind the page, a dialogue correction that never
 * ran — and each time the MP4 said otherwise. The only artifact that counts is
 * the one a viewer would see.
 *
 * INDEPENDENT FIRST, AND IT IS NOT A FORMALITY. The first reaction in a room
 * sets the terms for every reaction after it; a director who reads "the opening
 * is generic" before forming a view will find the opening generic. So each
 * director watches alone, with its own lens and nobody else's words, and only
 * then sees what the others said. That ordering is the difference between five
 * opinions and one opinion with four endorsements.
 *
 * DYNAMIC PARTICIPATION. Not everybody watches every cut. A screening about
 * pacing and narration does not need the art director's vote to be legitimate,
 * and seven video readings of the same file is the exact "more agents must mean
 * more intelligence" failure this is supposed to avoid. The caller routes.
 */
import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { DIRECTORS, DirectorId } from './directors.ts';
import { CouncilNote } from './types.ts';

/**
 * What one director saw, before it heard anybody.
 *
 * `worksBecause` is asked for first and deliberately: a room that only ever
 * names faults will dismantle the things that are working, and this film has
 * already lost a shot that way.
 */
export const Reaction = z.object({
  from: DirectorId,
  /** The film in one line, as this director would describe it to a peer. */
  readback: z.string().max(400).default(''),
  worksBecause: z.array(z.string().max(300)).max(3).default([]),
  /** Faults, each anchored to a second. A note without a timecode is an opinion. */
  problems: z.array(z.object({
    atSeconds: z.number().min(0),
    what: z.string().min(1).max(300),
    /** What in the film makes this true — what is on screen or in the sound. */
    evidence: z.string().max(300).default(''),
    severity: z.enum(['note', 'medium', 'high', 'critical']).default('medium'),
  })).max(6).default([]),
  /** The single moment worth keeping if the film had to lose everything else. */
  memorable: z.string().max(300).default(''),
  /** Where a reference film is still plainly better, and why. */
  benchmarkGap: z.string().max(400).default(''),
});
export type Reaction = z.infer<typeof Reaction>;

/** What a director is asked, on top of its standing lens. */
const SCREENING_QUESTIONS = [
  'Does the narration actually narrate THIS film, or is it good copy over unrelated pictures?',
  'Does every important spoken idea have a visual consequence, and does every major visual event have a reason?',
  'Does motion respond to the voice — its emphasis, its pauses — or run on its own clock?',
  'Does music interact with the structure, or play underneath it?',
  'Where does attention drop? Name the second.',
  'What feels generic, and what would be memorable to somebody who watched it once?',
  'Could this film belong to a different company with the logo swapped?',
];

const BANNED = 'premium, polished, professional, elevated, sleek, modern, clean, dynamic, engaging';

export function screeningBrief(id: DirectorId, thesis: string): string {
  const spec = DIRECTORS[id];
  return [
    `You are ${spec.title}. You are responsible for the whole film, not your specialty.`,
    `Your objective: ${spec.objective}`,
    `You notice first: ${spec.blindToNobody.join(' ')}`,
    `The bias you are allowed: ${spec.bias}`,
    '',
    `THE FILM WAS MADE TO THIS THESIS: ${thesis}`,
    '',
    'Watch it. You have not heard anybody else and you will not until you have finished.',
    'Judge what is ON SCREEN and IN THE SOUND, not what was intended.',
    '',
    ...SCREENING_QUESTIONS.map((q) => `- ${q}`),
    '',
    'Anchor every problem to a second. A note without a timecode cannot be acted on.',
    `Banned words: ${BANNED}. "Feels generic" on its own is not a finding — say what is generic and why.`,
  ].join('\n');
}

/** Watches the film and answers as one director. Supplied by the caller. */
export type WatchFilm = (id: DirectorId, brief: string) => Promise<Reaction>;

export type ScreeningResult = {
  reactions: Reaction[];
  notes: CouncilNote[];
  /** Directors that were routed in but did not answer. A thin room, said out loud. */
  absent: DirectorId[];
  costUsd: number;
};

export class ScreeningRoom {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * Independent viewings, then one discussion pass.
   *
   * One pass, not two. The screening's job is to establish what is on the
   * screen and where the room disagrees about it; working out what to DO is
   * Round 5's job, and letting the screening drift into proposing fixes is how
   * a diagnosis becomes an argument about solutions before the problem is
   * agreed.
   */
  async screen(
    filmPath: string,
    thesis: string,
    watch: WatchFilm,
    context: CallContext,
    options: { roster?: readonly DirectorId[] } = {},
  ): Promise<ScreeningResult> {
    const roster = options.roster ?? (['story', 'art', 'motion', 'sound', 'product'] as DirectorId[]);
    const absent: DirectorId[] = [];
    let costUsd = 0;

    const settled = await Promise.allSettled(
      roster.map((id) => watch(id, screeningBrief(id, thesis))),
    );
    const reactions: Reaction[] = [];
    for (const [i, result] of settled.entries()) {
      if (result.status === 'fulfilled') reactions.push(result.value);
      else {
        absent.push(roster[i]!);
        console.error(`[screening] ${roster[i]} did not report:`, (result.reason as Error).message.slice(0, 160));
      }
    }
    if (reactions.length === 0) return { reactions, notes: [], absent, costUsd };

    /*
     * The discussion sees the reactions as a table of observations rather than
     * as prose, so that a director is arguing with what was SEEN rather than
     * with how somebody wrote it up.
     */
    const seen = reactions.map((r) => [
      `--- ${r.from} ---`,
      r.readback && `SAW: ${r.readback}`,
      r.worksBecause.length ? `WORKS: ${r.worksBecause.join(' / ')}` : '',
      ...r.problems.map((p) => `PROBLEM @${p.atSeconds}s [${p.severity}] ${p.what}${p.evidence ? ` (${p.evidence})` : ''}`),
      r.memorable && `MEMORABLE: ${r.memorable}`,
      r.benchmarkGap && `REFERENCES STILL BETTER: ${r.benchmarkGap}`,
    ].filter(Boolean).join('\n')).join('\n\n');

    const round = await Promise.allSettled(
      reactions.map((r) => r.from).map(async (id) => {
        const { value, usage } = await this.llm.completeJson(
          [
            { role: 'system', content: screeningBrief(id, thesis) },
            {
              role: 'user',
              content: [
                'THE ROOM HAS NOW REPORTED. These are the other viewings.',
                '',
                seen,
                '',
                'Say up to three things, and every one must change the state of the argument:',
                'attack a reading you believe is wrong and say what you saw instead; combine two',
                'observations into one cause; name what everybody missed; ask for the evidence a',
                'judgement cannot responsibly be made without; or change your own mind and say what',
                'changed it.',
                '',
                'Do NOT propose fixes. What to do about any of this is the next room\'s work, and a',
                'diagnosis that turns into an argument about solutions stops being a diagnosis.',
                '',
                'Agreement is not a contribution. If you have nothing that changes the argument,',
                'return an empty list — a screening that ends early because everyone saw the same',
                'film is a real result.',
              ].join('\n'),
            },
          ],
          { schema: z.object({ notes: z.array(CouncilNote.omit({ from: true })).max(3).default([]) }), schemaName: 'screening_notes', tier: 'balanced', temperature: 0.6, maxOutputTokens: 1100, repairAttempts: 1 },
          context,
        );
        return { notes: value.notes.map((n) => ({ ...n, from: id }) as CouncilNote), costUsd: usage.costUsd };
      }),
    );

    const notes: CouncilNote[] = [];
    for (const result of round) {
      if (result.status === 'fulfilled') {
        notes.push(...result.value.notes);
        costUsd += result.value.costUsd;
      }
    }

    return { reactions, notes, absent, costUsd };
  }
}

/**
 * Problems more than one director independently saw, and where they disagree.
 *
 * Preserved rather than merged. Two directors naming the same second from
 * different lenses is the strongest signal a screening produces; one director
 * alone naming something nobody else did is the second strongest, and
 * collapsing both into a ranked list throws away which is which.
 */
export function converged(reactions: readonly Reaction[], toleranceSeconds = 2.5): {
  atSeconds: number; seenBy: DirectorId[]; what: string[]; severity: string;
}[] {
  const all = reactions.flatMap((r) => r.problems.map((p) => ({ ...p, from: r.from })));
  const clusters: { atSeconds: number; seenBy: DirectorId[]; what: string[]; severity: string }[] = [];
  const order = ['note', 'medium', 'high', 'critical'];

  for (const problem of all.sort((a, b) => a.atSeconds - b.atSeconds)) {
    const near = clusters.find((c) => Math.abs(c.atSeconds - problem.atSeconds) <= toleranceSeconds);
    if (near && !near.seenBy.includes(problem.from)) {
      near.seenBy.push(problem.from);
      near.what.push(problem.what);
      if (order.indexOf(problem.severity) > order.indexOf(near.severity)) near.severity = problem.severity;
    } else if (!near) {
      clusters.push({ atSeconds: problem.atSeconds, seenBy: [problem.from], what: [problem.what], severity: problem.severity });
    }
  }
  // Most-witnessed first, then most severe: a moment three directors stopped on
  // outranks one person's critical note, which is a judgement worth stating.
  return clusters.sort((a, b) => b.seenBy.length - a.seenBy.length || order.indexOf(b.severity) - order.indexOf(a.severity));
}
