import { describe, expect, it } from 'vitest';
import { alignToTypography, wordsLandAt, type ShotWords } from '../narration/align.ts';
import type { MeasuredTake } from '../narration/hold.ts';

const take = (sceneId: string, delaySeconds: number, durationSeconds = 2): MeasuredTake =>
  ({ sceneId, delaySeconds, durationSeconds });

const shot = (id: string, durationSeconds: number, wordsAtSeconds: number | null): ShotWords =>
  ({ id, durationSeconds, wordsAtSeconds });

describe('when a shot has finished saying its piece', () => {
  it('waits for the LAST staggered word, not the first', () => {
    // Five words, 0.1s apart, starting at 0.5s: the sentence is not up until 0.9s.
    expect(
      wordsLandAt([
        { kind: 'text', content: 'one two three four five', enterAt: 0.5, staggerBy: 'word', staggerSeconds: 0.1 },
      ]),
    ).toBeCloseTo(0.9, 5);
  });

  it('ignores structure, which is furniture rather than the line', () => {
    // An index number that lands late must not hold the voice back.
    expect(
      wordsLandAt([
        { kind: 'text', role: 'payload', content: 'The line.', enterAt: 0.3 },
        { kind: 'text', role: 'structure', content: '02', enterAt: 2.5 },
      ]),
    ).toBeCloseTo(0.3, 5);
  });

  it('has no answer for a shot with no words in it', () => {
    expect(wordsLandAt([{ kind: 'clip', enterAt: 0 }])).toBeNull();
  });
});

describe('aligning the read to the typography', () => {
  it('starts the line a beat after its shot has said its piece', () => {
    const { takes, moved } = alignToTypography([take('a', 0.25)], [shot('a', 5, 0.9)], { beatSeconds: 0.2 });
    expect(takes[0]!.delaySeconds).toBeCloseTo(1.1, 5);
    expect(moved).toEqual(['a 0.25s -> 1.10s']);
  });

  it('leaves a wordless shot alone, because there is nothing to land with', () => {
    const { takes, moved } = alignToTypography([take('a', 0.25)], [shot('a', 5, null)]);
    expect(takes[0]!.delaySeconds).toBe(0.25);
    expect(moved).toEqual([]);
  });

  it('will not push a line past the end of its own shot', () => {
    // Words land at 2.4s in a 3s shot; a 2s line started at 2.6s would run off.
    const { takes, moved } = alignToTypography([take('a', 0.3, 2)], [shot('a', 3, 2.4)]);
    expect(takes[0]!.delaySeconds).toBe(0.3);
    expect(moved).toEqual([]);
  });

  it('caps how late a line may start, whatever the copy does', () => {
    const { takes } = alignToTypography([take('a', 0.2, 1)], [shot('a', 20, 9)], { latestSeconds: 1.5 });
    expect(takes[0]!.delaySeconds).toBe(1.5);
  });

  it('does not report a move too small to hear', () => {
    const { moved } = alignToTypography([take('a', 0.3)], [shot('a', 5, 0.14)], { beatSeconds: 0.18 });
    expect(moved).toEqual([]);
  });

  it('leaves a take whose shot it does not know', () => {
    const { takes } = alignToTypography([take('ghost', 0.4)], [shot('a', 5, 0.5)]);
    expect(takes[0]!.delaySeconds).toBe(0.4);
  });
});
