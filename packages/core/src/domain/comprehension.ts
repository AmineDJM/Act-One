import { z } from 'zod';
import { REAL_PRODUCT_VISUAL_TYPES, type Scene, type Storyboard } from './storyboard.ts';

/**
 * Directing for someone who has never seen the product.
 *
 * Everything else in this system optimises the picture: how much of the
 * running time carries material, whether the interface moves, whether a shot
 * is composed. All of it can be excellent while the film fails at the only
 * job it has, which is that a person who has never heard of this company
 * watches for twenty-eight seconds and comes away knowing what it is.
 *
 * That person is not the person who made the film. They do not know the
 * product, they do not know the interface, they do not know where to look,
 * and they are reading a subtitle, parsing a screen and listening at the same
 * time. A product screenshot carries far more information than a
 * photograph — it is dozens of labels, each of which wants to be read — so
 * "show the product" and "communicate the product" are different
 * instructions, and only the first one is easy.
 *
 * What is in here is the arithmetic of that: how long the words on screen
 * take to read, how long a screen takes to take in, and where the film asks
 * for both at once. None of it decides anything creative. It measures what
 * the film demands of a viewer and says where the demand exceeds the time,
 * which is a fact about the cut rather than an opinion about it.
 */

/**
 * Words a minute, reading on-screen text while also watching a picture.
 *
 * Silent reading of prose runs about 240. A caption over moving footage is
 * not prose and the eye is not only on it; broadcast subtitling has used
 * around 160-180 for decades, and 160 is the right end of that for a viewer
 * who has never seen these words, this product or this interface before.
 */
const WORDS_PER_MINUTE = 160;
/** The eye has to arrive before it can read. One beat, per block of text. */
const FIXATION_SECONDS = 0.35;

export function readingSeconds(lines: readonly string[]): number {
  const words = lines.join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Number((FIXATION_SECONDS + (words / WORDS_PER_MINUTE) * 60).toFixed(3));
}

/**
 * How long a shot takes to take in, before anybody reads anything.
 *
 * An interface the viewer has never seen costs about a second just to work
 * out what kind of thing it is, and every place the shot then points at costs
 * again. A shot that points nowhere — the whole screen, held — costs MORE
 * than one that points somewhere, because the viewer has to search it
 * themselves and most of them will not bother. That is the inversion that
 * matters here: guiding attention buys time, it does not cost it.
 */
export function lookingSeconds(scene: Scene): number {
  const shows = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0;
  if (!shows) return 0.4;
  const framings = scene.uiSequence?.framings.length ?? 0;
  if (framings === 0) return 1.8;
  return Number((0.85 + 0.4 * Math.max(0, framings - 1)).toFixed(3));
}

/** What a shot is mainly asking the viewer to do with it. */
export const AttentionTarget = z.enum(['read', 'watch', 'both', 'rest']);
export type AttentionTarget = z.infer<typeof AttentionTarget>;

export type ShotDemand = {
  sceneId: string;
  index: number;
  startTime: number;
  duration: number;
  readingSeconds: number;
  lookingSeconds: number;
  /** What the shot asks for in total. Above its duration, something is missed. */
  demandSeconds: number;
  primary: AttentionTarget;
};

export function shotDemand(scene: Scene): ShotDemand {
  const reading = readingSeconds(scene.onScreenText);
  const looking = lookingSeconds(scene);
  const shows = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0;

  /*
   * Reading and looking are not additive in general — the eye moves between
   * them — but they are not free either. Seven tenths is the overlap a
   * subtitle and a picture can genuinely share; past that the viewer is doing
   * two jobs and doing both worse.
   */
  const demand = reading > 0 && shows ? reading + looking * 0.7 : Math.max(reading, looking);

  const primary: AttentionTarget =
    reading === 0 && !shows
      ? 'rest'
      : reading === 0
        ? 'watch'
        : !shows
          ? 'read'
          : reading > looking * 0.5
            ? 'both'
            : 'watch';

  return {
    sceneId: scene.id,
    index: scene.index,
    startTime: scene.startTime,
    duration: scene.duration,
    readingSeconds: reading,
    lookingSeconds: looking,
    demandSeconds: Number(demand.toFixed(3)),
    primary,
  };
}

export const ComprehensionProblem = z.enum([
  'no_hook',
  'late_orientation',
  'unreadable_text',
  'too_brief_for_ui',
  'competing_channels',
  'unguided_screen',
]);
export type ComprehensionProblem = z.infer<typeof ComprehensionProblem>;

export type ComprehensionNote = {
  problem: ComprehensionProblem;
  sceneId: string | null;
  timecodeStart: number;
  message: string;
};

/** Past this, an opening has stopped being intriguing and started being nothing. */
const HOOK_SECONDS = 2.5;
/** By here a first-time viewer should know roughly what they are looking at. */
const ORIENT_SECONDS = 8;

/**
 * Where the film asks more of a viewer than it gives them time for.
 *
 * Deliberately a small set, and every one of them is arithmetic rather than
 * taste: a line nobody can finish reading, a screen nobody can take in, two
 * channels competing, an opening with nothing in it, an orientation that
 * never arrives. A check that fired on style would be a check nobody could
 * act on.
 */
