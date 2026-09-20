import { z } from 'zod';
import {
  holdCeilingFor,
  TEXT_ARRIVAL_SECONDS,
  MotionRecipeName,
  VisualType,
  readingSecondsFor,
  standardsBrief,
  type BrandSystem,
  type Concept,
  type CreativeEscalation,
  type FilmCut,
  type ProductUnderstanding,
  type ProjectBrief,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { brandDirectionLines, cutDirectionLines, formatDirectionLines } from './brief-lines.ts';

/**
 * The Creative Director, asked to fix a beat rather than to write a film.
 *
 * This is the half of the Director that the repair loop needs and did not
 * have. The deterministic layer can retime a shot, trim a hold and move a
 * caption; it cannot decide that a beat has too little to say for the room it
 * was given, and it must not try — editing a timeline to solve an authorial
 * problem is how a ten-second film becomes a five-second one with every check
 * green.
 *
 * What a senior director does with a weak six-second beat is not "make it
 * shorter". It is: there is not enough here, so split the idea, put the
 * product in the middle of it and move the payoff to the end. That is an
 * authorial operation, it is where `split_scene` belongs, and it is what this
 * asks for.
 *
 * Three things keep it honest. It is given the approved film as constraints
 * rather than as suggestions, so it repairs the film instead of reinventing
 * it. It returns two or three options with what each would cost, so the
 * orchestrator can take the cheapest one that does not weaken the film rather
 * than the first one offered. And every option is checked against the same
 * invariants the deterministic layer is held to before any of them is used —
 * a Director that proposes an unreadable shot is refused exactly like a trim
 * that produces one.
 */

/** What the Director may do to a beat. Authorial operations, not timeline edits. */
export const ReplanStrategy = z.enum([
  'split_scene',
  'rewrite_beat',
  'replace_scene',
  'merge_scenes',
  'add_cutaway',
  'add_product_moment',
  'add_broll',
  'change_visual_concept',
  'change_typography_progression',
  'change_information_density',
  'redistribute_narrative_information',
  'alter_shot_structure',
]);
export type ReplanStrategy = z.infer<typeof ReplanStrategy>;

/** One shot the Director is asking for, in the terms the storyboard uses. */
const ProposedShot = z.object({
  purpose: z.string().trim().min(1).max(200),
  /** Seconds. The options as a whole must add up to the room being filled. */
  duration: z.number().min(0.6).max(30),
  visualType: VisualType,
  motionRecipe: MotionRecipeName,
  /** At most two lines. Three is a slide, not a shot. */
  onScreenText: z.array(z.string().trim().max(120)).max(2).default([]),
  narration: z.string().max(400).default(''),
  /** Why this shot earns its seconds, in one sentence. Read by a person, not parsed. */
  justification: z.string().max(200).default(''),
});
export type ProposedShot = z.infer<typeof ProposedShot>;

const ReplanOption = z.object({
  strategy: ReplanStrategy,
  reasoning: z.string().trim().min(1).max(600),
  shots: z.array(ProposedShot).min(1).max(6),
  /**
   * The Director's own judgement of the result against the beat it replaces.
   *
   * Asked for explicitly because the alternative is inferring it from cost,
   * and the cheapest option is not reliably the weakest one. An option marked
   * weaker is never chosen: the hierarchy is quality first, then cost.
   */
  quality: z.enum(['better', 'comparable', 'weaker']),
  /** True when a shot here needs material we do not already hold. */
  needsNewMaterial: z.boolean().default(false),
});
export type ReplanOption = z.infer<typeof ReplanOption>;

const ReplanResponse = z.object({
  /** Cheapest-first is not required; the orchestrator sorts. */
  options: z.array(ReplanOption).min(1).max(3),
  /** What the Director thinks is actually wrong, in one sentence. */
  diagnosis: z.string().trim().min(1).max(400),
});

/**
 * What kind of trouble this beat is in.
 *
 * `starved` is the case this machinery was built for: a beat holds more room
 * than its content can fill, so it sits on screen with nothing happening, and
 * the answer is more to say across more shots.
 *
 * `creative` is the opposite and arrives by the same door. The director
 * watched the cut and said it reads like a deck; the beat is already the
 * right length and its copy already fits. Told the problem is always
 * emptiness, a director dutifully writes more \u2014 and on a real run every
 * option it produced needed between 8.7 and 14.75 seconds for a beat holding
 * 7.01, was refused by the arithmetic, and the film was held with nothing
 * changed. The prompt was answering a question nobody had asked.
 */
export type BeatTrouble = 'starved' | 'creative';

function systemPrompt(trouble: BeatTrouble): string {
  const diagnosis =
    trouble === 'starved'
      ? `The problem is that a beat has been given more room than its content can hold, so it sits on screen with nothing happening. The wrong answer is to shorten it \u2014 that has already been tried and it takes the film under the runtime the customer approved. The right answer is the one a director gives in the room: there is not enough here, so split the idea, put something real in the middle of it, and move the payoff to the end.

So to fill a long beat with type you need MORE WORDS or MORE SHOTS, never longer shots. Roughly: every 2.6 words buys one second. Count them. A four-word line earns about two seconds; to fill eight seconds you need about twenty words across three or four shots.`
      : `The problem is NOT that this beat is empty. It is the right length, its copy already fits, and the arithmetic is fine. Somebody watched the finished cut and said it reads like a deck \u2014 legible, correct, and forgettable.

So do not add words to fill time. The time is already filled. The word counts below are a ceiling you must not exceed, not a target to reach; an option that needs more seconds than the beat has will be refused before anybody reads it, and refusing it changes nothing about the film.

Change what is on screen and how it moves, at the same length. A different visual mechanism. One real image instead of two labels. A turn the viewer does not see coming. Fewer words held with more confidence is almost always the stronger answer here, and it is available to you \u2014 the floor on copy is a floor for an empty beat, not for this one.`;

  return `You are the creative director of a film that has already been approved, and one beat of it is not working.

You are repairing this film, not making a different one. The customer approved a runtime, a format, a message, a narrative and a brand, and every one of those survives whatever you decide. Treat the rest of the film as finished work by a colleague you respect: you are changing one beat.

${diagnosis}

Your options must fill EXACTLY the seconds you are given. Not approximately.

Every shot you propose must be one that can actually be made:
- A shot with words on it needs enough time to read them: 0.45s to arrive, then one second per 2.6 words. Do not write a shot whose copy cannot be read in its duration.
- And it must not sit there afterwards. A still shot earns exactly the time its own words take to read \u2014 0.45s plus one second per 2.6 words \u2014 or 1.2s, whichever is more. NOT A FRAME LONGER. Past that the viewer has finished and is waiting.
- Two lines of on-screen copy is the maximum. One is usually stronger.
- A shot showing the product needs product material we already hold. If we do not hold it, do not propose it \u2014 say so in your reasoning and propose something we can make.
- Never invent a product interface, a metric, a customer name or a claim. If a figure is not in the material you were given, it does not exist.

Give two or three genuinely different options, and mark honestly whether each is better than, comparable to, or weaker than the beat it replaces. We will take the cheapest option that is not weaker. An option you mark "comparable" that is cheap will beat an option you mark "better" that is expensive only if the difference is small, so do not inflate.

${standardsBrief('direction')}

Return JSON only.`;
}

export type BeatReplanInput = {
  projectId: string;
  escalation: CreativeEscalation;
  storyboard: Storyboard;
  /** The beats being replaced, in order. */
  affected: Scene[];
  brand: BrandSystem;
  brief: ProjectBrief;
  concept: Concept;
  understanding: ProductUnderstanding | null;
  cut: FilmCut;
  /** Product material we actually hold, so the Director does not ask for what we cannot make. */
  availableAssetKinds: string[];
  /** The only kinds of shot this film can actually render. A closed list. */
  allowedVisualTypes: string[];
  /** What the loop has already tried and what happened. */
  history: string[];
  /** Why this director's own earlier attempt in this pass was refused. */
  refusals?: string[];
};

/**
 * How many words a beat of this length costs, in the director's own terms.
 *
 * A still shot earns `0.45 + words / 2.6` seconds of stillness and may run one
 * more arrival on top, so `n` shots covering `room` seconds need roughly
 * `2.6 * (room - 0.9n)` words between them. Stated as a target rather than as
 * a rule, because it is a floor the director should clear comfortably.
 */
export function wordBudgetLines(room: number, trouble: BeatTrouble = 'starved'): string[] {
  const forShots = (n: number) => Math.max(0, Math.ceil(2.6 * (room - 0.9 * n)));
  return [
    `Type earns time at about 2.6 words a second, and each shot costs about 0.9s of arrival.`,
    `So this beat holds roughly: ${forShots(2)} words across 2 shots, ` +
      `${forShots(3)} across 3, or ${forShots(4)} across 4.`,
    trouble === 'starved'
      ? `Count the words you write. Copy that is too thin for the room is the defect you are repairing.`
      : `Count the words you write and stay under those numbers. They are what the beat can hold, ` +
        `not what it needs: this beat is already full, and going over means the option is refused ` +
        `without anybody reading it.`,
  ];
}

export type BeatReplan = {
  options: ReplanOption[];
  diagnosis: string;
  usage: { costUsd: number; model: string };
};

export class BeatDirector {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async replan(input: BeatReplanInput, context: CallContext): Promise<BeatReplan> {
    const room = round3(input.affected.reduce((sum, scene) => sum + scene.duration, 0));
    /*
     * Which question this director is actually being asked.
     *
     * `direction` is a note from somebody who watched the cut, and it arrives
     * about a beat that is already the right length. Every other check here
     * is about a beat with time it cannot fill.
     */
    const trouble: BeatTrouble = input.escalation.check === 'direction' ? 'creative' : 'starved';
    const first = input.affected[0];
    const index = first ? input.storyboard.scenes.findIndex((scene) => scene.id === first.id) : -1;
    const before = index > 0 ? input.storyboard.scenes[index - 1] : null;
    const after =
      index >= 0 && index + input.affected.length < input.storyboard.scenes.length
        ? input.storyboard.scenes[index + input.affected.length]
        : null;

    const { value, usage } = await this.llm.completeJson(
      [
        { role: 'system', content: systemPrompt(trouble) },
        {
          role: 'user',
          content: [
            `# What is wrong`,
            input.escalation.diagnosis,
            `The film is contracted to run ${input.escalation.requiredSeconds.toFixed(2)}s.`,
            `The beat(s) below occupy ${room.toFixed(2)}s and can justify about ` +
              `${input.escalation.usableSeconds.toFixed(2)}s of it.`,
            ``,
            `# The room you must fill`,
            `EXACTLY ${room.toFixed(2)} seconds, across one to six shots.`,
            /*
             * The arithmetic, done for it.
             *
             * Told the rule in words, the director wrote copy carrying six
             * seconds of an eight-second beat, twice. Told the number of
             * words that beat costs, it has something it can count.
             */
            ...wordBudgetLines(room, trouble),
            ``,
            `# The beat(s) to replace`,
            ...input.affected.map((scene) => describeShot(scene)),
            ``,
            `# What comes immediately before and after`,
            before ? `Before: ${describeShot(before)}` : 'Before: this opens the film.',
            after ? `After: ${describeShot(after)}` : 'After: this closes the film.',
            ``,
            `# The whole film, for context`,
            ...input.storyboard.scenes.map(
              (scene, i) =>
                `${i + 1}. ${input.affected.some((a) => a.id === scene.id) ? '>> ' : '   '}` +
                describeShot(scene),
            ),
            ``,
            `# What was approved and does not change`,
            `Concept: "${input.concept.name}" — ${input.concept.keyIdea}`,
            `Hook: ${input.concept.hook}`,
            `Narrative: ${input.concept.narrativeStructure}`,
            `Emotional target: ${input.concept.targetEmotion}`,
            ...input.escalation.preservedConstraints.map((line) => `- ${line}`),
            ``,
            ...formatDirectionLines(input.brief.filmFormat),
            ...cutDirectionLines(input.cut),
            ``,
            `# Brand`,
            ...brandDirectionLines(input.brand),
            `Tone: ${input.brand.tone}`,
            ``,
            `# The product`,
            input.understanding
              ? `${input.understanding.name} — ${input.understanding.oneLiner}`
              : 'No product research on file: do not make claims about the product.',
            input.understanding
              ? `Proof we may use: ${
                  input.understanding.proofPoints.map((point) => point.text).join(' | ') ||
                  'none — do not imply metrics'
                }`
              : '',
            ``,
            `# What you may ask for`,
            /*
             * An allow-list, not a prohibition.
             *
             * The first version of this said "we hold no footage, do not
             * propose a shot that needs it" and the director proposed footage
             * anyway, twice out of three options. A closed list of what is
             * renderable cannot be misread the same way.
             */
            `visualType must be one of: ${input.allowedVisualTypes.join(', ')}.`,
            `Any other kind of shot cannot be made for this film and will be thrown away.`,
            input.availableAssetKinds.length > 0
              ? `Material on file: ${input.availableAssetKinds.join(', ')}.`
              : 'We hold no footage and no product capture. This beat is type, colour and motion.',
            ``,
            `# Already tried`,
            ...(input.history.length > 0 ? input.history.map((line) => `- ${line}`) : ['- nothing']),
            ...(input.refusals && input.refusals.length > 0
              ? [
                  ``,
                  `# Your previous proposals were refused`,
                  ...input.refusals.map((line) => `- ${line}`),
                  `Fix the specific problem named. Do not repeat the same shape.`,
                ]
              : []),
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { schema: ReplanResponse, schemaName: 'beat_replan', tier: 'balanced', repairAttempts: 1 },
      context,
    );

    return {
      options: value.options,
      diagnosis: value.diagnosis,
      usage: { costUsd: usage.costUsd, model: usage.model },
    };
  }
}

/**
 * The shortest and longest a shot may run, given what is on it.
 *
 * A shot with words needs time to read them, and must not sit there
 * afterwards: a still frame may hold for its reading time and a beat, which
 * is the defect this whole path exists to repair. A shot that plays is bound
 * only by the room available.
 */
export function shotBounds(
  shot: Pick<ProposedShot, 'duration' | 'onScreenText' | 'visualType'>,
  cut: 'feature' | 'short',
  room: number,
): { floor: number; ceiling: number } {
  const copy = shot.onScreenText.join(' ');
  const floor = Math.max(MIN_SHOT_SECONDS, readingSecondsFor(copy));
  if (!isStatic(shot.visualType)) return { floor, ceiling: room };
  /*
   * The checker's own ceiling, plus the time the type takes to arrive.
   *
   * `holdCeilingFor` bounds the FREEZE, and a freeze begins once the words
   * have finished animating on — so a shot may run that much longer than the
   * stillness it is allowed. Deriving it from the same function rather than
   * writing a second rule is what stops the two drifting: they already did
   * once, and every beat the director wrote passed planning and failed QA.
   */
  return { floor, ceiling: Math.max(floor, TEXT_ARRIVAL_SECONDS + holdCeilingFor(copy, cut)) };
}

/** A shot below this reads as a flash rather than a shot. */
const MIN_SHOT_SECONDS = 0.8;

/**
 * The director's shots, with the arithmetic made exact.
 *
 * The director authors and the deterministic layer guarantees. A proposal
 * eighty milliseconds over on one shot is a good idea with a slip in it, and
 * throwing the whole option away over that is how three sound proposals were
 * refused in a row — while a proposal whose shots genuinely cannot fill the
 * beat without holding is a different thing, and is refused.
 *
 * Every shot is first pulled inside its own bounds, then the remaining
 * difference is spread across the shots with room to take it. What comes back
 * fills the beat exactly, or a reason it cannot.
 */
export function normalizeOption(
  option: ReplanOption,
  room: number,
  options: { cut?: 'feature' | 'short' } = {},
): { durations: number[]; reason?: undefined } | { durations?: undefined; reason: string } {
  const cut = options.cut ?? 'feature';
  const bounds = option.shots.map((shot) => shotBounds(shot, cut, room));
  const floor = round3(bounds.reduce((sum, bound) => sum + bound.floor, 0));
  const roof = round3(bounds.reduce((sum, bound) => sum + bound.ceiling, 0));

  if (floor > room + 0.001) {
    return { reason: `these shots need ${floor.toFixed(2)}s and the beat has ${room.toFixed(2)}s` };
  }
  if (roof < room - 0.001) {
    return {
      reason:
        `these shots can carry ${roof.toFixed(2)}s of the ${room.toFixed(2)}s without holding still; ` +
        `the beat needs more to say, or another shot`,
    };
  }

  const durations = option.shots.map((shot, index) =>
    clamp(shot.duration, bounds[index]!.floor, bounds[index]!.ceiling),
  );

  // Spread what is left, up or down, across whatever still has room to move.
  for (let pass = 0; pass < 8; pass += 1) {
    const total = round3(durations.reduce((sum, value) => sum + value, 0));
    const drift = round3(room - total);
    if (Math.abs(drift) <= 0.001) break;
    const movable = durations
      .map((value, index) => ({
        index,
        headroom: drift > 0 ? bounds[index]!.ceiling - value : value - bounds[index]!.floor,
      }))
      .filter((entry) => entry.headroom > 0.001);
    if (movable.length === 0) break;
    const capacity = movable.reduce((sum, entry) => sum + entry.headroom, 0);
    const moving = Math.min(Math.abs(drift), capacity);
    for (const entry of movable) {
      const share = (entry.headroom / capacity) * moving * Math.sign(drift);
      durations[entry.index] = round3(durations[entry.index]! + share);
    }
  }

  const settled = round3(durations.reduce((sum, value) => sum + value, 0));
  if (Math.abs(settled - room) > 0.034) {
    return { reason: `the shots settle at ${settled.toFixed(2)}s rather than ${room.toFixed(2)}s` };
  }
  // Absorb the last frame of rounding into the longest shot, so the film is
  // exactly the length it was before rather than a frame off it.
  const longest = durations.reduce((best, value, index) => (value > durations[best]! ? index : best), 0);
  durations[longest] = round3(durations[longest]! + (room - settled));
  return { durations };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Why an option cannot be used at all, or nothing.
 *
 * Only the things the deterministic layer cannot fix: a director that marked
 * its own idea weaker, and a shot asking for material that does not exist.
 * The arithmetic is `normalizeOption`'s.
 */
export function rejectOption(
  option: ReplanOption,
  room: number,
  options: { hasFootage: boolean; cut?: 'feature' | 'short' } = { hasFootage: false },
): string | null {
  if (option.quality === 'weaker') return 'the director marked it weaker than what it replaces';
  for (const shot of option.shots) {
    if (!options.hasFootage && NEEDS_MATERIAL.has(shot.visualType)) {
      return `it asks for a ${shot.visualType} shot and we hold no material for one`;
    }
  }
  const normalized = normalizeOption(option, room, { ...(options.cut ? { cut: options.cut } : {}) });
  return normalized.reason ?? null;
}

/**
 * Shots that are type on a canvas: they arrive, settle and hold.
 *
 * One list, used twice — it is what a film with no material can ask for, and
 * it is what the held-frame ceiling binds. Two lists would drift, and the
 * direction they would drift in is a director proposing a static shot nothing
 * thinks to check.
 */
const STATIC_VISUAL_TYPES = [
  'kinetic_typography',
  'statistic',
  'quote',
  'logo_reveal',
  'transition',
] as const;

/** Visual types that cannot be drawn from type and the brand system alone. */
const NEEDS_MATERIAL: ReadonlySet<string> = new Set([
  'product_ui',
  'product_ui_3d',
  'screenshot_motion',
  'generated_broll',
  'real_media',
  'cinematic_3d',
]);

function isStatic(visualType: string): boolean {
  return (STATIC_VISUAL_TYPES as readonly string[]).includes(visualType);
}

/** The kinds of shot a film can render given what it has to work with. */
export function allowedVisualTypesFor(options: { hasFootage: boolean }): string[] {
  return options.hasFootage ? [...STATIC_VISUAL_TYPES, ...NEEDS_MATERIAL] : [...STATIC_VISUAL_TYPES];
}

/**
 * What an option would cost before anything is spent on it.
 *
 * Zero for anything made from type and material we already hold, which is most
 * of what a good replan proposes. A shot that needs new material is priced at
 * what that generation costs, so an option that regenerates is never chosen
 * over one that recomposes unless the Director says the recomposition is
 * weaker.
 */
export function estimateOptionCostUsd(option: ReplanOption, generatedShotUsd: number): number {
  const generating = option.shots.filter((shot) => NEEDS_MATERIAL.has(shot.visualType)).length;
  return round3(generating * generatedShotUsd);
}

function describeShot(scene: Scene): string {
  const copy = scene.onScreenText.length > 0 ? ` — text: "${scene.onScreenText.join(' / ')}"` : '';
  const vo = scene.narration ? ` — vo: "${scene.narration.slice(0, 90)}"` : '';
  return `[${scene.duration}s, ${scene.visualType}/${scene.motionRecipe.name}] ${scene.purpose}${copy}${vo}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
