import {
  newId,
  storyboardDuration,
  REAL_PRODUCT_VISUAL_TYPES,
  type QaFinding,
  type Storyboard,
} from '@act-one/core';
import type { LoudnessWindow } from './temporal.ts';
import type { MasterFacts } from './master-facts.ts';

/**
 * Watch it muted. Listen to it blind. Then both.
 *
 * Three viewings, because a film that only works with everything switched on
 * is usually a film where neither channel is doing its job and the two
 * together add up to one. The tests are ordinary practice in an edit suite and
 * they are ruthless:
 *
 *   MUTED — the picture alone. Everything a viewer learns here, they learn
 *   from what is on screen. If the film's argument lives entirely in the
 *   voice, the picture is decoration with a voiceover on it.
 *
 *   BLIND — the sound alone. If it is a music bed at one level for thirty
 *   seconds, the sound is not part of the film; it is playing near it.
 *
 *   BOTH — and the specific failure of the two together is that they compete:
 *   a line to read, a voice to follow and a dense interface to parse, all in
 *   the same two seconds, which is three attention targets and no film.
 *
 * Every number here is read out of the finished MP4 or out of material that
 * was actually produced. None of it is inferred from the storyboard's
 * intentions: a beat that was written with narration and came out silent must
 * fail the blind test, and a system that read the plan instead of the file
 * would give it full marks.
 */
export type SenseProblem =
  /** There is no audible content at all. */
  | 'silent'
  /** One level for the whole running time: a bed, not a mix. */
  | 'one_level_throughout'
  /** The sound does not acknowledge a single cut. */
  | 'sound_ignores_the_cut'
  /** Nothing is ever written on screen, so a muted viewer is told nothing. */
  | 'no_words_anywhere'
  /** The argument is in the voice and nowhere else. */
  | 'meaning_only_in_the_voice'
  /** One picture, held for the running time, whatever the shot list says. */
  | 'one_picture_held'
  /** The picture IS the words: a muted viewer is reading, not watching. */
  | 'words_are_the_picture'
  /** Reading, listening and looking, all at once. */
  | 'channels_compete';

export const SENSE_SAYS: Record<SenseProblem, string> = {
  silent: 'there is nothing audible in the master',
  one_level_throughout: 'the audio holds one level from beginning to end',
  sound_ignores_the_cut: 'no cut in the film is marked in the sound',
  no_words_anywhere: 'nothing is ever written on screen',
  meaning_only_in_the_voice: 'what the film is saying is only ever said out loud',
  one_picture_held: 'the film is one picture held for its running time',
  words_are_the_picture: 'the picture is mostly type, so watching it is reading it',
  channels_compete: 'a line to read, a voice to follow and an interface to parse, at the same time',
};

/**
 * A cut is "marked" when the sound changes within this window of it.
 *
 * A third of a second either side. Wider than that and any music with a pulse
 * scores a hit on every cut by coincidence, which would make the check
 * something the sound director passes by doing nothing.
 */
const MARK_WINDOW = 0.34;
/** Loudness change, in LU, that counts as the sound acknowledging something. */
const MARK_LU = 1.6;
/** Below this loudness range across the whole film, the mix has no dynamics. */
const FLAT_MIX_LU = 3;

export type BlindViewing = {
  audibleShare: number;
  hasNarration: boolean;
  loudnessRangeLu: number;
  /** Share of the film's cuts that the sound marks. */
  cutsMarked: number;
  problems: SenseProblem[];
};

export type MutedViewing = {
  flatShare: number;
  distinctShare: number;
  /** Seconds of the film with a word on screen. */
  wordsOnScreenSeconds: number;
  /** Seconds of the film showing the real product. */
  productSeconds: number;
  /** Sentences the film only ever says out loud. */
  spokenOnly: string[];
  problems: SenseProblem[];
};

/**
 * The film with the picture off.
 *
 * `hasNarration` is produced material, not intent — pass whether speech was
 * actually mixed into this master, never whether the storyboard asked for it.
 */
export function listenBlind(params: {
  facts: Pick<MasterFacts, 'audibleShare' | 'durationSeconds'>;
  windows: readonly LoudnessWindow[];
  cuts: readonly number[];
  hasNarration: boolean;
}): BlindViewing {
  const problems: SenseProblem[] = [];
  const real = params.windows.filter((window) => Number.isFinite(window.lufs) && window.lufs > -70);
  const levels = real.map((window) => window.lufs);
  const range = levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;

  /*
   * The cuts the sound acknowledges.
   *
   * Compared against the real loudness trace rather than against the cue
   * list, because a cue that was planned, placed and then lost in the mix is
   * indistinguishable, to a listener, from a cue nobody wrote.
   */
  let marked = 0;
  for (const cut of params.cuts) {
    const near = real.filter((window) => Math.abs(window.at - cut) <= MARK_WINDOW);
    if (near.length < 2) continue;
    const swing = Math.max(...near.map((w) => w.lufs)) - Math.min(...near.map((w) => w.lufs));
    if (swing >= MARK_LU) marked += 1;
  }
  const cutsMarked = params.cuts.length > 0 ? marked / params.cuts.length : 0;

  if (params.facts.audibleShare < 0.05) problems.push('silent');
  else {
    if (range < FLAT_MIX_LU) problems.push('one_level_throughout');
    if (params.cuts.length >= 3 && marked === 0) problems.push('sound_ignores_the_cut');
  }

  return {
    audibleShare: params.facts.audibleShare,
    hasNarration: params.hasNarration,
    loudnessRangeLu: Number(range.toFixed(2)),
    cutsMarked: Number(cutsMarked.toFixed(3)),
    problems,
  };
}

