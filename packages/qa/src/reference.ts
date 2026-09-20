import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { readContainer } from './container.ts';
import { measureFilm } from './temporal.ts';

/**
 * What a film is made of, measured.
 *
 * Act One is shown reference films and told to reach their standard, and
 * "reach their standard" is not a thing a system can act on. This turns a
 * reference into numbers: how long it runs, how often it cuts, how much of
 * the frame is a flat field, how many distinct worlds it lives in, how much
 * moves between one moment and the next, and what its sound does.
 *
 * What it extracts are PRINCIPLES. It does not keep frames, compositions,
 * copy or any other part of somebody else's creative work — it keeps the
 * shape of the thing, which is what taste is made of and what can legitimately
 * be learned from.
 *
 * The first four references measured with it said something no amount of
 * looking had: one of them runs seventy-one seconds without a single hard
 * cut. Every Act One film to date has been a sequence of cuts between shots,
 * which is the technical definition of the thing the work is trying to stop
 * being.
 */
export type FilmPrinciples = {
  durationSeconds: number;
  /** Hard cuts plus one. A film that never cuts is one shot. */
  shots: number;
  cutsPerMinute: number;
  meanShotSeconds: number;
  shortestShotSeconds: number;
  longestShotSeconds: number;
  /**
   * How much the shot lengths vary, as a share of the mean.
   *
   * Near zero is a film cut on a metronome, which has no rhythm however fast
   * it goes. Editorial rhythm is some shots at 0.7s and some at 5s, and this
   * is the one number that can tell those apart from the outside.
   */
  shotLengthSpread: number;
  /** Share of sampled frames that are a flat field with marks on it. */
  flatShare: number;
  /** Share of sampled frames that show something the film has not already shown. */
  distinctShare: number;
  /**
   * How many distinct background worlds the film lives in.
   *
   * One is a film with a coherent atmosphere. Two or three is chapters, which
   * is what a premium film does when it changes register. Ten is a slide deck
   * with different backgrounds.
   */
  fields: number;
  /**
   * How much of the picture changes from one sampled moment to the next.
   *
   * Not the same as cutting: a film that transforms continuously scores high
   * here and low on cuts, which is exactly the combination being aimed at.
   */
  motionDensity: number;
  /** Loudness range across the film, in LU. A flat number is a bed. */
  loudnessRangeLu: number;
  audibleShare: number;
};

/** Frames sampled for the picture measurements. More than the master facts: rhythm needs resolution. */
const SAMPLES = 32;
/** Scene-change score above which ffmpeg calls it a cut. */
const CUT_AT = 0.25;
/** Above this share in the four commonest colours, the frame is a field with marks on it. */
const FLAT_AT = 0.92;
/** Frames whose 8×8 signatures differ by less than this are the same picture. */
const SAME_WITHIN = 10;
/** Background fields closer than this in RGB are the same world. */
const SAME_FIELD = 38;

