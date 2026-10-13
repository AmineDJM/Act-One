import { resequence, storyboardDuration, type Storyboard } from '@act-one/core';
import type { MusicTrack } from './library.ts';

/**
 * The music's pulse, and the cuts put on it.
 *
 * A cut that lands on the beat is felt before it is seen; one a few frames
 * off reads as a cut that happens to have music under it. Two moves, in this
 * order, and the picture is the one that moves least:
 *
 *  1. The track is placed so its beats fall as near the film's cuts as they
 *     can — a phase chosen within half a beat of where the Sound Director
 *     wanted the drop, so the drop still lands on the film's turn.
 *  2. A cut that is then within a few frames of a beat is moved onto it, on
 *     the frame grid. Never further, and never so a scene loses more than a
 *     sliver of its length: the storyboard's timing is the film's, the beat
 *     only refines it.
 */

/** Where a track sits in the film: what the mix needs to know to find its beats. */
export type MusicPlacement = {
  trackId: string;
  /** Film time at which the music starts. */
  enterAtSeconds: number;
  /** How far into the track the music starts. */
  startOffsetSeconds: number;
};

/** How far a cut may move to meet a beat, in frames. */
export const BEAT_SNAP_FRAMES = 4;

/** A scene keeps at least this share of its length, and this many seconds, whatever the beat wants. */
const KEEP_SHARE = 0.85;
const KEEP_SECONDS = 0.6;

/** Seconds per beat. */
export function beatSeconds(track: Pick<MusicTrack, 'bpm'>): number {
  return 60 / track.bpm;
}

/** The beats a placed track plays, in film time, from its entry to `untilSeconds`. */
export function beatTimes(track: Pick<MusicTrack, 'bpm' | 'firstBeatSeconds'>, placement: Omit<MusicPlacement, 'trackId'>, untilSeconds: number): number[] {
  const beat = beatSeconds(track);
  // The track's own beat k sits at firstBeat + k·beat; it plays at enter + that − offset.
  const origin = placement.enterAtSeconds + (track.firstBeatSeconds ?? 0) - placement.startOffsetSeconds;
  const first = Math.ceil((placement.enterAtSeconds - origin) / beat - 1e-9);
  const times: number[] = [];
  for (let k = Math.max(0, first); ; k += 1) {
    const at = origin + k * beat;
    if (at > untilSeconds + 1e-9) break;
    if (at >= placement.enterAtSeconds - 1e-9) times.push(at);
  }
  return times;
}

/** The film's cuts: every scene start but the first, in film time. */
export function cutTimes(storyboard: Storyboard): number[] {
  return storyboard.scenes.slice(1).map((scene) => scene.startTime);
}

/** Distance from `at` to the nearest of a sorted list of times. */
function nearest(times: readonly number[], at: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const time of times) {
    const distance = Math.abs(time - at);
    if (distance < best) best = distance;
    if (time > at && distance > best) break;
  }
  return best;
}

/**
 * The start offset, within half a beat of `preferredOffset` (a whole beat
 * later when that would start before the track does), that puts the
 * most cuts on (or nearest) a beat. Each cut scores by how close it lands
 * inside the snap window — on the beat is worth 1, at the window's edge 0 —
 * and the offset nearest the preferred one wins a tie, so a film whose cuts
 * ignore any grid keeps the drop exactly where it was planned.
 */
export function phaseToCuts(
  track: Pick<MusicTrack, 'bpm' | 'firstBeatSeconds'>,
  cuts: readonly number[],
  placement: Omit<MusicPlacement, 'trackId'>,
  options: { fps: number; untilSeconds: number },
): number {
  const beat = beatSeconds(track);
  const window = BEAT_SNAP_FRAMES / options.fps;
  const heard = cuts.filter((cut) => cut > placement.enterAtSeconds + 0.05 && cut < options.untilSeconds);
  if (heard.length === 0) return placement.startOffsetSeconds;
  const score = (offset: number): number => {
    const beats = beatTimes(track, { ...placement, startOffsetSeconds: offset }, options.untilSeconds + beat);
    return heard.reduce((sum, cut) => sum + Math.max(0, 1 - nearest(beats, cut) / window), 0);
  };
  let best = placement.startOffsetSeconds;
  let bestScore = score(best);
  const step = 0.005;
  for (let delta = step; delta <= beat / 2 + 1e-9; delta += step) {
    for (const candidate of [placement.startOffsetSeconds - delta, placement.startOffsetSeconds + delta]) {
      // Before the track's start is the same grid a beat later in it.
      const offset = candidate < 0 ? candidate + beat : candidate;
      const value = score(offset);
      // Strictly better only: the search runs outward, so a tie keeps the nearer offset.
      if (value > bestScore + 1e-9) {
        best = offset;
        bestScore = value;
      }
    }
  }
  return Number(best.toFixed(3));
}

export type SnapReport = {
  storyboard: Storyboard;
  /** Cuts moved onto a beat. */
  moved: number;
  /** Cuts on a beat after the snap, moved or already there. */
  onBeat: number;
  cuts: number;
};

/**
 * The storyboard with each cut that is within `BEAT_SNAP_FRAMES` of a beat
 * moved onto it, on the frame grid. The film's length is unchanged: only the
 * cuts inside it move, and a cut stays put when moving it would take a scene
 * below 85% of its planned length or under 0.6 s.
 */
export function snapCutsToBeats(storyboard: Storyboard, beats: readonly number[], fps: number): SnapReport {
  const scenes = storyboard.scenes;
  const cuts = cutTimes(storyboard);
  if (cuts.length === 0 || beats.length === 0) return { storyboard, moved: 0, onBeat: 0, cuts: cuts.length };
  const total = storyboardDuration(storyboard);
  const window = BEAT_SNAP_FRAMES / fps + 1e-6;
  const onFrame = (seconds: number) => Math.round(seconds * fps) / fps;
  const frameBeats = beats.map(onFrame);
  const tolerance = 0.5 / fps;

  const starts = [0, ...cuts];
  let moved = 0;
  for (let index = 1; index < starts.length; index += 1) {
    const cut = starts[index]!;
    const target = frameBeats.reduce((best, at) => (Math.abs(at - cut) < Math.abs(best - cut) ? at : best), Number.POSITIVE_INFINITY);
    const shift = target - cut;
    if (!Number.isFinite(shift) || Math.abs(shift) < tolerance || Math.abs(shift) > window) continue;
    const previousStart = starts[index - 1]!;
    const nextStart = index + 1 < starts.length ? starts[index + 1]! : total;
    const before = target - previousStart;
    const after = nextStart - target;
    if (before < Math.max(KEEP_SECONDS, scenes[index - 1]!.duration * KEEP_SHARE)) continue;
    if (after < Math.max(KEEP_SECONDS, scenes[index]!.duration * KEEP_SHARE)) continue;
    starts[index] = target;
    moved += 1;
  }
  const onBeat = starts.slice(1).filter((start) => frameBeats.some((at) => Math.abs(at - start) < tolerance)).length;
  if (moved === 0) return { storyboard, moved, onBeat, cuts: cuts.length };

  const durations = starts.map((start, index) => (index + 1 < starts.length ? starts[index + 1]! : total) - start);
  const snapped = resequence({
    ...storyboard,
    scenes: scenes.map((scene, index) => ({ ...scene, duration: Number(durations[index]!.toFixed(6)) })),
  });
  return { storyboard: snapped, moved, onBeat, cuts: cuts.length };
}