export function comprehension(storyboard: Storyboard): {
  demands: ShotDemand[];
  notes: ComprehensionNote[];
  /** When the film first says or shows what this is. Infinity when it never does. */
  orientedAtSeconds: number;
} {
  const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
  const demands = scenes.map(shotDemand);
  const notes: ComprehensionNote[] = [];

  /*
   * Orientation: the first moment the film either shows the product or makes
   * a claim long enough to be one. A single category word — "Scheduling" — is
   * a label, not an orientation; it tells somebody who already knows the
   * category which part of it this is, and tells everybody else nothing.
   */
  let oriented = Number.POSITIVE_INFINITY;
  for (const scene of scenes) {
    const shows = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0;
    const says = scene.onScreenText.join(' ').trim().split(/\s+/).filter(Boolean).length >= 4;
    if (shows || says) {
      oriented = scene.startTime + Math.min(scene.duration * 0.5, 1);
      break;
    }
  }

  const first = scenes[0];
  if (first) {
    const carriesPicture = first.assetRefs.length > 0;
    const carriesWords = first.onScreenText.some((line) => line.trim().length > 0);
    if (!carriesPicture && !carriesWords && first.duration > 0.8) {
      notes.push({
        problem: 'no_hook',
        sceneId: first.id,
        timecodeStart: 0,
        message:
          `The film opens on ${first.duration.toFixed(1)}s of brand texture with nothing in it — no product, ` +
          `no line. A viewer who has never heard of this company has been given no reason to keep watching.`,
      });
    }
  }
  if (oriented > ORIENT_SECONDS) {
    notes.push({
      problem: 'late_orientation',
      sceneId: null,
      timecodeStart: 0,
      message:
        oriented === Number.POSITIVE_INFINITY
          ? `The film never shows the product or states what it is in more than a label. A first-time viewer ` +
            `cannot work out what this company does from it.`
          : `A first-time viewer does not learn what this is until ${oriented.toFixed(1)}s. For an unknown ` +
            `company, ambiguity is expensive: the film has ${ORIENT_SECONDS}s to say what it is.`,
    });
  }

  for (const demand of demands) {
    const scene = scenes[demand.index];
    if (!scene) continue;

    if (demand.readingSeconds > 0 && demand.readingSeconds > demand.duration - 0.25) {
      notes.push({
        problem: 'unreadable_text',
        sceneId: scene.id,
        timecodeStart: scene.startTime,
        message:
          `"${scene.onScreenText.join(' / ')}" needs about ${demand.readingSeconds.toFixed(1)}s to read and is ` +
          `on screen for ${demand.duration.toFixed(1)}s. It will be gone before it has been finished.`,
      });
    }

    const shows = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0;
    if (shows && demand.duration < demand.lookingSeconds) {
      notes.push({
        problem: 'too_brief_for_ui',
        sceneId: scene.id,
        timecodeStart: scene.startTime,
        message:
          `An interface this viewer has never seen is on screen for ${demand.duration.toFixed(1)}s and needs ` +
          `about ${demand.lookingSeconds.toFixed(1)}s to be taken in. Nothing in it will be read.`,
      });
    }

    if (shows && (scene.uiSequence?.framings.length ?? 0) === 0 && demand.duration >= 1.5) {
      notes.push({
        problem: 'unguided_screen',
        sceneId: scene.id,
        timecodeStart: scene.startTime,
        message:
          `A whole application screen is held for ${demand.duration.toFixed(1)}s with nothing directing the eye. ` +
          `The viewer has to search it, and most will not.`,
      });
    }

    if (demand.primary === 'both' && demand.demandSeconds > demand.duration) {
      notes.push({
        problem: 'competing_channels',
        sceneId: scene.id,
        timecodeStart: scene.startTime,
        message:
          `This shot asks for ${demand.readingSeconds.toFixed(1)}s of reading and ` +
          `${demand.lookingSeconds.toFixed(1)}s of looking in ${demand.duration.toFixed(1)}s. The words and the ` +
          `interface are competing; one of them has to become secondary.`,
      });
    }
  }

  return { demands, notes, orientedAtSeconds: oriented };
}

/**
 * What a first-time viewer has been given, by the second.
 *
 * Written for the panel that judges the cut rather than for a check. A critic
 * reading "at 5.0s: four category labels, no product yet" is being asked the
 * right question; the same critic reading the storyboard's intentions is
 * being asked whether the plan was sensible, which it can always answer yes
 * to.
 */
export function viewerTimeline(storyboard: Storyboard, at: readonly number[] = [2, 5, 10, 15]): string[] {
  const scenes = [...storyboard.scenes].sort((a, b) => a.index - b.index);
  const runtime = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const marks = [...at.filter((mark) => mark < runtime), runtime];

  return marks.map((mark) => {
    const seen = scenes.filter((scene) => scene.startTime < mark);
    const product = seen.filter(
      (scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0,
    );
    const words = seen.flatMap((scene) => scene.onScreenText).filter((line) => line.trim().length > 0);
    const cards = seen.length - product.length;
    const parts = [
      `${seen.length} shot${seen.length === 1 ? '' : 's'}`,
      product.length > 0
        ? `${product.length} showing the product`
        : 'the product has not been shown',
      cards > 0 ? `${cards} typographic` : '',
      words.length > 0 ? `words so far: ${words.slice(-4).map((line) => `"${line}"`).join(', ')}` : 'no words yet',
    ].filter(Boolean);
    return `at ${mark.toFixed(1)}s — ${parts.join('; ')}`;
  });
}
