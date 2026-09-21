import { describe, expect, it } from 'vitest';
import { place, retimeForNarration, type MeasuredTake } from '../narration/hold.ts';

const scenes = [
  { id: 'a', durationSeconds: 4 },
  { id: 'b', durationSeconds: 3 },
  { id: 'c', durationSeconds: 5 },
];

const take = (sceneId: string, delaySeconds: number, durationSeconds: number): MeasuredTake =>
  ({ sceneId, delaySeconds, durationSeconds });

describe('placing a read on the cut', () => {
  it('derives start times from the cut, so a longer shot carries its line with it', () => {
    expect(place([take('b', 0.5, 1)], scenes)[0]!.atSeconds).toBe(4.5);
    // Hold the FIRST shot half a second; the line in the second must move with it.
    const longer = [{ id: 'a', durationSeconds: 4.5 }, ...scenes.slice(1)];
    expect(place([take('b', 0.5, 1)], longer)[0]!.atSeconds).toBe(5);
  });

  it('measures the window from where the line starts, not from the whole shot', () => {
    const [placed] = place([take('b', 1, 1)], scenes);
    expect(placed!.windowSeconds).toBe(2);
    expect(placed!.overrunSeconds).toBe(0);
  });

  it('reports an overrun rather than silently letting the line spill', () => {
    expect(place([take('b', 0.5, 4)], scenes)[0]!.overrunSeconds).toBeCloseTo(1.5, 5);
  });
});

describe('holding the picture for the read', () => {
  it('lengthens the shot that cannot hold its line, and only that shot', () => {
    const { durations, held, addedSeconds } = retimeForNarration(scenes, place([take('b', 0.5, 4)], scenes));
    // 1.5s short, plus the tail that keeps the last word off the next cut.
    expect(durations.get('b')).toBeCloseTo(4.7, 5);
    expect(durations.get('a')).toBe(4);
    expect(addedSeconds).toBeCloseTo(1.7, 5);
    expect(held).toEqual(['b +1.70s']);
  });

  it('leaves the cut alone when every line fits', () => {
    const { held, addedSeconds, durations } = retimeForNarration(scenes, place([take('b', 0.5, 1)], scenes));
    expect(held).toEqual([]);
    expect(addedSeconds).toBe(0);
    expect(durations.get('b')).toBe(3);
  });

  it('ignores an overrun too small to hear', () => {
    expect(retimeForNarration(scenes, place([take('b', 0.5, 2.55)], scenes)).held).toEqual([]);
  });

  it('spends a tight budget on the worst overrun first', () => {
    const placed = place([take('a', 0, 6), take('c', 0, 5.4)], scenes);
    const { held, addedSeconds } = retimeForNarration(scenes, placed, { maxTotalSeconds: 1 });
    expect(held).toEqual(['a +1.00s']);
    expect(addedSeconds).toBe(1);
  });

  it('never gives back more than the budget allows', () => {
    const placed = place([take('a', 0, 20)], scenes);
    expect(retimeForNarration(scenes, placed, { maxTotalSeconds: 2 }).addedSeconds).toBeLessThanOrEqual(2);
  });
});
