import { readingSecondsFor } from './typography.ts';
import type { Standard } from './standard.ts';

/**
 * Time.
 *
 * Every other family of standards here can be decided from a plan or a single
 * frame. These can only be decided from the finished thing and a clock, and
 * they are the defects a demanding viewer notices without being able to name:
 * the caption that lands a beat after the word, the cut that arrives just off
 * the music, the shot held two frames too long, the music that stops rather
 * than ends.
 *
 * "Roughly aligned" is what this family exists to refuse. Where a published
 * number exists it is used and it is strict — the subtitling world measures
 * synchronisation in frames, not in "about right" — and where one does not,
 * the house rule says so and gives its reasoning.
 */
export const TEMPORAL_STANDARDS = {
  captionSync: {
    id: 'temporal.caption_sync',
    rule: 'A caption appears within three frames of the audio it captions, and never before it.',
    source: 'Netflix Timed Text Style Guide',
    clause: 'Timing — general requirements',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Three frames is where a viewer stops reading the caption as part of the film and starts ' +
      'noticing it as a track laid over the top. Early is worse than late by a wide margin: a ' +
      'caption that arrives before the line is spoken gives away the sentence.',
  },
  captionLinger: {
    id: 'temporal.caption_linger',
    rule: 'A caption leaves within a second and a half of the line ending, and never before it ends.',
    source: 'BBC Subtitle Guidelines',
    clause: 'Timing and synchronisation',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'A caption that vanishes mid-sentence is unreadable; one that sits there through the next ' +
      'shot reads as a mistake, and on a muted feed it is the thing the eye is on.',
  },
  captionOverlap: {
    id: 'temporal.caption_overlap',
    rule: 'Two captions never occupy the same moment.',
    source: 'EBU-TT-D / W3C TTML2',
    clause: 'Region and timing model',
    authority: 'normative',
    enforcement: 'checked',
    because:
      'Overlapping cues render on top of each other or fight for the same region, and which one ' +
      'wins is the player’s decision rather than ours.',
  },
  speechInsideItsShot: {
    id: 'temporal.speech_in_shot',
    rule: 'A line finishes inside the shot it belongs to, give or take a quarter second.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Narration that runs past its cut lands the end of a thought over the start of the next ' +
      'image. It is the single most common reason an assembled film feels assembled.',
  },
  heldFrame: {
    id: 'temporal.held_frame',
    rule: 'Nothing on screen stays identical for more than a beat: 1.2s in a film, 0.6s in a short.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A frozen frame is either a held composition, which is a choice, or a render that dropped ' +
      'its motion, which is a fault — and they are indistinguishable to a viewer, which is why ' +
      'the bar is what the eye tolerates rather than what the code intended.',
  },
  deadAir: {
    id: 'temporal.dead_air',
    rule: 'No silence longer than 1.2s inside a film, or 0.4s inside a short.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A pause is a tool and dead air is a hole. The difference is length, and past about a ' +
      'second a viewer checks whether the file has stopped.',
  },
  levelJump: {
    id: 'temporal.level_jump',
    rule: 'Short-term loudness moves by no more than 5 LU between adjacent windows.',
    source: 'EBU Tech 3341',
    clause: 'Short-term loudness, 3s window',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'A jump of more than about five loudness units is heard as somebody turning a knob. The ' +
      'measurement window is the published one so the number means what the standard means.',
  },
  endedNotStopped: {
    id: 'temporal.ended_not_stopped',
    rule: 'A film ends. Its last 200ms fade rather than cut to nothing.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Music cut at full level is the most recognisable sound of an unfinished edit, and it is ' +
      'a hundred milliseconds of work to fix.',
  },
} as const satisfies Record<string, Standard>;

/**
 * Caption synchronisation, in seconds.
 *
 * Netflix states the tolerance in frames; frames are a function of the rate,
 * so the arithmetic is done once here rather than in the check. Early and late
 * are not symmetric on purpose.
 */
export const CAPTION_SYNC_FRAMES = 3;
export function captionSyncTolerance(fps: number): { early: number; late: number } {
  const frame = fps > 0 ? CAPTION_SYNC_FRAMES / fps : 0.125;
  return { early: frame, late: Math.max(frame, 0.5) };
}

/** How long a caption may stay after its line ends, in seconds. */
export const CAPTION_LINGER_CEILING = 1.5;

/** How far a line may overrun its shot before it reads as a mistake. */
export const SPEECH_OVERRUN_TOLERANCE = 0.25;

/** How long a frame may stay identical, by cut. */
export const HELD_FRAME_CEILING = { feature: 1.2, short: 0.6 } as const;

/**
 * The longest a still shot may run, given what is written on it.
 *
 * One definition, used by the check that finds a held frame and by the
 * director that must not author one. They drifted apart the first time they
 * were written separately — the planner allowed a shot its reading time plus
 * a beat, the check allowed the larger of the two — and the difference is a
 * film that passes planning and fails QA, once per beat, for ever.
 *
 * A viewer reading is not waiting, so a shot earns the time its copy takes.
 * Past that it is a hold, whoever decided it.
 */
export function holdCeilingFor(copy: string, cut: 'feature' | 'short'): number {
  const beat = HELD_FRAME_CEILING[cut === 'short' ? 'short' : 'feature'];
  return Math.max(beat, readingSecondsFor(copy));
}

/** How long the track may be silent mid-film, by cut. */
export const DEAD_AIR_CEILING = { feature: 1.2, short: 0.4 } as const;

/** Loudness units between adjacent short-term windows. */
export const LEVEL_JUMP_CEILING_LU = 5;

/** Below this, in dBFS, the track counts as silent for the tail check. */
export const TAIL_SILENCE_FLOOR_DB = -40;

/** How much of the end must have faded. */
export const TAIL_FADE_SECONDS = 0.2;
