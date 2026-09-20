import { describe, it, expect } from 'vitest';
import {
  MAX_UPSCALE,
  minCropWidth,
  planUiSequence,
  quietCorner,
  type UiRegion,
  type UiStructure,
} from '../domain/ui-cinema.ts';

/**
 * Framing a real interface.
 *
 * The regions below are the ones recovered from an actual product capture —
 * a candidate record in an applicant tracking system: chrome across the top,
 * an identity block under it, a working panel on the right where an email is
 * being composed, and a confirmation toast down in the bottom left. The point
 * of pinning them is that these tests fail when the planner stops finding a
 * story in the shape of a screen, which is the only thing it is for.
 */
const ASHBY: UiStructure = {
  width: 2324,
  height: 1224,
  background: { r: 204, g: 204, b: 204 },
  regions: [
    { x: 0.62, y: 0.38, width: 0.34, height: 0.15, weight: 0.097, density: 0.44 },
    { x: 0.6, y: 0.82, width: 0.36, height: 0.17, weight: 0.092, density: 0.34 },
    { x: 0, y: 0, width: 0.44, height: 0.09, weight: 0.091, density: 0.53 },
    { x: 0.64, y: 0.61, width: 0.3, height: 0.12, weight: 0.078, density: 0.47 },
    { x: 0.17, y: 0.51, width: 0.23, height: 0.18, weight: 0.068, density: 0.39 },
    { x: 0.59, y: 0, width: 0.39, height: 0.07, weight: 0.068, density: 0.54 },
    { x: 0, y: 0.79, width: 0.25, height: 0.09, weight: 0.051, density: 0.48 },
    { x: 0.01, y: 0.09, width: 0.25, height: 0.09, weight: 0.042, density: 0.43 },
    { x: 0.01, y: 0.29, width: 0.13, height: 0.15, weight: 0.036, density: 0.42 },
  ],
};

const OPTIONS = { seconds: 7, frameAspect: 16 / 9, renderWidth: 1920, hasWords: true } as const;

describe('planning a sequence out of one capture', () => {
  it('cuts a screen into an establish, a subject, the work and the result', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    expect(plan.framings.map((framing) => framing.role)).toEqual([
      'establish',
      'subject',
      'action',
      'result',
    ]);
  });

  it('frames the subject on the identity block and the result on the toast', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    const subject = plan.framings.find((framing) => framing.role === 'subject')!;
    const result = plan.framings.find((framing) => framing.role === 'result')!;
    // The identity block, not the busiest panel: what the screen is about
    // sits above the work, and picking by weight alone finds the work twice.
    expect(subject.around).toMatchObject({ x: 0.01, y: 0.09 });
    expect(result.around).toMatchObject({ x: 0, y: 0.79 });
  });

  it('holds every framing inside the capture', () => {
    for (const framing of planUiSequence(ASHBY, OPTIONS).framings) {
      for (const rect of [framing.from, framing.to]) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1.0001);
        expect(rect.y + rect.height).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('never crops tighter than the capture can be blown up to', () => {
    const floor = minCropWidth(ASHBY.width, OPTIONS.renderWidth);
    for (const framing of planUiSequence(ASHBY, OPTIONS).framings) {
      expect(framing.to.width).toBeGreaterThanOrEqual(floor - 0.001);
      expect(framing.from.width).toBeGreaterThanOrEqual(floor - 0.001);
      // Stated the other way round, because this is the promise that matters:
      // nothing on screen is a bigger blow-up than the budget allows.
      expect((OPTIONS.renderWidth / (framing.to.width * ASHBY.width))).toBeLessThanOrEqual(MAX_UPSCALE + 0.01);
    }
  });

  it('keeps each crop at the frame it will be shown in', () => {
    for (const framing of planUiSequence(ASHBY, OPTIONS).framings) {
      const pixels = (framing.to.width * ASHBY.width) / (framing.to.height * ASHBY.height);
      expect(pixels).toBeCloseTo(16 / 9, 1);
    }
  });

  it('makes a push a push, and never drifts the establishing frame', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    const establish = plan.framings[0]!;
    // A frame that moves four per cent is not moving: it is a template that
    // zooms everything because it has no reason to do anything in particular.
    expect(establish.from).toEqual(establish.to);
    for (const framing of plan.framings.filter((candidate) => candidate.move === 'push')) {
      expect(framing.from.width / framing.to.width).toBeGreaterThan(1.2);
    }
  });

  it('travels between panels of the same size rather than cutting', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    const lateral = plan.framings.find((framing) => framing.move === 'lateral');
    expect(lateral).toBeDefined();
    expect(lateral!.cut).toBe(false);
    // A travel starts exactly where the shot before it ended, or it is a cut
    // with a camera move stapled to the front of it.
    const previous = plan.framings[plan.framings.indexOf(lateral!) - 1]!;
    expect(lateral!.from).toEqual(previous.to);
  });

  it('lifts the result off the interface and nothing else', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    for (const framing of plan.framings) {
      if (framing.role === 'result') expect(framing.lift).not.toBeNull();
      else expect(framing.lift).toBeNull();
    }
  });

  it('gives a short shot fewer beats rather than the same beats faster', () => {
    const short = planUiSequence(ASHBY, { ...OPTIONS, seconds: 3 });
    const long = planUiSequence(ASHBY, OPTIONS);
    expect(short.framings.length).toBeLessThan(long.framings.length);
    for (const framing of short.framings) expect(framing.seconds).toBeGreaterThanOrEqual(0.6);
  });

  it('fills the shot, whatever the beat count', () => {
    for (const seconds of [2.5, 4, 7, 11]) {
      const plan = planUiSequence(ASHBY, { ...OPTIONS, seconds });
      const total = plan.framings.reduce((sum, framing) => sum + framing.seconds, 0);
      expect(total).toBeGreaterThan(seconds * 0.8);
      expect(total).toBeLessThanOrEqual(seconds + 0.01);
    }
  });

  it('sets the words once, in the quiet part of the frame', () => {
    const plan = planUiSequence(ASHBY, OPTIONS);
    expect(plan.framings.filter((framing) => framing.words !== 'none')).toHaveLength(1);
    expect(planUiSequence(ASHBY, { ...OPTIONS, hasWords: false }).framings.every((f) => f.words === 'none')).toBe(true);
  });
});

