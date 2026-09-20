import { describe, it, expect } from 'vitest';
import { versionFor } from '../stages/render.ts';

/**
 * What number a render carries.
 *
 * "Version 3" has to mean the customer's third film everywhere it appears, so
 * only films take a new number and everything else rides the one belonging to
 * the film it came from.
 *
 * The floor is the part that was wrong. An animatic is made before any film
 * exists — that is its whole purpose — and the arithmetic handed it version 0,
 * which the schema has forbidden since it was written. Nothing caught it
 * because the store accepted a whole `Render` without ever parsing one.
 */
describe('what number a render carries', () => {
  it('gives each film the next number', () => {
    expect(versionFor('film', 0)).toBe(1);
    expect(versionFor('film', 2)).toBe(3);
  });

  it('has a cut ride the film it was cut from', () => {
    expect(versionFor('cut', 3)).toBe(3);
    expect(versionFor('localised', 3)).toBe(3);
  });

  it('numbers a preview of a film nobody has made yet as version one', () => {
    expect(versionFor('animatic', 0)).toBe(1);
    expect(versionFor('cut', 0)).toBe(1);
  });

  it('never returns a number the schema refuses', () => {
    for (const kind of ['film', 'cut', 'animatic', 'localised'] as const) {
      for (let made = 0; made < 5; made += 1) {
        expect(versionFor(kind, made)).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(versionFor(kind, made))).toBe(true);
      }
    }
  });
});
