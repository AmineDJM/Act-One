/**
 * What the Council says, in shapes the rest of the system can act on.
 *
 * The point of schematising a conversation is that a conversation is not a
 * deliverable. Rooms that end in prose end in prose somebody has to interpret,
 * and the interpreting is where the intent gets lost — which is the failure
 * this whole Council exists to fix, one level up. A Room ends in a value.
 */
import { z } from 'zod';
import { DirectorId } from './directors.ts';

/**
 * What a director is DOING when it speaks, and the reason agreement is absent.
 *
 * A contribution that merely agrees, paraphrases or praises changes nothing
 * about the state of the argument and costs the same as one that does. There
 * is no 'agree' move, so a director that has nothing to add says nothing, and
 * the room gets shorter rather than more polite.
 */
export const CouncilMove = z.enum([
  /** Hold a position under attack, with a reason that is not the original one. */
  'defend',
  /** Say why a proposal fails, specifically enough to be answered. */
  'attack',
  /** Take somebody else's idea and say what it is better for than they did. */
  'steal',
  /** Put two proposals together into one that needs both. */
  'combine',
  /** Name what nobody has said yet. */
  'missing',
  /** Ask for the evidence a decision cannot responsibly be made without. */
  'evidence',
  /** Change your own position, and say what changed it. */
  'concede',
]);
export type CouncilMove = z.infer<typeof CouncilMove>;

export const CouncilNote = z.object({
  from: DirectorId,
  move: CouncilMove,
  /** Who or what this is aimed at: a director, a proposal id, a beat id. */
  at: z.array(z.string().max(60)).max(4).default([]),
  /** The contribution itself. Short on purpose: a room is not an essay. */
  text: z.string().min(1).max(900),
  /**
   * What changes if this is accepted.
   *
   * Required, and the load-bearing field. A note that cannot say what would be
   * different is a note that changed nothing, and it is dropped rather than
   * recorded — which is also how the room knows it has stopped making progress.
   */
  delta: z.string().min(1).max(300),
});
export type CouncilNote = z.infer<typeof CouncilNote>;

/** One director's film, thought of before it has heard anybody else's. */
export const Proposal = z.object({
  from: DirectorId,
  thesis: z.string().min(1).max(300),
  viewerExperience: z.string().max(400).default(''),
  opening: z.string().max(400).default(''),
  narrativeIdea: z.string().max(400).default(''),
  heroMoment: z.string().max(400).default(''),
  ending: z.string().max(400).default(''),
  memorableMoments: z.array(z.string().max(200)).max(5).default([]),
  avoid: z.array(z.string().max(200)).max(5).default([]),
  /** What would make this film generic — named by the one proposing it. */
  wouldBeGeneric: z.string().max(300).default(''),
  /** The one direction this director would not get approved, and wants anyway. */
  bold: z.string().max(400).default(''),
});
export type Proposal = z.infer<typeof Proposal>;

/** The Executive Creative Director's call. Round 1 ends here. */
export const FilmThesis = z.object({
  thesis: z.string().min(1).max(300),
  viewerExperience: z.string().max(500).default(''),
  narrativeArc: z.array(z.string().max(200)).max(8).default([]),
  hook: z.string().max(400).default(''),
  heroMoment: z.string().max(400).default(''),
  ending: z.string().max(400).default(''),
  visualPrinciple: z.string().max(400).default(''),
  soundPrinciple: z.string().max(400).default(''),
  productPrinciple: z.string().max(400).default(''),
  memorableMoments: z.array(z.string().max(200)).max(5).default([]),
  distinctive: z.array(z.string().max(250)).max(5).default([]),
  /**
   * What the decision cost, and who lost it.
   *
   * Kept because the alternative is a later reader assuming a rejected idea
   * was never considered, and re-proposing it. A council that does not write
   * down what it rejected argues the same argument every loop.
   */
  rejected: z.array(z.object({
    idea: z.string().max(250),
    from: DirectorId,
    why: z.string().max(300),
  })).max(6).default([]),
  /** Disagreement the Executive chose to preserve rather than settle. */
  unresolved: z.array(z.string().max(250)).max(4).default([]),
});
export type FilmThesis = z.infer<typeof FilmThesis>;

/**
 * How picture and sound are related at a beat, stated rather than assumed.
 *
 * The default relationship in generated film is MATCH — the picture illustrates
 * the sentence — and a film where every beat matches is a slideshow with a
 * voice over it. Naming the relationship forces the choice to be made: the
 * picture may contradict the line, arrive before it, or answer it late.
 */
export const AvRelation = z.enum(['match', 'contrast', 'lead', 'follow']);
export type AvRelation = z.infer<typeof AvRelation>;

/**
 * One row of the AV Beat Sheet: a beat as one audiovisual object.
 *
 * NARRATION, SUBTITLES and ON-SCREEN COPY are three different things and this
 * is where they stop being confused. `narration` is what is said. `onScreenCopy`
 * is editorial typography, which may deliberately say something the voice does
 * not. Subtitles appear in neither, because subtitles are not authored here at
 * all: they are generated from the performed audio's word timings after the
 * take exists, and anything written by hand and labelled "subtitles" is copy
 * wearing the wrong name.
 */
export const AvBeatRow = z.object({
  id: z.string().min(1).max(40),
  meaning: z.string().min(1).max(300),
  sees: z.string().max(400).default(''),
  narration: z.string().max(400).default(''),
  onScreenCopy: z.string().max(200).default(''),
  productState: z.string().max(300).default(''),
  attention: z.string().max(200).default(''),
  camera: z.string().max(250).default(''),
  motion: z.string().max(250).default(''),
  audio: z.string().max(250).default(''),
  transitionIn: z.string().max(200).default(''),
  transitionOut: z.string().max(200).default(''),
  continuity: z.string().max(250).default(''),
  emotion: z.string().max(120).default(''),
  relation: AvRelation.default('match'),
});
export type AvBeatRow = z.infer<typeof AvBeatRow>;

/**
 * A change proposed in the Revision Room, as a causal claim rather than a note.
 *
 * Round 5 is not another criticism round. "The typography is weak" is a
 * criticism; "the emphasis reads as colour-only because hero and rest never
 * appear in the same frame, so raise the contrast by holding the previous
 * phrase" is an intervention. The fields below are what separates them, and
 * `regression` is the one most often skipped: a change with no predicted cost
 * has not been thought about.
 */
export const Intervention = z.object({
  problem: z.string().min(1).max(300),
  evidence: z.array(z.string().max(250)).max(5).default([]),
  rootCause: z.string().min(1).max(400),
  intervention: z.string().min(1).max(500),
  expected: z.string().max(300).default(''),
  regression: z.string().max(300).default(''),
  scope: z.enum(['round_1', 'round_2', 'round_3']).default('round_3'),
  cost: z.enum(['low', 'medium', 'high']).default('low'),
  confidence: z.number().min(0).max(1).default(0.6),
  from: DirectorId,
});
export type Intervention = z.infer<typeof Intervention>;
