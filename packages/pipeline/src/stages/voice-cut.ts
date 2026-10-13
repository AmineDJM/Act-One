import { REAL_PRODUCT_VISUAL_TYPES, resequence, round3, type Scene, type Storyboard } from '@act-one/core';
import { readingSeconds } from '@act-one/creative';
import { DRAWN_BEAT_MIN_SECONDS } from './interface-drawings.ts';

/**
 * The picture, cut to the voice that was actually recorded.
 *
 * A storyboard's beats are timed from an estimate of how long each line takes
 * to say. The recording is never that length: a line read briskly leaves the
 * rest of its beat to the music, and three of those in a row is a film that
 * stops talking for seconds at a time while its picture waits. An editor cuts
 * narration the other way round — the line is read, then the shot is cut to
 * it — and that is what this does, once the voice exists and before anything
 * is drawn.
 *
 * A narrated beat runs to the end of its words and a breath, and no further;
 * one whose line was longer than its beat is given the time, so the words
 * never finish over the next shot. It never gets shorter than its own text
 * takes to read, nor than an interface drawn back up needs to be built, used
 * and shown. A beat with no voice keeps its length: it is a rest the director
 * wrote. Every sound the plan placed in a beat moves with it.
 */
export const VOICE_BREATH_SECONDS = 0.35;
/** Below this a beat cannot be seen at all. */
const SHORTEST_BEAT_SECONDS = 1;
/** A difference smaller than this is the estimate being right, not a reason to recut. */
const RECUT_TOLERANCE_SECONDS = 0.2;

export type PlacedLine = {
  sceneId: string | null;
  atSeconds: number;
  durationSeconds: number;
  tailSilenceSeconds: number;
};

export type VoiceCut<T extends PlacedLine> = {
  storyboard: Storyboard;
  tracks: T[];
  /** The beats that changed length, for the log and the console. */
  recut: { sceneId: string; fromSeconds: number; toSeconds: number }[];
};

export function cutToTheVoice<T extends PlacedLine>(storyboard: Storyboard, tracks: readonly T[]): VoiceCut<T> {
  const byScene = new Map<string, T[]>();
  for (const track of tracks) {
    if (!track.sceneId) continue;
    byScene.set(track.sceneId, [...(byScene.get(track.sceneId) ?? []), track]);
  }

  const recut: VoiceCut<T>['recut'] = [];
  const durations = storyboard.scenes.map((scene) => {
    const lines = byScene.get(scene.id);
    if (!lines || lines.length === 0) return scene.duration;
    // Where the last word of the beat lands, from the beat's own start.
    const wordsEnd = Math.max(...lines.map((line) => line.atSeconds - scene.startTime + line.durationSeconds - line.tailSilenceSeconds));
    const wanted = Math.max(floorOf(scene), wordsEnd + VOICE_BREATH_SECONDS);
    if (Math.abs(wanted - scene.duration) < RECUT_TOLERANCE_SECONDS) return scene.duration;
    const to = round3(wanted);
    recut.push({ sceneId: scene.id, fromSeconds: scene.duration, toSeconds: to });
    return to;
  });
  if (recut.length === 0) return { storyboard, tracks: [...tracks], recut };

  const retimed = resequence({
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => ({ ...scene, duration: durations[index]! })),
  });
  const moved = new Map(storyboard.scenes.map((scene, index) => [scene.id, { before: scene, after: retimed.scenes[index]! }]));
  const scenes = retimed.scenes.map((scene) => ({ ...scene, soundCues: movedCues(moved.get(scene.id)!.before, scene) }));

  return { storyboard: { ...retimed, scenes }, tracks: followTheCuts(tracks, storyboard, retimed), recut };
}

/** Each line where its beat now starts, after the beats were retimed: the same distance into the same beat. */
export function followTheCuts<T extends PlacedLine>(tracks: readonly T[], before: Storyboard, after: Storyboard): T[] {
  const moved = new Map(before.scenes.map((scene) => [scene.id, { before: scene, after: after.scenes.find((candidate) => candidate.id === scene.id) ?? scene }]));
  return tracks.map((track) => {
    const owner = track.sceneId ? moved.get(track.sceneId) : sceneHolding(before.scenes, track.atSeconds, moved);
    if (!owner) return track;
    return { ...track, atSeconds: round3(owner.after.startTime + (track.atSeconds - owner.before.startTime)) };
  });
}

/** The shortest a narrated beat may be cut to: its words read, its interface drawn. */
function floorOf(scene: Scene): number {
  const drawn = REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.duration >= DRAWN_BEAT_MIN_SECONDS ? DRAWN_BEAT_MIN_SECONDS : 0;
  return Math.max(SHORTEST_BEAT_SECONDS, readingSeconds(scene.onScreenText), drawn);
}

/** A beat's sounds, on the film's clock, where the beat now is; a direction that ran the whole beat still does. */
function movedCues(before: Scene, after: Scene): Scene['soundCues'] {
  const shift = after.startTime - before.startTime;
  const end = after.startTime + after.duration;
  return before.soundCues.map((cue) => {
    const time = round3(Math.min(Math.max(after.startTime, cue.time + shift), end));
    const spanned = cue.durationSeconds !== null && Math.abs(cue.durationSeconds - before.duration) < 1e-3;
    return {
      ...cue,
      time,
      durationSeconds: spanned ? after.duration : cue.durationSeconds === null ? null : Math.min(cue.durationSeconds, Math.max(0, end - time)),
    };
  });
}

function sceneHolding(
  scenes: readonly Scene[],
  at: number,
  moved: ReadonlyMap<string, { before: Scene; after: Scene }>,
): { before: Scene; after: Scene } | undefined {
  const scene = scenes.find((candidate) => at >= candidate.startTime - 1e-6 && at < candidate.startTime + candidate.duration);
  return scene ? moved.get(scene.id) : undefined;
}
