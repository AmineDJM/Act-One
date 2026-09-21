/**
 * What a beat is DOING, and how that reaches both the voice and the picture.
 *
 * THE PROBLEM THIS EXISTS FOR. Every line in the film was read with one
 * direction object — the same stability, the same expressiveness, the same
 * pace, from the hook to the sign-off — and the result was exactly what that
 * describes: a voice that is identical for fifty seconds. Four consecutive
 * craft readings named it as the single strongest tell that a machine made the
 * film, and the note from the person who commissioned it was the same one:
 * monotone from A to Z. Not that it should never be flat — flat is right for
 * some of these lines — but that it is flat for ALL of them, and a read with
 * no variation has no emphasis, because emphasis is a difference.
 *
 * WHY IT IS NOT JUST A VOICE SETTING. A film where the voice leans in and the
 * picture does not is worse than one where neither does: the performance then
 * has nothing to be a performance OF. So an intent is a property of the BEAT,
 * not of the take, and it reaches the camera and the typography as well as the
 * engine. A confided line gets a quieter read AND a stiller frame AND type
 * that arrives more slowly. One decision, three dimensions, which is the only
 * way they end up meaning the same thing.
 *
 * FIVE, NOT FIFTEEN. These are registers a narrator can actually hold and a
 * viewer can actually feel the difference between. A finer scale would be a
 * dial nobody could hear, and this project has already learned what an
 * unhearable parameter costs.
 */

export type BeatIntent =
  /** Told to one person, close. The film's quietest register. */
  | 'confide'
  /** Neutral, factual, unhurried. The default, and right for most of a film. */
  | 'state'
  /** Leaning in: the argument being pushed, faster and less settled. */
  | 'press'
  /** The line the beat turns on. Slow, certain, and given room. */
  | 'land'
  /** Warm and direct: the ask, and the only place the film addresses you. */
  | 'invite';

/**
 * How an intent is performed.
 *
 * `stability` is inverted from what the name suggests: LOWER is a freer, more
 * varied read and higher is a flatter, more consistent one. `profile` is the
 * expressiveness dial — 'neutral' is nearly inflectionless, 'warm' is the most
 * coloured the vendor offers without it becoming advertising.
 */
export type IntentPerformance = {
  stability: 'creative' | 'natural' | 'robust';
  profile: 'premium' | 'warm' | 'neutral';
  pace: 'slow' | 'natural' | 'fast';
  energy: 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high';
  /** How the picture behaves under this register, as a multiplier on travel. */
  cameraEnergy: number;
  /** Seconds between words arriving. A confided line assembles more slowly. */
  staggerSeconds: number;
  /** What this register is for, in the words a director would use. */
  note: string;
};

export const INTENTS: Record<BeatIntent, IntentPerformance> = {
  confide: {
    stability: 'creative', profile: 'warm', pace: 'slow', energy: 'low',
    cameraEnergy: 0.35, staggerSeconds: 0.075,
    note: 'Close and quiet. The camera almost stops and the words assemble one at a time.',
  },
  state: {
    stability: 'natural', profile: 'premium', pace: 'natural', energy: 'medium',
    cameraEnergy: 1, staggerSeconds: 0.045,
    note: 'The film speaking normally. Most beats are this, which is what makes the others read.',
  },
  press: {
    stability: 'creative', profile: 'warm', pace: 'fast', energy: 'medium-high',
    cameraEnergy: 1.5, staggerSeconds: 0.026,
    note: 'Leaning in. The frame travels further and the words arrive almost together.',
  },
  land: {
    stability: 'robust', profile: 'premium', pace: 'slow', energy: 'medium-low',
    cameraEnergy: 0.5, staggerSeconds: 0.09,
    note: 'The turn. Flat on purpose and given room — this is where monotone is the right choice.',
  },
  invite: {
    stability: 'creative', profile: 'warm', pace: 'natural', energy: 'medium',
    cameraEnergy: 0.8, staggerSeconds: 0.05,
    note: 'Addressed to one person. Warm without selling.',
  },
};

/** The performance for a beat, defaulting to the register most beats are in. */
export function performanceFor(intent: BeatIntent | undefined): IntentPerformance {
  return INTENTS[intent ?? 'state'];
}
