import { z } from 'zod';
import {
  AUDIO_STANDARDS,
  FilmScore,
  MOVEMENT_MIN_SECONDS,
  MOVEMENTS_MAX,
  fitScore,
  standardsBrief,
  movementBoundaries,
  scenesInMovement,
  storyboardDuration,
  type BrandSystem,
  type CreativeSystemId,
  type EffectBrief,
  type ProductUnderstanding,
  type Scene,
  type SoundCue,
  type Storyboard,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { getSystem } from './systems/index.ts';

/**
 * The composer.
 *
 * Music chosen from a library is the same music whatever happens on screen:
 * it arrives at its own climax, fades where it always fades, and the cut has
 * to survive it. A score written for one film changes where the film changes,
 * and that is most of the distance between a video with music on it and a
 * film.
 *
 * This agent is briefed the way a composer would be: what the film argues,
 * where it turns, what the brand sounds like, and the two constraints that
 * are not negotiable — the voice has to stay intelligible, and the mix has to
 * meet a measured loudness target rather than a remembered one.
 *
 * It writes direction and style, never a mix. Levels, ducking and the true
 * peak are the mix engineer's, and they are measured rather than asked for.
 */
const SYSTEM_PROMPT = [
  'You are a composer for launch films: fifteen to ninety seconds, made to be watched once,',
  'on a laptop, with the sound on. You have scored hundreds of them.',
  '',
  'What you know that an amateur does not:',
  '',
  '- A short film has one idea, developed. Six musical ideas in twenty seconds is a mess,',
  '  and a track that never changes is wallpaper. Two or three movements is usually right.',
  '- Music enters where the film earns it. Opening on a full arrangement wastes the only',
  '  moment the viewer was going to give you for free.',
  '- Under a voice, the arrangement thins out rather than turning down. A bed that is merely',
  `  quieter still fights the words; ${AUDIO_STANDARDS.dialogueLead.rule.toLowerCase()}`,
  '  and the way to get there is to leave the register the voice occupies empty.',
  '- The last two seconds decide what the film felt like. A resolution that lands on the mark',
  '  reads as intentional; a fade-out reads as a file ending.',
  '- Loudness is measured, not judged. The mix will be normalised to a standard target',
  `  (${AUDIO_STANDARDS.webTarget.rule}, ${AUDIO_STANDARDS.truePeak.rule}), so do not ask for`,
  '  anything that only works when it is loud: it will be turned down and left limp.',
  '',
  'Each movement says how closely it follows the one before it. The opening is always high —',
  'a score that argues with itself in its first three seconds sounds like two tracks. A movement',
  'that continues an idea is high; one that answers it is medium; one that breaks with it, because',
  'the film breaks with itself there, is low. A film whose every movement is high has one idea',
  'stretched over it, which is a bed, not a score.',
  '',
  'Style words are instructions to a music engine that reads English. Name instruments,',
  'tempo, register and texture. Never name an artist, a band, a film score or a track —',
  'a style copied from something is a legal problem and an unoriginal film.',
  '',
  'Write nothing that could be sung. This is instrumental.',
  '',
  standardsBrief('sound'),
].join('\n');

const Draft = z.object({
  movements: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        direction: z.string().min(20).max(600),
        seconds: z.number().min(MOVEMENT_MIN_SECONDS).max(120),
        styles: z.array(z.string().min(2).max(60)).min(1).max(12),
        avoid: z.array(z.string().min(2).max(60)).max(12),
        adherence: z.enum(['low', 'medium', 'high']),
      }),
    )
    .min(1)
    .max(6),
});

export type ScoreInput = {
  storyboard: Storyboard;
  brand: Pick<BrandSystem, 'tone' | 'motionStyle' | 'visualStyle'> | null;
  understanding: Pick<ProductUnderstanding, 'name' | 'oneLiner' | 'category' | 'tone'> | null;
  /** The creative system's id, for its own sound behaviour. */
  creativeSystem: CreativeSystemId;
  hasVoiceOver: boolean;
  /** Where it will be watched: decides how much dynamic range survives. */
  channel?: 'web' | 'social' | 'broadcast';
};

/**
 * Writes the score for a film.
 *
 * The turns come from the storyboard rather than from the model: where the
 * picture changes is a fact, and asking a model to guess it from a list of
 * scenes is how a score ends up half a second out. The model decides what
 * each movement is and what it sounds like.
 */
