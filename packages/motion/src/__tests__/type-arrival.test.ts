import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TYPE_ENTRY_SECONDS, TYPE_LINE_STAGGER_SECONDS, typeArrivalFor } from '@act-one/core';

/**
 * How long type takes to arrive, according to the thing that draws it.
 *
 * The planner, the hold check and the Creative Director all need one number:
 * the moment animated copy is stable enough to read. It was a constant set to
 * 0.45s, and the renderer's `WordReveal` takes 0.72s with each line after the
 * first starting 0.06s later — so every beat the planner wrote was short on
 * content by about the length of the animation, and on a three-line beat by
 * half a second.
 *
 * What that cost: the Creative Director, asked to rewrite a beat so it earns
 * its eight seconds, proposed copy measuring 7.8s against a ceiling it could
 * not see, every option was refused, and the production escalated to a person
 * over arithmetic rather than over anything creative.
 *
 * So core states the numbers and this reads them back off the component. A
 * lint rather than a unit test, for the same reason the camera one is: the
 * rule is about the animation somebody tunes next year.
 */
const TYPE = path.resolve(import.meta.dirname, '../components/Type.tsx');

async function wordRevealTiming(): Promise<{ duration: number; stagger: number }> {
  const source = await readFile(TYPE, 'utf8');
  const start = source.indexOf('export const WordReveal');
  expect(start, 'WordReveal is no longer where this test looks for it').toBeGreaterThan(-1);
  // The first `staggered({...})` call inside the component is the line reveal.
  const body = source.slice(start, start + 2000);
  const duration = /durationSeconds:\s*([0-9.]+)/.exec(body)?.[1];
  const stagger = /staggerSeconds:\s*props\.staggerSeconds\s*\?\?\s*([0-9.]+)/.exec(body)?.[1];
  expect(duration, 'no reveal duration found in WordReveal').toBeDefined();
  expect(stagger, 'no line stagger found in WordReveal').toBeDefined();
  return { duration: Number(duration), stagger: Number(stagger) };
}

describe('the planner and the renderer agree about when type is readable', () => {
  it('reads the reveal timing off the component', async () => {
    const timing = await wordRevealTiming();
    expect(timing.duration).toBeGreaterThan(0);
    expect(timing.stagger).toBeGreaterThan(0);
  });

  it('matches TYPE_ENTRY_SECONDS and TYPE_LINE_STAGGER_SECONDS exactly', async () => {
    const timing = await wordRevealTiming();
    expect(timing.duration).toBe(TYPE_ENTRY_SECONDS);
    expect(timing.stagger).toBe(TYPE_LINE_STAGGER_SECONDS);
  });

  it('accounts for every line after the first', () => {
    expect(typeArrivalFor(1)).toBeCloseTo(0.72, 5);
    expect(typeArrivalFor(3)).toBeCloseTo(0.84, 5);
    // A block with no lines still has to arrive.
    expect(typeArrivalFor(0)).toBeCloseTo(0.72, 5);
  });
});
