import { describe, expect, it } from 'vitest';
import { clockFrom } from '../clock.tsx';
import { exitProgress } from '../easing.ts';

/**
 * A scene's exit belongs to its beat, not to its mount.
 *
 * Mounted 0.9 s early because it arrives through a join, a 3.6 s beat ends
 * 4.5 s after the mount. Timed from the mount, its components used to clear at
 * 3.6 s and leave the frame empty for the last 0.9 s of the beat.
 */
describe('a scene clears where its beat ends', () => {
  const fps = 30;
  const arrived = { beatStartSeconds: 0.9, beatSeconds: 3.6, mountedSeconds: 4.5, leavesByCut: true };

  it('ending on the last frame of its beat when it arrived through a join and leaves by a cut', () => {
    expect(exitProgress(3.6 * fps, fps, 3.6, 0.35, arrived)).toBe(0);
    expect(exitProgress((4.5 - 0.35) * fps, fps, 3.6, 0.35, arrived)).toBeCloseTo(0, 9);
    expect(exitProgress((4.5 - 0.35 / 2) * fps, fps, 3.6, 0.35, arrived)).toBeCloseTo(0.5, 6);
    expect(exitProgress(4.5 * fps, fps, 3.6, 0.35, arrived)).toBe(1);
  });

  it('not at all when a join carries it out', () => {
    const carried = { ...arrived, mountedSeconds: 5.3, leavesByCut: false };
    for (let frame = 0; frame <= 5.3 * fps; frame += 1) expect(exitProgress(frame, fps, 3.6, 0.35, carried)).toBe(0);
  });

  it('at the end of the duration it was given when it is drawn outside a film', () => {
    expect(exitProgress((3.6 - 0.35) * fps, fps, 3.6, 0.35)).toBe(0);
    expect(exitProgress(3.6 * fps, fps, 3.6, 0.35)).toBe(1);
  });

  it('seen from a sequence that starts later in the scene, as the last framing of a filmed capture is', () => {
    const lastFraming = clockFrom(arrived, 1.8);
    expect(lastFraming).toEqual({ beatStartSeconds: -0.9, beatSeconds: 3.6, mountedSeconds: 2.7, leavesByCut: true });
    // 2.7 s into the framing is 4.5 s into the mount: the beat's end.
    expect(exitProgress(2.7 * fps, fps, 3, 0.3, lastFraming)).toBe(1);
    expect(exitProgress((2.7 - 0.3) * fps, fps, 3, 0.3, lastFraming)).toBeCloseTo(0, 9);
  });
});
