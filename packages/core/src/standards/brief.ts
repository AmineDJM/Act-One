import { AUDIO_STANDARDS } from './audio.ts';
import { COLOR_STANDARDS } from './color.ts';
import { CONVERSION_STANDARDS } from './conversion.ts';
import { EDITORIAL_STANDARDS } from './editorial.ts';
import { LAYOUT_STANDARDS } from './layout.ts';
import { MOTION_STANDARDS } from './motion.ts';
import { TYPE_STANDARDS } from './typography.ts';
import { cite, type Standard } from './standard.ts';

/**
 * The standards, as a brief an agent is given.
 *
 * Every creative decision in this system is made by a model, and a model with
 * no standards makes the choices it has seen most often — which is what
 * average work looks like. Telling one to be "professional" does nothing;
 * telling it that a line runs 45 to 75 characters because Bringhurst measured
 * it, and that text stays inside 90% of the frame because EBU R 95 says so,
 * changes the output.
 *
 * So the same corpus the checks are written against is also what the agents
 * are briefed with. That matters more than the convenience: an agent cannot
 * be briefed on a rule that is not in the corpus, a rule cannot be softened
 * for the brief without softening the check, and a new standard reaches every
 * craft it governs the day it is written down.
 *
 * What is deliberately left out: anything the engines enforce themselves.
 * Briefing a model on a number a deterministic renderer already guarantees
 * spends attention on a decision it does not get to make.
 */
export type Craft =
  /** The treatment: what the film argues and how it moves. */
  | 'direction'
  /** The storyboard: what is on screen, where, and for how long. */
  | 'storyboard'
  /** Words on screen. */
  | 'copy'
  /** Words in the ear. */
  | 'narration'
  /** The score and the sound design. */
  | 'sound'
  /** The cut. */
  | 'editing';

const CRAFTS: Record<Craft, Standard[]> = {
  direction: [
    MOTION_STANDARDS.rhythm,
    MOTION_STANDARDS.minimumShot,
    MOTION_STANDARDS.staging,
    EDITORIAL_STANDARDS.noInvention,
    EDITORIAL_STANDARDS.superlatives,
    CONVERSION_STANDARDS.hook,
    CONVERSION_STANDARDS.oneIdea,
  ],
  storyboard: [
    TYPE_STANDARDS.measure,
    TYPE_STANDARDS.minimumSize,
    TYPE_STANDARDS.readingTime,
    LAYOUT_STANDARDS.titleSafe,
    LAYOUT_STANDARDS.actionSafe,
    LAYOUT_STANDARDS.platformChrome,
    COLOR_STANDARDS.textContrast,
    COLOR_STANDARDS.accentRestraint,
    MOTION_STANDARDS.minimumShot,
    MOTION_STANDARDS.rhythm,
    MOTION_STANDARDS.staging,
  ],
  copy: [
    TYPE_STANDARDS.measure,
    TYPE_STANDARDS.readingTime,
    EDITORIAL_STANDARDS.attribution,
    EDITORIAL_STANDARDS.noInvention,
    EDITORIAL_STANDARDS.numbers,
    EDITORIAL_STANDARDS.superlatives,
    CONVERSION_STANDARDS.oneIdea,
    CONVERSION_STANDARDS.soundOff,
  ],
  narration: [
    EDITORIAL_STANDARDS.noInvention,
    EDITORIAL_STANDARDS.numbers,
    AUDIO_STANDARDS.dialogueLead,
    CONVERSION_STANDARDS.hook,
  ],
  sound: [
    AUDIO_STANDARDS.measurement,
    AUDIO_STANDARDS.webTarget,
    AUDIO_STANDARDS.truePeak,
    AUDIO_STANDARDS.dialogueLead,
  ],
  editing: [
    MOTION_STANDARDS.minimumShot,
    MOTION_STANDARDS.rhythm,
    MOTION_STANDARDS.thirtyDegree,
    MOTION_STANDARDS.axisOfAction,
    MOTION_STANDARDS.flashRate,
    CONVERSION_STANDARDS.hook,
    CONVERSION_STANDARDS.durationByChannel,
  ],
};

export function standardsFor(craft: Craft): readonly Standard[] {
  return CRAFTS[craft];
}

/**
 * One line per rule: what it says, who says so, and why.
 *
 * The reasoning is not decoration. A rule a model does not understand is a
 * rule it discards the moment the brief pulls the other way, and the whole
 * point of these is that they hold under pressure.
 */
export function standardsBrief(craft: Craft): string {
  const lines = CRAFTS[craft].map((standard) => {
    const weight = standard.authority === 'normative' ? 'not negotiable' : standard.authority;
    return `- ${standard.rule} (${cite(standard)} — ${weight}) ${standard.because}`;
  });
  return [
    'The standards this work is held to. They are checked after you, and a film that fails one',
    'is sent back, so writing to them is faster than writing around them:',
    '',
    ...lines,
  ].join('\n');
}

/** Every standard an agent may be briefed with, for the console and for tests. */
export function briefedStandards(): Map<Craft, readonly Standard[]> {
  return new Map(Object.entries(CRAFTS) as [Craft, Standard[]][]);
}
