import { describe, expect, it } from 'vitest';
import { resequence, storyboardDuration, type Scene, type Storyboard } from '@act-one/core';
import { beatTimes, cutTimes, directSound, MusicTrack, phaseToCuts, snapCutsToBeats, syncCutsToMusic } from '../index.ts';

/**
 * The cuts and the music's pulse.
 *
 * Proved on numbers that can be worked by hand: 120 bpm is a beat every half
 * second, and 30 fps puts four frames at 0.133 s.
 */
function board(durations: number[]): Storyboard {
  const scenes = durations.map((duration, index) => ({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: 0, duration, purpose: 'a beat',
    narration: '', onScreenText: [], visualType: index === 2 ? 'product_ui' : 'kinetic_type', assetRefs: [], momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'none', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'linear' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
  })) as unknown as Scene[];
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: null, handovers: {}, version: 1, scenes,
    voiceStrategy: 'none', language: 'en', heroShot: null, musicDirection: 'a pulse', status: 'draft',
    parentStoryboardId: null, revisionReason: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Storyboard);
}

const PULSE = { bpm: 120, firstBeatSeconds: 0 };

describe('the beat grid', () => {
  it('is the track’s own beats, shifted to where the track enters and starts', () => {
    // Enters at 1 s, 0.2 s into the track: the track's beat at 0.5 plays at 1.3.
    expect(beatTimes(PULSE, { enterAtSeconds: 1, startOffsetSeconds: 0.2 }, 3)).toEqual([1.3, 1.8, 2.3, 2.8]);
    // A bought track whose first downbeat is 0.31 s in.
    const late = beatTimes({ bpm: 120, firstBeatSeconds: 0.31 }, { enterAtSeconds: 0, startOffsetSeconds: 0 }, 1.5);
    expect(late.map((at) => Number(at.toFixed(2)))).toEqual([0.31, 0.81, 1.31]);
  });

  it('is phased so the cuts fall on it, within half a beat of the planned drop', () => {
    // Cuts on a half-second grid that sits 0.13 s after the track's: the offset that meets them is 0.13 before the
    // track's start — the same grid a beat later, at 0.37.
    const cuts = [2.13, 4.13, 5.63, 7.13];
    const offset = phaseToCuts(PULSE, cuts, { enterAtSeconds: 0, startOffsetSeconds: 0 }, { fps: 30, untilSeconds: 10 });
    const beats = beatTimes(PULSE, { enterAtSeconds: 0, startOffsetSeconds: offset }, 10);
    for (const cut of cuts) expect(Math.min(...beats.map((at) => Math.abs(at - cut)))).toBeLessThan(0.006);
    expect(offset).toBeCloseTo(0.37, 3);
  });

  it('keeps the planned phase when no cut is near any beat it could choose', () => {
    expect(phaseToCuts(PULSE, [], { enterAtSeconds: 0, startOffsetSeconds: 0.4 }, { fps: 30, untilSeconds: 10 })).toBe(0.4);
  });
});

describe('cuts on the beat', () => {
  it('moves a cut within four frames onto the beat, on the frame grid, and leaves the film’s length alone', () => {
    const film = board([2.1, 1.9, 3.3, 2.7]);
    const beats = beatTimes(PULSE, { enterAtSeconds: 0, startOffsetSeconds: 0 }, 10);
    const { storyboard, moved, onBeat, cuts } = snapCutsToBeats(film, beats, 30);
    // 2.1 → 2.0 (3 frames), 4.0 already on, 7.3 → 7.5 is 6 frames: too far.
    expect(cutTimes(storyboard)).toEqual([2, 4, 7.3]);
    expect({ moved, onBeat, cuts }).toEqual({ moved: 1, onBeat: 2, cuts: 3 });
    expect(storyboardDuration(storyboard)).toBe(storyboardDuration(film));
  });

  it('never takes a scene below most of its planned length to meet a beat', () => {
    // A 0.68 s flash from 1.4 s: its opening cut would go to 1.5 and leave it 0.58 s, so it stays;
    // its closing cut goes back to 2.0, which leaves it 0.6 s, and it moves.
    const film = board([1.4, 0.68, 2.92]);
    const beats = beatTimes(PULSE, { enterAtSeconds: 0, startOffsetSeconds: 0 }, 6);
    const { storyboard, moved } = snapCutsToBeats(film, beats, 30);
    expect(cutTimes(storyboard)).toEqual([1.4, 2]);
    expect(moved).toBe(1);
  });
});

describe('a film cut to its music', () => {
  const behaviour = { musicCharacter: 'percussive, rhythm-led', openOnMusic: true, uiSoundDensity: 'sparse' as const, impactsOnCuts: true, endWithSting: false };

  it('puts more of its cuts on the beat, and the mix plays the placement the cuts were moved to', () => {
    const film = board([1.95, 2.34, 1.95, 2.72, 2.46, 2.34, 2.72, 1.24, 1.75, 1.57, 2.02, 1.65, 2.02, 2.26, 2.2]);
    const synced = syncCutsToMusic({ storyboard: film, behaviour }, 30);
    expect(synced.placement?.trackId).toBe('mus_machine_room');
    expect(synced.moved).toBeGreaterThan(0);
    expect(synced.onBeat).toBeGreaterThanOrEqual(Math.ceil(synced.cuts * 0.5));
    // No cut moved more than four frames.
    cutTimes(synced.storyboard).forEach((cut, index) => expect(Math.abs(cut - cutTimes(film)[index]!)).toBeLessThanOrEqual(4 / 30 + 0.001));
    const mixed = directSound({ storyboard: synced.storyboard, behaviour, placement: synced.placement! });
    expect(mixed.music?.startOffsetSeconds).toBe(synced.placement!.startOffsetSeconds);
    expect(mixed.music?.enterAtSeconds).toBe(synced.placement!.enterAtSeconds);
  });

  it('leaves a film under a pad alone: there is no pulse to cut to', () => {
    const film = board([2.1, 1.9, 3.3, 2.7]);
    const synced = syncCutsToMusic({ storyboard: film, behaviour: { ...behaviour, musicCharacter: 'ambient pad, almost ambient' } }, 30);
    expect(synced.moved).toBe(0);
    expect(synced.storyboard).toBe(film);
  });
});

describe('a catalogue track', () => {
  const track = { id: 'mus_bought', title: 'Bought', character: 'driving', bpm: 128, durationSeconds: 120, storageKey: 'library/music/bought.wav' };

  it('names the agreement it is licensed under', () => {
    expect(MusicTrack.safeParse({ ...track, license: 'licensed' }).success).toBe(false);
    expect(MusicTrack.safeParse({ ...track, license: 'licensed', licenseRef: 'AGR-2026-014' }).success).toBe(true);
    expect(MusicTrack.parse(track)).toMatchObject({ license: 'owned', firstBeatSeconds: 0, beatsPerBar: 4 });
  });
});