export async function analyseFilm(
  filmPath: string,
  options: { signal?: AbortSignal; workDir?: string } = {},
): Promise<FilmPrinciples> {
  const container = await readContainer(filmPath);
  const duration = container.durationSeconds;
  const owned = options.workDir ? null : await mkdtemp(path.join(tmpdir(), 'act-one-ref-'));
  const workDir = options.workDir ?? owned!;
  const signal = options.signal ? { signal: options.signal } : {};

  try {
    const cuts = await cutTimes(filmPath, signal);
    const lengths = shotLengths(cuts, duration);
    const mean = lengths.reduce((total, length) => total + length, 0) / Math.max(1, lengths.length);
    const spread =
      lengths.length > 1 && mean > 0
        ? Math.sqrt(lengths.reduce((total, l) => total + (l - mean) ** 2, 0) / lengths.length) / mean
        : 0;

    const signatures: Uint8Array[] = [];
    const backgrounds: { r: number; g: number; b: number }[] = [];
    let flat = 0;
    let sampled = 0;
    let motion = 0;
    let previous: Uint8Array | null = null;

    for (let index = 0; index < SAMPLES; index += 1) {
      const at = duration * ((index + 0.5) / SAMPLES);
      const framePath = path.join(workDir, `ref-${index}.jpg`);
      const extracted = await runFfmpeg(posterArgs(filmPath, at, framePath), {
        ...signal,
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
      const { isFlat, background } = await fieldOf(bytes);
      if (isFlat) flat += 1;
      backgrounds.push(background);
      const sig = await signature(bytes);
      if (previous) motion += distance(previous, sig) / 64;
      previous = sig;
      signatures.push(sig);
    }

    let loudnessRangeLu = 0;
    let audibleShare = 0;
    try {
      const measured = await measureFilm(filmPath, { ...signal, workDir });
      const levels = measured.windows.map((w) => w.lufs).filter((l) => Number.isFinite(l) && l > -70);
      loudnessRangeLu = levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;
      const silent = measured.silences.reduce(
        (total, gap) => total + Math.max(0, Math.min(gap.end, duration) - Math.max(0, gap.start)),
        0,
      );
      audibleShare =
        container.audio === null || duration <= 0 ? 0 : Math.max(0, Math.min(1, 1 - silent / duration));
    } catch {
      // A film we cannot listen to still tells us about its picture.
    }

    return {
      durationSeconds: Number(duration.toFixed(2)),
      shots: lengths.length,
      cutsPerMinute: Number((duration > 0 ? (cuts.length / duration) * 60 : 0).toFixed(2)),
      meanShotSeconds: Number(mean.toFixed(2)),
      shortestShotSeconds: Number(Math.min(...lengths).toFixed(2)),
      longestShotSeconds: Number(Math.max(...lengths).toFixed(2)),
      shotLengthSpread: Number(spread.toFixed(3)),
      flatShare: Number((sampled > 0 ? flat / sampled : 0).toFixed(3)),
      distinctShare: Number((sampled > 0 ? countDistinct(signatures) / sampled : 0).toFixed(3)),
      fields: countFields(backgrounds),
      motionDensity: Number((signatures.length > 1 ? motion / (signatures.length - 1) : 0).toFixed(3)),
      loudnessRangeLu: Number(loudnessRangeLu.toFixed(2)),
      audibleShare: Number(audibleShare.toFixed(3)),
    };
  } finally {
    if (owned) await rm(owned, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Where the picture changes completely.
 *
 * ffmpeg's own scene score, which is a histogram difference: a cut scores near
 * one, a dissolve scores low and a continuous transformation scores near zero
 * — which is the distinction this whole measurement exists to make.
 */
async function cutTimes(filmPath: string, signal: { signal?: AbortSignal }): Promise<number[]> {
  const run = await runFfmpeg(
    ['-nostdin', '-i', filmPath, '-vf', `select='gt(scene,${CUT_AT})',showinfo`, '-f', 'null', '-'],
    { ...signal, timeoutMs: 180_000 },
  );
  const times: number[] = [];
  for (const line of run.stderr.split('\n')) {
    const match = /pts_time:([0-9.]+)/.exec(line);
    if (match) times.push(Number(match[1]));
  }
  return times.sort((a, b) => a - b);
}

function shotLengths(cuts: readonly number[], duration: number): number[] {
  const bounds = [0, ...cuts.filter((at) => at > 0.05 && at < duration - 0.05), duration];
  const lengths: number[] = [];
  for (let i = 1; i < bounds.length; i += 1) lengths.push(bounds[i]! - bounds[i - 1]!);
  return lengths.length > 0 ? lengths : [duration];
}

/**
 * Whether the frame is a field with marks on it, and what colour that field is.
 *
 * Four buckets at four bits a channel, because a canvas is rarely one value —
 * it carries a gradient, a grain, an antialiased edge — and all of that is
 * still one colour to whoever is watching.
 */
async function fieldOf(bytes: Buffer): Promise<{ isFlat: boolean; background: { r: number; g: number; b: number } }> {
  const { data, info } = await sharp(bytes)
    .resize(64, 64, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n += 1;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    counts.set(key, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  const top = ranked.slice(0, 4).reduce((total, entry) => total + entry.n, 0);
  const first = ranked[0] ?? { n: 1, r: 0, g: 0, b: 0 };
  return {
    isFlat: top / pixels >= FLAT_AT,
    background: {
      r: Math.round(first.r / first.n),
      g: Math.round(first.g / first.n),
      b: Math.round(first.b / first.n),
    },
  };
}

/** How many distinct worlds the backgrounds fall into. */
function countFields(backgrounds: readonly { r: number; g: number; b: number }[]): number {
  const worlds: { r: number; g: number; b: number }[] = [];
  for (const background of backgrounds) {
    const near = worlds.some(
      (world) =>
        Math.hypot(world.r - background.r, world.g - background.g, world.b - background.b) < SAME_FIELD,
    );
    if (!near) worlds.push(background);
  }
  return worlds.length;
}

async function signature(bytes: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(bytes)
    .resize(8, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

function distance(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i]! - b[i]!) / 255;
  return total;
}

function countDistinct(signatures: readonly Uint8Array[]): number {
  const kept: Uint8Array[] = [];
  for (const sig of signatures) {
    const seen = kept.some((other) => meanAbs(sig, other) < SAME_WITHIN);
    if (!seen) kept.push(sig);
  }
  return kept.length;
}

function meanAbs(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i]! - b[i]!);
  return total / a.length;
}

/**
 * Where a film sits against the principles taken from the references.
 *
 * Deliberately one-sided: it reports where OUR film is outside the range the
 * references occupy, and says nothing where it is inside. A reference range is
 * not a target to hit — a film that cuts as often as the fastest reference is
 * not thereby good — but a film outside every reference on a structural
 * measure is a film making a choice nobody took deliberately.
 */
export function againstReferences(
  ours: FilmPrinciples,
  references: readonly FilmPrinciples[],
): string[] {
  if (references.length === 0) return [];
  const notes: string[] = [];
  const range = <K extends keyof FilmPrinciples>(key: K): [number, number] => {
    const values = references.map((reference) => reference[key] as number);
    return [Math.min(...values), Math.max(...values)];
  };

  const [minRun, maxRun] = range('durationSeconds');
  if (ours.durationSeconds < minRun) {
    notes.push(
      `This film runs ${ours.durationSeconds.toFixed(0)}s. The references run ${minRun.toFixed(0)}–${maxRun.toFixed(0)}s. ` +
        `A viewer who has never heard of this company is being given less than half the time the references give theirs.`,
    );
  }

  const [, maxCuts] = range('cutsPerMinute');
  if (ours.cutsPerMinute > maxCuts * 1.25) {
    notes.push(
      `This film cuts ${ours.cutsPerMinute.toFixed(0)} times a minute; the busiest reference cuts ${maxCuts.toFixed(0)}. ` +
        `Cutting is not the same as movement, and a cut is what a film does when it has nothing to transform.`,
    );
  }

  const [minMotion] = range('motionDensity');
  if (ours.motionDensity < minMotion) {
    notes.push(
      `Between one moment and the next, less of this picture changes than in any reference ` +
        `(${ours.motionDensity.toFixed(2)} against ${minMotion.toFixed(2)}). The film is holding still between cuts.`,
    );
  }

  const [, maxFlat] = range('flatShare');
  if (ours.flatShare > Math.max(maxFlat, 0.2) * 1.2) {
    notes.push(
      `${Math.round(ours.flatShare * 100)}% of sampled frames are a flat field with marks on them, against at most ` +
        `${Math.round(maxFlat * 100)}% in the references. That is the measurable signature of a deck.`,
    );
  }

  const [, maxFields] = range('fields');
  if (ours.fields > maxFields + 1) {
    notes.push(
      `The film lives in ${ours.fields} distinct background worlds; no reference uses more than ${maxFields}. ` +
        `One film has one visual world, or a small number of deliberate chapters.`,
    );
  }

  const [minSpread] = range('shotLengthSpread');
  if (ours.shotLengthSpread < minSpread * 0.7) {
    notes.push(
      `The shots are all nearly the same length (spread ${ours.shotLengthSpread.toFixed(2)} against ` +
        `${minSpread.toFixed(2)}). Editorial rhythm is some shots at under a second and some held for five.`,
    );
  }

  const [minRange] = range('loudnessRangeLu');
  if (ours.loudnessRangeLu < minRange * 0.7) {
    notes.push(
      `The mix moves over ${ours.loudnessRangeLu.toFixed(1)} LU; the quietest-moving reference moves ` +
        `${minRange.toFixed(1)} LU. A soundtrack with no dynamics is a bed.`,
    );
  }

  return notes;
}
