import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import sharp from 'sharp';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { readContainer } from './container.ts';
import { measureFilm, type LoudnessWindow } from './temporal.ts';

/**
 * What the finished file actually is, read out of the finished file.
 *
 * Everything else that judges a film judges a description of it: the
 * storyboard says there are eleven shots, the manifest says nine of them have
 * material, the plan says the third one is a product capture. All of that can
 * be true of a file that plays as white text on a dark rectangle in silence,
 * which is what a customer received and what nothing in this system noticed,
 * because nothing had opened the file and looked.
 *
 * So these are measurements and not opinions. They come from the pixels and
 * the audio track of the master that is about to be delivered, they cost one
 * FFmpeg pass and a dozen small decodes, and they are the floor underneath
 * every model in the creative gate — a critic in a generous mood cannot talk
 * a silent title sequence into being a film.
 */
export type MasterFacts = {
  durationSeconds: number;
  width: number;
  height: number;
  /** There is an audio track in the container at all. */
  hasAudio: boolean;
  /**
   * The share of the running time with something audible in it.
   *
   * Measured rather than assumed: a track that exists and holds digital
   * silence for its whole length is the same experience as no track, and the
   * container cannot tell the two apart.
   */
  audibleShare: number;
  /** Frames sampled evenly across the film. */
  sampled: number;
  /**
   * Of those, how many are a flat field with marks on it.
   *
   * A typographic shot is a canvas and some type: nine tenths of the frame is
   * one colour. A capture, a photograph or footage is not — there is no
   * threshold at which a screenshot of a product reads as flat. This is the
   * single number that separates "a film" from "the words of a film".
   */
  flatFrames: number;
  /**
   * How many of the sampled frames look like anything the film has not
   * already shown. A cut where eleven shots produce two distinct images is
   * one image held for the running time, whatever the shot list says.
   */
  distinctFrames: number;
  /**
   * The short-term loudness trace, as measured.
   *
   * Already computed here — the silences above come from the same pass — and
   * previously thrown away, so anything that wanted to ask whether the sound
   * does anything had to scan the file a second time. It is the only honest
   * answer to "does the mix react to the cut", because a cue that was placed
   * and then buried is, to a listener, a cue nobody wrote.
   */
  loudness: LoudnessWindow[];
};

/**
 * Above this share in the four commonest colours, the frame is a field with
 * marks on it rather than a picture.
 *
 * Four rather than one because a canvas is rarely one value — it carries a
 * gradient, a grain, an antialiased edge — and all of that is still one
 * colour to whoever is watching. Four buckets at four bits a channel absorbs
 * that and nothing else: a screen capture spends its area on chrome, type,
 * surfaces and an accent, and a photograph spends it everywhere.
 */
const FLAT_AT = 0.92;
/** Frames whose 8×8 signatures differ by less than this are the same picture. */
const SAME_WITHIN = 10;

