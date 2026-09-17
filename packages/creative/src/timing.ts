import { READING_WORDS_PER_SECOND, NARRATION_WORDS_PER_SECOND } from '@act-one/core';

/**
 * Scene timing.
 *
 * Timing is most of what separates a film from a slideshow, and it is the thing
 * automated video gets wrong most reliably — either every scene is the same
 * length, or text appears for less time than it takes to read.
 *
 * Three rules, applied in order of authority:
 *  1. Legibility is absolute. On-screen text gets at least the time to read it,
 *     plus time for the eye to arrive and the cut to land. No budget overrides this.
 *  2. Narration cannot be cut off mid-word.
 *  3. Everything else is negotiable, and gets scaled to hit the target runtime.
 */
export function readingSeconds(text: string[]): number {
  const words = text.join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  // 0.45s for the eye to land, then reading time, then a beat before the cut.
  // Without the trailing beat, text that is technically readable still feels
  // snatched away.
  return 0.45 + words / READING_WORDS_PER_SECOND + 0.35;
}

export function narrationSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const sentences = (text.match(/[.!?]+/g) ?? []).length;
  return words / NARRATION_WORDS_PER_SECOND + sentences * 0.32 + 0.3;
}

export type TimingConstraint = {
  id: string;
  /** What the scene would ideally run for. */
  preferred: number;
  /** Hard floor — legibility, narration, or the system's own minimum. */
  min: number;
  max: number;
  /** Scenes marked rigid keep their duration when the film is scaled. */
  rigid: boolean;
};

/**
 * Scales a set of scenes to hit a target runtime without flattening the edit.
 *
 * A naive implementation multiplies every scene by the same factor, which
 * preserves total length and destroys dynamics — the difference between a 1.2s
 * beat and a 4s hold is the rhythm, and scaling both by 0.8 keeps the ratio but
 * pushes the beat below the threshold where it reads at all.
 *
 * So floors are respected absolutely, rigid scenes are untouched, and the
 * remaining slack is distributed across the scenes with the most room to give.
 */
export function fitToDuration(
  constraints: TimingConstraint[],
  targetSeconds: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const c of constraints) {
    result.set(c.id, clamp(c.preferred, c.min, c.max));
  }

  const total = () => [...result.values()].reduce((sum, d) => sum + d, 0);
  const tolerance = 0.25;

  for (let pass = 0; pass < 24; pass += 1) {
    const current = total();
    const delta = targetSeconds - current;
    if (Math.abs(delta) <= tolerance) break;

    // Who can absorb the change, and by how much.
    const flexible = constraints
      .filter((c) => !c.rigid)
      .map((c) => {
        const now = result.get(c.id)!;
        const room = delta > 0 ? c.max - now : now - c.min;
        return { c, now, room };
      })
      .filter((entry) => entry.room > 0.001);

    if (flexible.length === 0) break;

    const totalRoom = flexible.reduce((sum, entry) => sum + entry.room, 0);
    if (totalRoom <= 0.001) break;

    const move = Math.min(Math.abs(delta), totalRoom) * Math.sign(delta);
    for (const entry of flexible) {
      // Proportional to available room, so a long hold gives up more than a
      // short beat and the dynamics survive.
      const share = (entry.room / totalRoom) * move;
      result.set(entry.c.id, round3(clamp(entry.now + share, entry.c.min, entry.c.max)));
    }
  }

  return result;
}

/**
 * Breaks up monotonous rhythm.
 *
 * Even with correct per-scene timing, a run of similar durations reads as
 * mechanical. This nudges alternating scenes apart so the cut breathes — the
 * same trick an editor applies by feel.
 */
export function varyRhythm(
  durations: Map<string, number>,
  constraints: TimingConstraint[],
  intensity = 0.12,
): Map<string, number> {
  const varied = new Map(durations);
  const order = constraints.filter((c) => !c.rigid);

  for (let i = 1; i < order.length - 1; i += 1) {
    const prev = varied.get(order[i - 1]!.id)!;
    const current = varied.get(order[i]!.id)!;
    const next = varied.get(order[i + 1]!.id)!;

    const similar =
      Math.abs(prev - current) < 0.25 && Math.abs(current - next) < 0.25;
    if (!similar) continue;

    // Alternate: shorten this one, and the surrounding holds feel longer.
    const constraint = order[i]!;
    const direction = i % 2 === 0 ? 1 : -1;
    const adjusted = clamp(current + current * intensity * direction, constraint.min, constraint.max);
    varied.set(constraint.id, round3(adjusted));
  }

  return varied;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Whether a line of copy will physically fit the type treatment.
 *
 * Checked at storyboard time, not at render time: discovering that a headline
 * overflows after paying to render it is how automated video ends up with
 * clipped text.
 */
export function copyFits(
  lines: string[],
  limits: { maxLineLength: number; maxLines: number },
): { fits: boolean; overflowing: string[]; suggestedBreak: string[] } {
  const rewrapped = rewrap(lines, limits.maxLineLength);
  const overflowing = rewrapped.filter((line) => line.length > limits.maxLineLength);
  return {
    fits: overflowing.length === 0 && rewrapped.length <= limits.maxLines,
    overflowing,
    suggestedBreak: rewrapped,
  };
}

/** Greedy line breaking that keeps words intact. */
export function rewrap(lines: string[], maxLineLength: number): string[] {
  const words = lines.join(' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLineLength) {
      current = candidate;
    } else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}
