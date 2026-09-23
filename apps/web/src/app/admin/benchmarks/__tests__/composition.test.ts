import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileFilmIR, ForensicReport } from '@act-one/film-ir';
import { composeWindow } from '../[id]/composition.ts';

/**
 * A window of film told as a composition, on the synthetic film whose every
 * fact was placed by construction: "LAUNCH DAY" on a blue field, a hard cut
 * from frame 39 to 40 with a click on it, "NEW FEATURE" fading in over
 * frames 50–59 on orange, "Deploy in minutes" cutting in at 65, a fade to
 * black over frames 80–89, and a hard cut to "SEARCH" at frame 100.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const report = ForensicReport.parse(JSON.parse(readFileSync(path.join(here, '../../../../../../../packages/film-ir/src/__tests__/fixtures/synthetic-report.json'), 'utf8')));
const { document } = compileFilmIR({ id: 'bench_synthetic', title: 'synthetic', report, createdAt: '2026-09-23T00:00:00.000Z' });

describe('composeWindow', () => {
  it('tells a cut to the frame, what it takes away, and what enters on its own', () => {
    const story = composeWindow(document, 1.4, 2.6);
    expect(story).toContainEqual(expect.stringMatching(/^boundary\.001: a hard_cut \(measured\) — frame 39 is the last untouched, frame 40 the first complete; luma/));
    expect(story).toContain('1 line(s) of type leave with boundary.001: text.0001 “LAUNCH DAY”.');
    expect(story).toContain('text.0002 “NEW FEATURE”: firstVisible 0:02.000, p50 0:02.200, settled 0:02.400; enters over 400 ms.');
    expect(story).toContainEqual(expect.stringMatching(/^Heard: onset at 0:01\.(599|600), .*onset at 0:01\.(999|2000)/));
    // Measured facts first, in the order of the picture; nothing here was inferred, so nothing says it was.
    expect(story.findIndex((line) => line.startsWith('boundary.'))).toBeLessThan(story.findIndex((line) => line.startsWith('Heard:')));
    expect(story.some((line) => line.includes('inferred'))).toBe(false);
  });

  it('counts the mixed frames of a fade, and the type that goes with it', () => {
    const story = composeWindow(document, 3.0, 4.0);
    expect(story).toContainEqual(expect.stringMatching(/^boundary\.002: a fade_out \(measured\) — frame 79 is the last untouched, frame 90 the first complete, 10 mixed frame\(s\) between; luma 0\.\d+ → 0\.000\./));
    expect(story).toContain('2 line(s) of type leave with boundary.002: text.0002 “NEW FEATURE”, text.0003 “Deploy in minutes”.');
  });

  it('tells type that arrives with a cut apart from type that holds', () => {
    const story = composeWindow(document, 3.9, 4.2);
    expect(story).toContainEqual(expect.stringMatching(/^boundary\.003: a hard_cut \(measured\) — frame 99 is the last untouched, frame 100 the first complete; luma 0\.000 → 0\.\d+\./));
    expect(story).toContain('1 line(s) of type arrive with boundary.003: text.0004 “SEARCH”.');
    expect(composeWindow(document, 2.5, 2.7)).toContain('1 line(s) hold throughout: text.0002 “NEW FEATURE”.');
  });

  it('says that type holds, rather than listing it, where nothing changes', () => {
    const story = composeWindow(document, 0.2, 0.6);
    expect(story).toContain('1 line(s) hold throughout: text.0001 “LAUNCH DAY”.');
    expect(story.some((line) => line.startsWith('boundary.'))).toBe(false);
  });
});
