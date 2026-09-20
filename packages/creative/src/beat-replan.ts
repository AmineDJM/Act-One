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
 * What kind of trouble this beat is in, and what that asks of a director.
 *
 * One prompt for every escalation was answering a question nobody had asked.
 * It opened "the problem is always the same shape: a beat has been given more
 * room than its content can hold" and told the director to write MORE WORDS
 * or MORE SHOTS \u2014 true for a starved beat, and the exact opposite of a note
 * saying the cut reads like a deck. Handed that note, the director dutifully
 * wrote more: every option it produced needed between 8.7 and 14.75 seconds
 * for a beat holding 7.01, all were refused by the arithmetic, and the film
 * was held with nothing changed.
 *
 * So the diagnosis is chosen from what the director who watched it named, and
 * each class gets the brief it actually needs.
 */
const TROUBLE_BRIEFS: Record<string, string> = {
  too_empty: `The problem is that this beat has been given more room than its content can hold, so it sits on screen with nothing happening. The wrong answer is to shorten it \u2014 that has already been tried and it takes the film under the runtime the customer approved. The right answer is the one a director gives in the room: there is not enough here, so split the idea, put something real in the middle of it, and move the payoff to the end.

To fill a long beat with type you need MORE WORDS or MORE SHOTS, never longer shots. Every 2.6 words buys about one second. Count them.`,

  too_dense: `The problem is that this beat asks more of the viewer than its seconds allow. Words go past before they can be read, or too much happens at once. Cut what is not load-bearing. One idea, said once, held long enough to land. Fewer words is the repair, not more.`,

  bad_visual_language: `The problem is NOT that this beat is empty. It is the right length, its copy already fits, and the arithmetic is fine. Somebody watched the finished cut and said it reads like a deck \u2014 legible, correct, and forgettable: a coloured field with white type on it, then another one.

Do not add words to fill time; the time is already filled, and an option needing more seconds than the beat has is refused before anybody reads it. The word counts below are a CEILING, not a target.

Change what is on screen. If we hold real product material, this beat should show the product doing something rather than a label describing it. If it must stay typographic, the type has to live in a composition rather than in the middle of a card. Fewer words held with more confidence is almost always the stronger answer here.`,

  too_static: `The problem is that nothing moves. The beat is the right length and says the right thing, and it sits there. Give it a reason to change across its own duration \u2014 something arriving, something resolving, something the viewer watches happen \u2014 rather than a held frame with a caption. Do not solve it by adding words.`,

  too_generic: `The problem is that this beat is true of this company and of forty others like it. Nothing in it could only be them. Reach for the specific: their own words, their own numbers, their own interface, the particular thing their product does that a competitor's does not. Same length, same message, no more words \u2014 a sharper one.`,

  polished_deck: `The problem is that the film is a presentation. Not a bad one — that is why it survived every other check. Isolated cards, held screenshots, the same composition every time, one feature after the next, and nothing actually happening in any of it.

Do not answer this with more words, another screenshot, or one more card. Those are the disease. The answer is a different visual idea for this beat: something occurring rather than something displayed. The product doing the thing instead of a picture of the thing. One image nobody else could use. A moment that leads into the next one instead of ending so the next can start.

If this beat genuinely cannot be anything other than a card, say so in your reasoning and name the beat that can.`,

  too_late_product: `The problem is that the product arrives too late to matter. This beat should be where it arrives. If we hold product material, use it here; if this beat cannot carry it, say so in your reasoning and propose what can. Do not answer this with a better label.`,

  insufficient_product: `The problem is that there is not enough of the customer's own product on screen. This beat is a candidate for carrying some. Use the material we hold rather than describing what it would show. Do not answer this with more copy.`,

  too_repetitive: `The problem is that this beat looks like the ones around it \u2014 same composition, same move, same shape. Break the pattern: a different kind of shot, a different framing, a different way in. Same length, same message.`,

  weak_hero: `The problem is that nothing in this film is worth remembering. This beat is the best candidate for the moment that is. Propose something a viewer would describe to somebody else afterwards \u2014 one image, one turn, one piece of proof \u2014 built from what this company actually is. Not spectacle for its own sake.`,

  bad_pacing: `The problem is the film's energy is flat. This beat needs to be where it changes: a held breath before something, or the acceleration after it. Use duration and density deliberately rather than evenly.`,

  weak_transition: `The problem is that this beat drops into the next one rather than turning into it. Find the relationship between them \u2014 cause and effect, question and answer, before and after \u2014 and let the shot end in a way that earns what follows.`,

  poor_composition: `The problem is the frame itself. What is on screen is correct and badly arranged. Rebuild the composition: where things sit, what dominates, what is allowed to be quiet. Same content, same length.`,
};

export type BeatTrouble = string;

/**
 * A class we have a brief for, or the one this machinery was built for.
 *
 * Normalised in one place so the brief and the word budget can never
 * disagree: an unknown class that got the "find more to say" brief alongside
 * a "stay under these numbers" budget would be the same contradiction this
 * whole change exists to remove, in miniature.
 */
function known(trouble: BeatTrouble): string {
  return trouble in TROUBLE_BRIEFS ? trouble : 'too_empty';
}

/** Whether this brief wants more copy or is explicitly capped. */
const ADDS_COPY = new Set(['too_empty']);

function systemPrompt(trouble: BeatTrouble): string {
  const diagnosis = TROUBLE_BRIEFS[known(trouble)]!;

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
export function wordBudgetLines(room: number, trouble: BeatTrouble = 'too_empty'): string[] {
  const forShots = (n: number) => Math.max(0, Math.ceil(2.6 * (room - 0.9 * n)));
  return [
    `Type earns time at about 2.6 words a second, and each shot costs about 0.9s of arrival.`,
    `So this beat holds roughly: ${forShots(2)} words across 2 shots, ` +
      `${forShots(3)} across 3, or ${forShots(4)} across 4.`,
    ADDS_COPY.has(known(trouble))
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
    /*
     * What the director who watched it named, or \u2014 for an escalation from the
     * deterministic layer, which has no opinion about taste \u2014 the empty beat
     * this machinery was built for.
     */
    const trouble: BeatTrouble = input.escalation.problems[0] ?? 'too_empty';
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
