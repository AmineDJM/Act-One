import type { Scene, VoiceDensity } from '@act-one/core';
import { narrationSeconds } from './timing.ts';

/**
 * Where the voice is, and where it is missing.
 *
 * A narrated film whose voice stops for eight seconds in the middle reads as
 * broken, not as a pause: the viewer was being spoken to and then was not.
 * The director decides how much of the film the voice carries; this holds a
 * storyboard to that decision before anything is paid for, from the lines as
 * written and the beats as timed.
 *
 * The close is not counted: the film ends on its mark and its sting, which is
 * the one stretch every launch film leaves to the picture and the music.
 */
export const VOICE_DENSITY_RULES: Record<VoiceDensity, {
  /** The longest the voice may rest between two lines. */
  breathSeconds: number;
  /** Rests the director may hold longer, for the picture or the music alone. */
  pauses: number;
  /** How long such a rest may be. */
  pauseSeconds: number;
  /** The least share of the film, before its close, the voice is heard in. */
  coverage: number;
}> = {
  continuous: { breathSeconds: 1.5, pauses: 2, pauseSeconds: 3, coverage: 0.7 },
  key_moments: { breathSeconds: 4, pauses: 0, pauseSeconds: 4, coverage: 0.4 },
};

export type VoiceHole = {
  /** Film time the voice stops. */
  startSeconds: number;
  seconds: number;
  /** The scenes the hole runs across, by index. */
  scenes: number[];
};

export type VoiceCoverage = {
  voicedSeconds: number;
  /** The film before its close. */
  spokenSpanSeconds: number;
  coverage: number;
  /** Rests longer than the density allows. */
  holes: VoiceHole[];
  /** What is wrong, in the words a planner is told, or null when the film holds the line. */
  problem: string | null;
};

export function voiceCoverage(scenes: readonly Scene[], density: VoiceDensity): VoiceCoverage {
  const rules = VOICE_DENSITY_RULES[density];
  const last = scenes.at(-1);
  const filmEnd = scenes.reduce((end, scene) => Math.max(end, scene.startTime + scene.duration), 0);
  const end = last && last.visualType === 'logo_reveal' && scenes.length > 1 ? last.startTime : filmEnd;

  const spoken = scenes
    .filter((scene) => scene.narration.trim().length > 0 && scene.startTime < end)
    .map((scene) => ({ from: scene.startTime, to: Math.min(scene.startTime + scene.duration, scene.startTime + narrationSeconds(scene.narration), end) }));
  const voicedSeconds = spoken.reduce((total, span) => total + Math.max(0, span.to - span.from), 0);

  const rests: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const span of spoken) {
    if (span.from > cursor) rests.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (end > cursor) rests.push({ from: cursor, to: end });

  // The director's held rests: the longest ones that are still short enough to be a choice.
  const long = rests.filter((rest) => rest.to - rest.from > rules.breathSeconds + 1e-6);
  const held = new Set(
    [...long]
      .filter((rest) => rest.to - rest.from <= rules.pauseSeconds + 1e-6)
      .sort((a, b) => b.to - b.from - (a.to - a.from))
      .slice(0, rules.pauses),
  );
  const holes = long
    .filter((rest) => !held.has(rest))
    .map((rest) => ({
      startSeconds: round(rest.from),
      seconds: round(rest.to - rest.from),
      scenes: scenes.filter((scene) => scene.startTime < rest.to - 1e-6 && scene.startTime + scene.duration > rest.from + 1e-6).map((scene) => scene.index),
    }));

  const coverage = end > 0 ? voicedSeconds / end : 1;
  const problems: string[] = [];
  for (const hole of holes) {
    problems.push(
      `The voice is silent for ${hole.seconds.toFixed(1)}s from ${hole.startSeconds.toFixed(1)}s, across scene${hole.scenes.length === 1 ? '' : 's'} ${hole.scenes.map((index) => index + 1).join(', ')}.`,
    );
  }
  if (coverage < rules.coverage - 1e-6) {
    problems.push(`The voice is heard in ${Math.round(coverage * 100)}% of the film before its close; this film's voice carries at least ${Math.round(rules.coverage * 100)}%.`);
  }
  return {
    voicedSeconds: round(voicedSeconds),
    spokenSpanSeconds: round(end),
    coverage: Math.round(coverage * 1000) / 1000,
    holes,
    problem: problems.length > 0 ? problems.join(' ') : null,
  };
}

/** How many words of narration a film of this length is written with, before its close. */
export function narrationWordsFor(spokenSpanSeconds: number, density: VoiceDensity, wordsPerSecond: number): number {
  const share = density === 'continuous' ? 0.8 : 0.5;
  return Math.max(6, Math.round(spokenSpanSeconds * share * wordsPerSecond));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