describe('when the capture cannot carry the sequence', () => {
  const small: UiStructure = { ...ASHBY, width: 900, height: 474 };

  it('widens to whatever the capture actually offers', () => {
    const wanted = minCropWidth(small.width, 1920);
    expect(wanted).toBeGreaterThan(0.9);
    const plan = planUiSequence(small, OPTIONS);
    // The whole capture at 16:9 is the widest shot there is; nothing may be
    // tighter than that, and on this capture that is every framing.
    const widest = Math.max(...plan.framings.map((framing) => framing.to.width));
    for (const framing of plan.framings) {
      expect(framing.to.width).toBeCloseTo(widest, 3);
    }
  });

  it('admits when no framing of it can look sharp', () => {
    expect(planUiSequence(small, OPTIONS).notes.join(' ')).toMatch(/blow-up: no framing of it will look sharp/);
  });

  it('says so, instead of letting a wide shot look like a decision', () => {
    /*
     * The invariant this whole module is written around. A plan that had to
     * stay wide because the capture is small is a production limit. Left
     * unsaid it comes back later as "the film apparently wanted a wide shot",
     * and nobody can tell the two apart from the frames.
     */
    const plan = planUiSequence(small, OPTIONS);
    expect(plan.notes.join(' ')).toMatch(/900px across/);
    expect(plan.notes.join(' ')).toMatch(/stays wide|repetition/);
  });

  it('still returns a shot when there are no panels at all', () => {
    const blank: UiStructure = { ...ASHBY, regions: [] };
    const plan = planUiSequence(blank, OPTIONS);
    expect(plan.framings).toHaveLength(1);
    expect(plan.framings[0]!.seconds).toBeCloseTo(OPTIONS.seconds, 5);
    expect(plan.notes.join(' ')).toMatch(/no panels were recoverable/);
  });
});

describe('where the words can go', () => {
  it('picks the corner the interface left empty', () => {
    const structure: UiStructure = {
      width: 2000,
      height: 1125,
      background: { r: 255, g: 255, b: 255 },
      regions: [
        { x: 0, y: 0, width: 0.5, height: 0.5, weight: 0.4, density: 0.6 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5, weight: 0.4, density: 0.6 },
        { x: 0, y: 0.5, width: 0.5, height: 0.5, weight: 0.2, density: 0.5 },
      ] satisfies UiRegion[],
    };
    expect(quietCorner(structure, { x: 0, y: 0, width: 1, height: 1 })).toBe('bottom_right');
  });
});