export async function writeScore(llm: LlmProvider, input: ScoreInput, call: CallContext): Promise<FilmScore> {
  const total = storyboardDuration(input.storyboard);
  const system = getSystem(input.creativeSystem);
  const boundaries = movementBoundaries(input.storyboard, total < 25 ? 3 : 5);

  const turns = boundaries.map((start, index) => {
    const end = boundaries[index + 1] ?? total;
    const scenes = scenesInMovement(input.storyboard, start, end);
    return {
      start,
      seconds: Math.round((end - start) * 100) / 100,
      what: scenes.map(describeScene).join(' Then: '),
      speaks: scenes.some((scene) => scene.narration.trim().length > 0),
    };
  });

  const { value } = await llm.completeJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `# The film`,
          `${Math.round(total)} seconds, ${input.storyboard.scenes.length} scenes.`,
          input.understanding ? `Product: ${input.understanding.name} — ${input.understanding.oneLiner}` : '',
          input.understanding ? `Category: ${input.understanding.category}. Their own tone: ${input.understanding.tone}` : '',
          input.brand ? `Brand: ${input.brand.tone}. Motion: ${input.brand.motionStyle}.` : '',
          '',
          `# The creative system: ${system.name}`,
          system.essence,
          `Sound behaviour: ${system.sound.musicCharacter}`,
          `The film ${system.sound.openOnMusic ? 'opens on music' : 'opens quiet and lets the music arrive'}.`,
          `It ${system.sound.endWithSting ? 'ends on a sting' : 'does not end on a sting'}.`,
          system.prohibitions.length > 0 ? `This system refuses: ${system.prohibitions.join('; ')}` : '',
          '',
          `# The turns, which are fixed`,
          `Write one movement per turn, in this order, at these lengths.`,
          ...turns.map(
            (turn, index) =>
              `${index + 1}. from ${turn.start.toFixed(1)}s, ${turn.seconds.toFixed(1)}s long${turn.speaks ? ', voice over it' : ', no voice'}: ${turn.what}`,
          ),
          '',
          input.hasVoiceOver
            ? 'There is narration over most of this film. Leave the middle register open.'
            : 'There is no narration. The music carries the film alone and may occupy the whole register.',
          '',
          `Answer with one movement per turn, each at the length given.`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    { schema: Draft, schemaName: 'film_score', tier: 'deep' },
    call,
  );

  const score = FilmScore.parse({
    movements: value.movements.slice(0, MOVEMENTS_MAX).map((movement) => ({
      ...movement,
      styles: movement.styles.filter((style) => !NAMED.test(style)),
      avoid: movement.avoid.filter((style) => !NAMED.test(style)),
    })),
    instrumental: true,
    // Same film, same score: a re-render should not surprise somebody who
    // approved the first one.
    seed: seedFrom(input.storyboard.id),
  });

  return fitScore(score, total);
}

/** A style that names somebody else's work is a legal problem and a lazy film. */
const NAMED = /\b(hans zimmer|john williams|daft punk|inception|interstellar|blade runner|stranger things|in the style of)\b/i;

function describeScene(scene: Scene): string {
  const bits = [
    scene.visualType.replace(/_/g, ' '),
    scene.onScreenText.length > 0 ? `text on screen` : '',
    scene.narration.trim() ? 'narrated' : '',
  ].filter(Boolean);
  return `${scene.purpose || bits.join(', ')}`.slice(0, 160);
}

/** Deterministic from the storyboard, so the same film scores the same way. */
function seedFrom(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  return hash;
}

// ---------------------------------------------------------------------------
// Sound design
// ---------------------------------------------------------------------------

const EFFECTS_PROMPT = [
  'You are a sound designer for launch films. You build sounds; you do not search for them.',
  '',
  'What you know:',
  '',
  '- A sound is the sound of a specific thing happening, not a category. "A short dry wooden',
  '  knock with almost no tail, close-miked" is a sound; "impact" is a folder.',
  '- An impact placed on a cut reads as late, because its attack has already begun by the time',
  '  the picture changes. So the sound needs a defined attack you can place against.',
  '- Interface sounds are sparse and small. One click sells the interaction; four makes it a',
  '  tutorial. They belong close and dry, with no reverb tail to muddy the voice.',
  '- A texture under a scene has to loop without a seam, and has to sit below the voice.',
  '- No music inside an effect, no melody, no speech, no recognisable branding.',
  '',
  'Every sound carries an influence between 0 and 1, which decides how literally the engine',
  'follows your words. A sound whose job is to be exactly one thing — an impact, a click, a',
  'switch — wants 0.7 or above, and comes back tighter for it. A sound whose job is to be a',
  'place — room tone, a texture under a scene, weather — wants 0.3 or below, because a literal',
  'reading of a texture comes back thin and looped. Vary it: identical influence on every cue',
  'means nobody chose.',
].join('\n');

const EffectDraft = z.object({
  effects: z.array(
    z.object({
      cueId: z.string(),
      brief: z.string().min(10).max(400),
      seconds: z.number().min(0.5).max(22),
      influence: z.number().min(0).max(1),
      loop: z.boolean(),
    }),
  ),
});

export type CueToDesign = { id: string; type: SoundCue['type']; atSeconds: number; intensity: number; sceneIntent: string };

/**
 * Writes one brief per cue the film asks for.
 *
 * The cues themselves are the sound director's, decided from the edit; this
 * says what each one actually is, in the words a sound engine reads.
 */
export async function writeEffects(
  llm: LlmProvider,
  input: { cues: CueToDesign[]; creativeSystem: CreativeSystemId; brandTone: string | null },
  call: CallContext,
): Promise<EffectBrief[]> {
  if (input.cues.length === 0) return [];
  const system = getSystem(input.creativeSystem);

  const { value } = await llm.completeJson(
    [
      { role: 'system', content: EFFECTS_PROMPT },
      {
        role: 'user',
        content: [
          `# The film's sound`,
          `Creative system: ${system.name}. ${system.sound.musicCharacter}`,
          `Interface sound density: ${system.sound.uiSoundDensity}.`,
          input.brandTone ? `Brand tone: ${input.brandTone}` : '',
          '',
          `# The cues`,
          ...input.cues.map(
            (cue) =>
              `- ${cue.id}: a ${cue.type.replace(/_/g, ' ')} at ${cue.atSeconds.toFixed(2)}s, intensity ${cue.intensity.toFixed(2)}, over: ${cue.sceneIntent.slice(0, 120)}`,
          ),
          '',
          'One brief per cue, same ids. Keep each under twenty-two seconds, and loop only a texture.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    { schema: EffectDraft, schemaName: 'sound_effects', tier: 'fast' },
    call,
  );

  const asked = new Set(input.cues.map((cue) => cue.id));
  return value.effects
    .filter((effect) => asked.has(effect.cueId))
    .map((effect) => ({
      cueId: effect.cueId,
      brief: effect.brief,
      seconds: effect.seconds,
      influence: effect.influence,
      loop: effect.loop,
    }));
}
