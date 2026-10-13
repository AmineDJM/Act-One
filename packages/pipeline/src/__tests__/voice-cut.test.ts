import { describe, expect, it } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { VOICE_BREATH_SECONDS, cutToTheVoice, followTheCuts } from '../stages/voice-cut.ts';

/**
 * The picture is cut to the voice that was recorded: a narrated beat ends a
 * breath after its last word, no line finishes over the next shot, and every
 * sound and line moves with its beat.
 */
function board(specs: { seconds: number; text?: string[]; visualType?: Scene['visualType']; cues?: Scene['soundCues'] }[]): Storyboard {
  const scenes = specs.map((spec, index) => ({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: 0, duration: spec.seconds, purpose: 'beat',
    narration: 'words', onScreenText: spec.text ?? [], visualType: spec.visualType ?? 'kinetic_typography', assetRefs: [], momentIds: [],
    soundCues: spec.cues ?? [], voiceOver: true,
  })) as unknown as Scene[];
  return resequence({ id: 'sbd_1', scenes } as unknown as Storyboard);
}
const track = (sceneId: string, atSeconds: number, durationSeconds: number, tailSilenceSeconds = 0.1) => ({ sceneId, atSeconds, durationSeconds, tailSilenceSeconds, text: 'words' });

describe('the picture, cut to the recorded voice', () => {
  it('ends a narrated beat a breath after its last word, and moves everything after it up', () => {
    const film = board([{ seconds: 6 }, { seconds: 4 }, { seconds: 3 }]);
    const cut = cutToTheVoice(film, [track('scn_0', 0, 3.1), track('scn_1', 6, 3.7)]);
    // 3.1 s recorded, 0.1 s of it trailing silence: the words end at 3.0.
    expect(cut.storyboard.scenes[0]!.duration).toBeCloseTo(3 + VOICE_BREATH_SECONDS, 3);
    expect(cut.storyboard.scenes[1]!.startTime).toBeCloseTo(3.35, 3);
    // The second line was the estimate's length within tolerance: untouched, but it moved with its beat.
    expect(cut.storyboard.scenes[1]!.duration).toBe(4);
    expect(cut.tracks[1]!.atSeconds).toBeCloseTo(3.35, 3);
    // A beat with no voice keeps the rest the director wrote.
    expect(cut.storyboard.scenes[2]!.duration).toBe(3);
    expect(cut.recut).toEqual([{ sceneId: 'scn_0', fromSeconds: 6, toSeconds: 3.35 }]);
  });

  it('gives a line longer than its beat the time, so the words never finish over the next shot', () => {
    const cut = cutToTheVoice(board([{ seconds: 2 }, { seconds: 3 }]), [track('scn_0', 0.2, 3, 0)]);
    expect(cut.storyboard.scenes[0]!.duration).toBeCloseTo(3.2 + VOICE_BREATH_SECONDS, 3);
  });

  it('never cuts a beat shorter than its text takes to read, or than its interface takes to draw', () => {
    const cut = cutToTheVoice(
      board([
        { seconds: 6, text: ['Every invoice matched the moment it lands in the inbox'] },
        { seconds: 5, visualType: 'product_ui' },
      ]),
      [track('scn_0', 0, 1), track('scn_1', 6, 1)],
    );
    expect(cut.storyboard.scenes[0]!.duration).toBeGreaterThan(3.5);
    expect(cut.storyboard.scenes[1]!.duration).toBe(2.6);
  });

  it('moves the beat’s sounds with it, and a direction that ran the whole beat still does', () => {
    const film = board([
      { seconds: 6 },
      { seconds: 4, cues: [{ time: 6.5, type: 'whoosh', assetId: null, intensity: 0.4, durationSeconds: null }, { time: 6, type: 'music_duck', assetId: null, intensity: 0.4, durationSeconds: 4 }] },
    ]);
    const cut = cutToTheVoice(film, [track('scn_0', 0, 2.1), track('scn_1', 6, 2.6)]);
    const second = cut.storyboard.scenes[1]!;
    expect(second.startTime).toBeCloseTo(2.35, 3);
    expect(second.soundCues[0]!.time).toBeCloseTo(2.85, 3);
    expect(second.soundCues[1]).toMatchObject({ type: 'music_duck', durationSeconds: second.duration });
  });

  it('changes nothing when the voice came back the length it was planned at', () => {
    const film = board([{ seconds: 3 }, { seconds: 3 }]);
    const cut = cutToTheVoice(film, [track('scn_0', 0, 2.75), track('scn_1', 3, 2.8)]);
    expect(cut.storyboard).toBe(film);
    expect(cut.recut).toEqual([]);
  });

  it('places each line the same distance into its beat after the cuts move again', () => {
    const before = board([{ seconds: 3 }, { seconds: 3 }]);
    const after = resequence({ ...before, scenes: [{ ...before.scenes[0]!, duration: 2.9 }, before.scenes[1]!] });
    expect(followTheCuts([track('scn_1', 3.2, 2)], before, after)[0]!.atSeconds).toBeCloseTo(3.1, 3);
  });
});
