import { readFile } from 'node:fs/promises';
import {
  CAPTION_STANDARDS,
  captionFindings,
  captionsFrom,
  cite,
  indexStandards,
  newId,
  toWebVtt,
  type CaptionCue,
  type QaFinding,
} from '@act-one/core';
import type { StageContext } from '../context.ts';

/**
 * The caption track.
 *
 * Captions are the one part of a film that is read rather than watched, and
 * almost all of the craft is published: how long a line runs, how fast it may
 * go past, how long it holds, where it breaks. What is not published is where
 * each word actually fell, and that is the part that decides whether a caption
 * track reads as broadcast or as a transcript with timestamps guessed over it.
 *
 * So the timings come from the recording. An aligner is given the audio and
 * the script we already hold and says when each word was spoken; the words are
 * then grouped, held and broken by the rules. With no aligner configured the
 * timings are estimated from the passage instead, which is worse and is
 * honestly worse: the film still gets captions, and the report says they were
 * estimated.
 */

export type NarrationForCaptions = {
  path: string;
  /** Where this passage sits in the film. */
  atSeconds: number;
  durationSeconds: number;
  /** Dead air the engine left at the front, which no word occupies. */
  headSilenceSeconds: number;
  tailSilenceSeconds: number;
  /** What was read, as read. */
  text: string;
};

export type FilmCaptions = {
  cues: CaptionCue[];
  /** The sidecar, ready to store. Empty when there is nothing to caption. */
  vtt: string;
  issues: QaFinding[];
  /** How many passages were timed from the audio rather than estimated. */
  alignedPassages: number;
  passages: number;
};

export const NO_CAPTIONS: FilmCaptions = {
  cues: [],
  vtt: '',
  issues: [],
  alignedPassages: 0,
  passages: 0,
};

export async function captionFilm(
  context: StageContext,
  params: {
    tracks: readonly NarrationForCaptions[];
    language: string | null;
    filmSeconds: number;
    /** Scene starts. A caption never spans one. */
    boundaries: readonly number[];
  },
): Promise<FilmCaptions> {
  const spoken = params.tracks.filter((track) => track.text.trim().length > 0);
  if (spoken.length === 0) return NO_CAPTIONS;

  const aligner = context.registry.alignerOrNull();
  const call = {
    organizationId: context.organizationId,
    projectId: context.project.id,
    ...(context.signal ? { signal: context.signal } : {}),
  };

  const words: { word: string; start: number; end: number }[] = [];
  let alignedPassages = 0;

  for (const track of spoken) {
    let timed: { word: string; start: number; end: number }[] | null = null;
    if (aligner) {
      try {
        const audio = new Uint8Array(await readFile(track.path));
        const alignment = await aligner.align(audio, track.text, call);
        if (alignment.words.length > 0) {
          timed = alignment.words.map((word) => ({
            word: word.word,
            start: track.atSeconds + word.start,
            end: track.atSeconds + word.end,
          }));
          alignedPassages += 1;
        }
      } catch (error) {
        // A caption track is worth having estimated. Failing the render over
        // one that could not be aligned would trade the whole film for it.
        console.warn(`[captions] alignment failed, estimating: ${(error as Error).message.slice(0, 120)}`);
      }
    }
    words.push(...(timed ?? estimateWords(track)));
  }

  words.sort((left, right) => left.start - right.start);
  const cues = captionsFrom(words, {
    language: params.language,
    filmSeconds: params.filmSeconds,
    boundaries: params.boundaries,
  });

  return {
    cues,
    vtt: cues.length > 0 ? toWebVtt(cues) : '',
    issues: toIssues(cues, params.language),
    alignedPassages,
    passages: spoken.length,
  };
}

/**
 * Where the words probably fell.
 *
 * Time is shared out in proportion to how long each word takes to say, which
 * is closer to the truth than sharing it equally — "reconciliation" is not one
 * seventh of the line it sits in. Silence at either end is taken off first,
 * because nothing is spoken there.
 */
function estimateWords(track: NarrationForCaptions): { word: string; start: number; end: number }[] {
  const words = track.text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const head = track.atSeconds + Math.max(0, track.headSilenceSeconds);
  const span = Math.max(
    0.2,
    track.durationSeconds - Math.max(0, track.headSilenceSeconds) - Math.max(0, track.tailSilenceSeconds),
  );
  // A word's share of the line: its letters, plus a fixed cost for the gap
  // after it, so short words do not collapse to nothing.
  const weights = words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let at = head;
  return words.map((word, index) => {
    const share = (weights[index]! / total) * span;
    const entry = { word, start: at, end: at + share };
    at += share;
    return entry;
  });
}

const STANDARDS = indexStandards(CAPTION_STANDARDS);

/**
 * Findings, as the report states them.
 *
 * Every one of these is a minor: a caption a shade fast is not a reason to
 * withhold a finished film from the person who paid for it. They are also not
 * repaired automatically, because the only honest repair is upstream — a line
 * that cannot be read at the published rate has too many words in it, and
 * rewriting the copy to fix a caption is a decision the customer makes.
 */
function toIssues(cues: readonly CaptionCue[], language: string | null): QaFinding[] {
  return captionFindings(cues, { language }).map((finding) => {
    const standard = STANDARDS.get(finding.standardId);
    return {
      id: newId('evt'),
      check: 'caption_readability' as const,
      severity: 'warning' as const,
      sceneId: null,
      atSeconds: finding.atSeconds,
      message: standard ? `${finding.message} (${cite(standard)})` : finding.message,
      evidenceAssetId: null,
      confidence: 1,
      repair: null,
      detectedBy: 'audio' as const,
    };
  });
}