/**
 * The film with the sound off.
 *
 * The picture comes from the finished file; what the words say comes from the
 * cut, because the words are the cut. `spokenOnly` is the interesting number:
 * a sentence the film says out loud and never shows is a sentence a muted
 * viewer never receives, and most of the internet watches muted.
 */
export function watchMuted(params: {
  facts: Pick<MasterFacts, 'flatFrames' | 'distinctFrames' | 'sampled'>;
  storyboard: Storyboard;
}): MutedViewing {
  const { facts, storyboard } = params;
  const problems: SenseProblem[] = [];
  const flatShare = facts.sampled > 0 ? facts.flatFrames / facts.sampled : 0;
  const distinctShare = facts.sampled > 0 ? facts.distinctFrames / facts.sampled : 0;

  let wordsOnScreenSeconds = 0;
  let productSeconds = 0;
  const shown = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (scene.onScreenText.some((line) => line.trim().length > 0)) {
      wordsOnScreenSeconds += scene.duration;
      for (const word of meaningWords(scene.onScreenText.join(' '))) shown.add(word);
    }
    if (REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0) {
      productSeconds += scene.duration;
    }
  }

  /*
   * A spoken sentence counts as shown when most of what carries its meaning is
   * also on the screen somewhere. Not the same words in the same order — a
   * film that subtitles its own narration is a different failure — but the
   * nouns and verbs that make the sentence mean anything.
   */
  const spokenOnly: string[] = [];
  for (const scene of storyboard.scenes) {
    for (const sentence of sentences(scene.narration)) {
      const words = meaningWords(sentence);
      if (words.length < 2) continue;
      const covered = words.filter((word) => shown.has(word)).length / words.length;
      if (covered < 0.4) spokenOnly.push(sentence);
    }
  }

  const runtime = storyboardDuration(storyboard);
  const spoken = storyboard.scenes.reduce(
    (total, scene) => total + (scene.narration.trim() ? scene.duration : 0),
    0,
  );

  if (wordsOnScreenSeconds === 0 && spoken > 0) problems.push('no_words_anywhere');
  if (spoken > 0 && spokenOnly.length >= Math.max(2, sentenceCount(storyboard) * 0.6)) {
    problems.push('meaning_only_in_the_voice');
  }
  if (facts.sampled >= 4 && distinctShare <= 0.2) problems.push('one_picture_held');
  if (flatShare > 0.6 && runtime > 0 && productSeconds / runtime < 0.3) {
    problems.push('words_are_the_picture');
  }

  return {
    flatShare: Number(flatShare.toFixed(3)),
    distinctShare: Number(distinctShare.toFixed(3)),
    wordsOnScreenSeconds: Number(wordsOnScreenSeconds.toFixed(2)),
    productSeconds: Number(productSeconds.toFixed(2)),
    spokenOnly,
    problems,
  };
}

/**
 * Both at once, and the one thing that only shows up there.
 *
 * Each channel can be doing well on its own and the pair still fail, because
 * attention is not additive. A beat that puts a line on screen, a voice in the
 * ear and an unfamiliar interface in the frame has asked for three things in
 * the time a person can give one.
 */
export function watchBoth(
  storyboard: Storyboard,
  muted: MutedViewing,
  blind: BlindViewing,
): { problems: SenseProblem[]; competing: { sceneId: string; startTime: number }[] } {
  const competing: { sceneId: string; startTime: number }[] = [];
  for (const scene of storyboard.scenes) {
    const reads = scene.onScreenText.join(' ').trim().split(/\s+/).filter(Boolean).length >= 4;
    const hears = scene.narration.trim().length > 0;
    const parses =
      REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length > 0;
    if (reads && hears && parses) competing.push({ sceneId: scene.id, startTime: scene.startTime });
  }
  const problems = [...muted.problems, ...blind.problems];
  if (competing.length > 0) problems.push('channels_compete');
  return { problems: [...new Set(problems)], competing };
}

/**
 * The three viewings as findings, in the voice of somebody who did them.
 *
 * Soft fails throughout: none of these is a defect in the sense that a
 * clipped peak is a defect, and a film can knowingly be one of them. What
 * they must never be is invisible.
 */