export async function readMasterFacts(
  masterPath: string,
  options: { signal?: AbortSignal; sample?: number; workDir?: string } = {},
): Promise<MasterFacts> {
  const container = await readContainer(masterPath);
  const duration = container.durationSeconds;
  const sample = Math.max(4, Math.min(options.sample ?? 12, 24));

  const owned = options.workDir ? null : await mkdtemp(path.join(tmpdir(), 'act-one-facts-'));
  const workDir = options.workDir ?? owned!;

  try {
    const measured = await measureFilm(masterPath, {
      ...(options.signal ? { signal: options.signal } : {}),
      workDir,
    });
    const silent = measured.silences.reduce(
      (total, gap) => total + Math.max(0, Math.min(gap.end, duration) - Math.max(0, gap.start)),
      0,
    );

    const signatures: Uint8Array[] = [];
    let flat = 0;
    let sampled = 0;
    for (let index = 0; index < sample; index += 1) {
      // Inside the film rather than on its edges: the first and last frames of
      // a film are a fade from and to the canvas by design, and counting them
      // as flat would call every well-made film a title card.
      const at = duration * ((index + 0.5) / sample);
      const framePath = path.join(workDir, `facts-${index}.jpg`);
      const extracted = await runFfmpeg(posterArgs(masterPath, at, framePath), {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: 60_000,
      });
      if (!extracted.ok) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(framePath);
      } catch {
        continue;
      }
      sampled += 1;
      if (await isFlat(bytes)) flat += 1;
      signatures.push(await signature(bytes));
    }

    return {
      durationSeconds: duration,
      width: container.video?.width ?? 0,
      height: container.video?.height ?? 0,
      hasAudio: container.audio !== null,
      audibleShare:
        container.audio === null || duration <= 0
          ? 0
          : Math.max(0, Math.min(1, 1 - silent / duration)),
      sampled,
      flatFrames: flat,
      distinctFrames: countDistinct(signatures),
      loudness: measured.windows,
    };
  } finally {
    if (owned) await rm(owned, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The share of the frame held by its four commonest colours, coarsely quantised. */
async function isFlat(frame: Buffer): Promise<boolean> {
  const { data, info } = await sharp(frame)
    .resize({ width: 160, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return false;
  const top = [...counts.values()].sort((left, right) => right - left).slice(0, 4);
  return top.reduce((sum, count) => sum + count, 0) / total >= FLAT_AT;
}

/** An 8×8 grey thumbnail: enough to tell two pictures apart, cheap enough to do twelve times. */
async function signature(frame: Buffer): Promise<Uint8Array> {
  const data = await sharp(frame).resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  return new Uint8Array(data);
}

function countDistinct(signatures: readonly Uint8Array[]): number {
  const kept: Uint8Array[] = [];
  for (const candidate of signatures) {
    if (!kept.some((seen) => meanDifference(seen, candidate) < SAME_WITHIN)) kept.push(candidate);
  }
  return kept.length;
}

function meanDifference(left: Uint8Array, right: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < left.length && i < right.length; i += 1) {
    total += Math.abs(left[i]! - right[i]!);
  }
  return total / Math.max(1, Math.min(left.length, right.length));
}

/**
 * What Act One must never hand over again.
 *
 * A corpus rather than a list of ifs, because these are not arbitrary
 * thresholds \u2014 each one is a film that was made, passed every check in this
 * system, and was opened by somebody who did not recognise what they had
 * bought. Written down with the name of the failure and the reason it is one,
 * so the set can be read by an operator, shown in the Director Lab, and added
 * to when a new way of disappointing somebody is discovered.
 *
 * Every entry is measured from the delivered file. None of them is a matter of
 * taste, and none of them asks a model, because a reviewer asked whether a
 * film is good will find something generous to say about almost anything.
 */
export type AntiPattern = {
  id: string;
  /** What this failure is called, in the words somebody would use to describe it. */
  title: string;
  /** Why it is a failure and not a style. */
  why: string;
  /** The sentence to say about this film, or null when the film is clear of it. */
  test: (facts: MasterFacts, options: { typographicByDesign?: boolean }) => string | null;
};

export const NEGATIVE_CORPUS: readonly AntiPattern[] = [
  {
    id: 'silent_master',
    title: 'A film nobody can hear',
    why:
      'Sound is half of a film. A master with no track, or a track holding silence, is the ' +
      'experience of a broken file rather than of a film that chose quiet.',
    test: (facts) => {
      if (!facts.hasAudio) return 'The master has no audio track at all: it plays in silence.';
      if (facts.audibleShare < MIN_AUDIBLE_SHARE) {
        return `The film is silent for ${Math.round((1 - facts.audibleShare) * 100)}% of its length.`;
      }
      return null;
    },
  },
  {
    id: 'type_on_a_field',
    title: 'The words of a film instead of the film',
    why:
      'A flat field with type on it for the whole running time is a title sequence. A film may ' +
      'be typographic on purpose \u2014 a pitch cut in type is a real form \u2014 but a product tour ' +
      'that never shows anything is the plan read aloud.',
    test: (facts, options) => {
      if (facts.sampled < 4 || options.typographicByDesign) return null;
      if (facts.flatFrames / facts.sampled < ALL_FLAT) return null;
      return (
        `Every frame sampled (${facts.flatFrames} of ${facts.sampled}) is a flat field with type on it. ` +
        'Nothing in this film is a picture.'
      );
    },
  },
  {
    id: 'the_film_holds_still',
    title: 'One image held for the running time',
    why:
      'A cut is what makes a film a film. Eleven shots that produce two images between them is ' +
      'one image with a title on it, whatever the shot list says \u2014 and this one is checked even ' +
      'where type was the chosen form, because the form lives on the cut.',
    test: (facts) => {
      if (facts.sampled < 6 || facts.distinctFrames > MIN_DISTINCT) return null;
      return (
        `${facts.sampled} moments across ${facts.durationSeconds.toFixed(0)}s produce ` +
        `${facts.distinctFrames} distinct image${facts.distinctFrames === 1 ? '' : 's'}: the film holds still.`
      );
    },
  },
];

/**
 * What the measurements alone are enough to refuse.
 *
 * Underneath the panel and the director, because none of the corpus above is
 * a matter of taste. Never `block`: every one of them is repairable by the
 * loop that follows, and a block is for something no amount of re-cutting
 * this material will fix.
 */
export function masterFloor(
  facts: MasterFacts,
  options: { typographicByDesign?: boolean } = {},
): { verdict: 'pass' | 'revise'; reasons: string[]; matched: string[] } {
  const reasons: string[] = [];
  const matched: string[] = [];
  for (const pattern of NEGATIVE_CORPUS) {
    const said = pattern.test(facts, options);
    if (said === null) continue;
    reasons.push(said);
    matched.push(pattern.id);
  }
  return { verdict: reasons.length > 0 ? 'revise' : 'pass', reasons, matched };
}

/** Below this, more than half the film plays in silence. */
const MIN_AUDIBLE_SHARE = 0.35;
/** At or above this share of flat frames, nothing in the film is a picture. */
const ALL_FLAT = 0.9;
/** Two images across a dozen sampled moments is one image with a title on it. */
const MIN_DISTINCT = 2;
