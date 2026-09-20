import { describe, it, expect } from 'vitest';
import { Scene, Storyboard, filmShape, repairRegression, type CreativeProblem } from '../index.ts';

/**
 * A repair may not make worse the exact thing it was sent to fix.
 *
 * The run that produced this: the Director wrote "product arrives too late,
 * insufficient product imagery, wrong images", the replan proposed a change
 * of visual concept, the arithmetic accepted it, and the film came back with
 * picture coverage down from 31% to 24% and one shot holding nothing at all.
 * Every layer reported success. The film got worse at the one thing the note
 * named, and nothing in the system was looking.
 */
function scene(index: number, over: Record<string, unknown> = {}): Scene {
  return Scene.parse({
    id: `scn_${index}`,
    storyboardId: 'sbd_1',
    index,
    startTime: index * 2,
    duration: 2,
    purpose: 'a beat',
    visualType: 'kinetic_typography',
    motionRecipe: { name: 'word_reveal' },
    cameraRecipe: {},
    onScreenText: ['Something'],
    narration: '',
    assetRefs: [],
    generativeNeeds: [],
    status: 'ready',
    notes: '',
    ...over,
  });
}

function board(scenes: Scene[]): Storyboard {
  return Storyboard.parse({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1',
    version: 1, scenes, language: 'en',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const product = (index: number) => scene(index, { visualType: 'product_ui', assetRefs: ['ast_1'] });

describe('the measurable shape of a cut', () => {
  it('reads when the product first appears and how much of it there is', () => {
    const shape = filmShape(board([scene(0), scene(1), product(2), product(3)]));
    expect(shape.firstProductSeconds).toBe(4);
    expect(shape.productShare).toBeCloseTo(0.5, 3);
    expect(shape.pictureShare).toBeCloseTo(0.5, 3);
    expect(shape.typographyShare).toBeCloseTo(0.5, 3);
  });

  it('says a film never shows the product rather than guessing a time', () => {
    expect(filmShape(board([scene(0), scene(1)])).firstProductSeconds).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts a shot that asks for material it does not hold', () => {
    const empty = scene(0, { visualType: 'product_ui' });
    expect(filmShape(board([empty, scene(1)])).unresolved).toBe(1);
  });

  it('sees a run of title cards for what it is', () => {
    // Four typographic shots in a row is the shape a viewer reads as slides.
    expect(filmShape(board([scene(0), scene(1), scene(2), scene(3)])).longestRepeat).toBe(4);
    expect(filmShape(board([scene(0), product(1), scene(2), product(3)])).longestRepeat).toBe(1);
  });
});

describe('a repair that undoes its own instructions', () => {
  const late: CreativeProblem[] = ['too_late_product'];
  const thin: CreativeProblem[] = ['insufficient_product'];

  it('refuses a repair for a late product that makes it later', () => {
    const before = filmShape(board([scene(0), product(1), scene(2), scene(3)]));
    const after = filmShape(board([scene(0), scene(1), scene(2), product(3)]));
    expect(repairRegression(late, before, after)).toMatch(/arrives even later: 2\.0s → 6\.0s/);
  });

  it('takes a repair for a late product that brings it forward', () => {
    const before = filmShape(board([scene(0), scene(1), scene(2), product(3)]));
    const after = filmShape(board([scene(0), product(1), scene(2), scene(3)]));
    expect(repairRegression(late, before, after)).toBeNull();
  });

  it('refuses a repair for thin product that removes some', () => {
    // The real one: 31% to 24%, accepted, nothing noticed.
    const before = filmShape(board([scene(0), product(1), product(2), scene(3)]));
    const after = filmShape(board([scene(0), product(1), scene(2), scene(3)]));
    expect(repairRegression(thin, before, after)).toMatch(/less product on screen: 50% → 25%/);
  });

  it('refuses a repair that makes the product vanish entirely', () => {
    const before = filmShape(board([scene(0), product(1)]));
    const after = filmShape(board([scene(0), scene(1)]));
    expect(repairRegression(late, before, after)).toMatch(/stops appearing at all/);
  });

  it('refuses any repair that leaves a shot with nothing to show', () => {
    /*
     * No note has to name this one. A shot asking for material it does not
     * hold is not a trade-off, it is a hole, and the run that prompted all of
     * this came back with exactly one.
     */
    const before = filmShape(board([scene(0), product(1)]));
    const after = filmShape(board([scene(0), scene(1, { visualType: 'product_ui' })]));
    expect(repairRegression(['too_generic'], before, after)).toMatch(/no material to show/);
  });

  it('says nothing about a cost the note did not ask about', () => {
    // Fewer distinct shots is a price a director may decide to pay. Taste
    // settles that, not arithmetic.
    const before = filmShape(board([scene(0), product(1), scene(2, { visualType: 'quote' })]));
    const after = filmShape(board([scene(0), product(1), scene(2)]));
    expect(repairRegression(late, before, after)).toBeNull();
  });
});