export function senseIssues(params: {
  storyboard: Storyboard;
  muted: MutedViewing;
  blind: BlindViewing;
  both: ReturnType<typeof watchBoth>;
}): QaFinding[] {
  const findings: QaFinding[] = [];
  const first = params.storyboard.scenes[0];

  for (const problem of params.both.problems) {
    const where =
      problem === 'channels_compete' ? params.both.competing[0] : null;
    findings.push({
      id: newId('evt'),
      sceneId: where?.sceneId ?? null,
      timecodeStart: where?.startTime ?? first?.startTime ?? 0,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      check: 'direction',
      severity: 'soft_fail',
      layer: LAYER[problem],
      message: sentenceFor(problem, params),
      because: REPAIR[problem],
      confidence: 1,
      repair: REPAIR_ACTION[problem],
    });
  }
  return findings;
}

/** Which half of the film each viewing is about. `both` is the cross-modal one. */
const LAYER: Record<SenseProblem, 'visual' | 'audio' | 'cross_modal'> = {
  silent: 'audio',
  one_level_throughout: 'audio',
  sound_ignores_the_cut: 'cross_modal',
  no_words_anywhere: 'visual',
  meaning_only_in_the_voice: 'cross_modal',
  one_picture_held: 'visual',
  words_are_the_picture: 'visual',
  channels_compete: 'cross_modal',
};

/** The targeted repair for each, never "render it again and hope". */
const REPAIR_ACTION: Record<SenseProblem, 'remix_audio' | 'replan_scene' | 'rewrite_copy' | 'retime_scene'> = {
  silent: 'remix_audio',
  one_level_throughout: 'remix_audio',
  sound_ignores_the_cut: 'remix_audio',
  no_words_anywhere: 'rewrite_copy',
  meaning_only_in_the_voice: 'rewrite_copy',
  one_picture_held: 'replan_scene',
  words_are_the_picture: 'replan_scene',
  channels_compete: 'retime_scene',
};

const REPAIR: Record<SenseProblem, string> = {
  silent: 'Produce the mix. A master with no audible content is not finished.',
  one_level_throughout: 'Give the mix somewhere to go: an entrance, a drop, a moment with nothing under it.',
  sound_ignores_the_cut: 'Put the sound on the film rather than under it — mark the turns the picture makes.',
  no_words_anywhere: 'Write the one thing a muted viewer has to leave with, and put it on the screen.',
  meaning_only_in_the_voice: 'Show what is being said, or say less and show more. Most of the audience is muted.',
  one_picture_held: 'Change the visual idea. More cuts of the same picture is still one picture.',
  words_are_the_picture: 'Give the film something to look at. The answer is not a better-set card.',
  channels_compete: 'One attention target per beat: let the line land, then let the interface be looked at.',
};

function sentenceFor(problem: SenseProblem, params: { muted: MutedViewing; blind: BlindViewing; both: ReturnType<typeof watchBoth> }): string {
  switch (problem) {
    case 'silent':
      return `Listened to blind: ${SENSE_SAYS.silent} (${Math.round(params.blind.audibleShare * 100)}% audible).`;
    case 'one_level_throughout':
      return `Listened to blind: ${SENSE_SAYS.one_level_throughout} — ${params.blind.loudnessRangeLu} LU across the whole film.`;
    case 'sound_ignores_the_cut':
      return `Listened to blind: ${SENSE_SAYS.sound_ignores_the_cut}.`;
    case 'meaning_only_in_the_voice':
      return `Watched muted: ${SENSE_SAYS.meaning_only_in_the_voice} — ${params.muted.spokenOnly.length} sentences are spoken and never shown.`;
    case 'words_are_the_picture':
      return `Watched muted: ${SENSE_SAYS.words_are_the_picture} — ${Math.round(params.muted.flatShare * 100)}% of sampled frames are a field with marks on it.`;
    case 'one_picture_held':
      return `Watched muted: ${SENSE_SAYS.one_picture_held} — ${Math.round(params.muted.distinctShare * 100)}% of sampled frames are new.`;
    case 'channels_compete':
      return `Watched with sound: ${SENSE_SAYS.channels_compete}, at ${params.both.competing.map((beat) => `${beat.startTime.toFixed(1)}s`).join(', ')}.`;
    case 'no_words_anywhere':
      return `Watched muted: ${SENSE_SAYS.no_words_anywhere}.`;
  }
}

/** Words that carry meaning. Everything else is grammar and is not evidence of anything. */
const GRAMMAR = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our',
  'they', 'their', 'from', 'at', 'by', 'as', 'not', 'no', 'so', 'if', 'then', 'than', 'what',
  'when', 'how', 'all', 'every', 'each', 'more', 'most', 'can', 'will', 'just', 'one',
]);

function meaningWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !GRAMMAR.has(word));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function sentenceCount(storyboard: Storyboard): number {
  return storyboard.scenes.reduce((total, scene) => total + sentences(scene.narration).length, 0);
}
