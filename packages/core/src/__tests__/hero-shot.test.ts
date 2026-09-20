import { describe, it, expect } from 'vitest';
import { searchHeroShots, type UiStructure } from '../index.ts';

/**
 * Searching for the one frame.
 *
 * The capture below is a working screen: chrome across the top, a record
 * header, a large panel where the work happens, a narrow rail beside it, and
 * a small confirmation low down. What the search must do with it is prefer
 * the panel and the confirmation — things — over the whole screen, which is
 * not a thing.
 */
const SCREEN: UiStructure = {
  width: 2400,
  height: 1350,
  background: { r: 246, g: 246, b: 248 },
  regions: [
    { x: 0, y: 0, width: 1, height: 0.05, weight: 0.08, density: 0.5 },
    { x: 0.02, y: 0.08, width: 0.3, height: 0.07, weight: 0.1, density: 0.46 },
    { x: 0.36, y: 0.2, width: 0.42, height: 0.44, weight: 0.4, density: 0.52 },
    { x: 0.02, y: 0.22, width: 0.12, height: 0.5, weight: 0.14, density: 0.3 },
    // Two more panel-shaped regions: a summary card and a chart, which is
    // what lets this screen be shown as a space rather than only as a frame.
    { x: 0.8, y: 0.2, width: 0.18, height: 0.22, weight: 0.12, density: 0.42 },
    { x: 0.36, y: 0.68, width: 0.42, height: 0.24, weight: 0.16, density: 0.38 },
    { x: 0.06, y: 0.78, width: 0.2, height: 0.09, weight: 0.08, density: 0.47 },
  ],
  // A filled primary action inside the working panel: the thing that can be
  // pressed, as opposed to the region it sits in.
  controls: [{ x: 0.38, y: 0.56, width: 0.07, height: 0.03, weight: 0.002, density: 1 }],
};

const INPUT = {
  captures: [{ assetId: 'ast_1', structure: SCREEN }],
  frameAspect: 16 / 9,
  renderWidth: 1920,
  seconds: 3.5,
};

describe('the hero shot search', () => {
  it('considers far more frames than it puts forward', () => {
    const search = searchHeroShots(INPUT, 5);
    expect(search.considered).toBeGreaterThan(15);
    expect(search.candidates.length).toBeLessThanOrEqual(5);
  });

  it('is never about the whole screen, however the shot is made', () => {
    /*
     * The failure this pins down is a real one. Weighted toward resolution,
     * the search ranked the widest crop of every capture at the top — the
     * whole screen has the most pixels by definition — and returned six
     * pictures of six screens.
     *
     * A volume does not crop at all, so its rectangle IS the whole capture;
     * what makes it about something is that the panels it hangs in the space
     * are parts. Same requirement, asked of the thing that carries it.
     */
    for (const candidate of searchHeroShots(INPUT, 6).candidates) {
      if (candidate.mechanism === 'volume') {
        for (const layer of candidate.framing.layers) {
          expect(layer.rect.width * layer.rect.height).toBeLessThan(0.5);
        }
        continue;
      }
      expect(candidate.framing.to.width).toBeLessThan(0.75);
    }
    expect(searchHeroShots(INPUT, 5).candidates[0]!.terms.isolation).toBeGreaterThan(0.5);
  });

  it('never puts forward a frame the capture cannot hold', () => {
    for (const candidate of searchHeroShots(INPUT, 8).candidates) {
      const sourcePixels = candidate.framing.to.width * SCREEN.width;
      expect(1920 / sourcePixels).toBeLessThanOrEqual(1.81);
    }
  });

  it('shows different shots rather than one frame at five sizes', () => {
    /*
     * Two candidates that are the same rectangle shot the same way are the
     * same shot. The same rectangle shot a different way is not — a crop and
     * the interface coming apart inside that crop are different things to
     * watch — which is why the mechanism is part of a candidate's identity.
     */
    const candidates = searchHeroShots(INPUT, 5).candidates;
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        if (candidates[i]!.mechanism !== candidates[j]!.mechanism) continue;
        const a = candidates[i]!.framing.to;
        const b = candidates[j]!.framing.to;
        const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        expect((w * h) / smaller).toBeLessThanOrEqual(0.71);
      }
    }
  });

  it('offers different ways of shooting it, not different crops', () => {
    const candidates = searchHeroShots(INPUT, 6).candidates;
    const kinds = new Set(candidates.map((candidate) => candidate.mechanism));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(kinds.has('frame')).toBe(true);
    // This capture has three panel-shaped regions, so it can be a space.
    expect(kinds.has('volume')).toBe(true);
  });

  it('never offers a shot whose parts the capture does not hold', () => {
    // No filled control anywhere, so nothing can be shown being operated.
    const noControls = searchHeroShots(
      { ...INPUT, captures: [{ assetId: 'ast_1', structure: { ...SCREEN, controls: [] } }] },
      8,
    );
    expect(noControls.candidates.some((candidate) => candidate.mechanism === 'operate')).toBe(false);
  });

  it('carries the layers a layered mechanism needs, and a flat one carries none', () => {
    for (const candidate of searchHeroShots(INPUT, 8).candidates) {
      if (candidate.mechanism === 'frame') {
        expect(candidate.framing.layers).toHaveLength(0);
        expect(candidate.framing.space).toBe('flat');
      } else {
        expect(candidate.framing.layers.length).toBeGreaterThan(0);
      }
      if (candidate.mechanism === 'volume') expect(candidate.framing.space).toBe('volume');
    }
  });

  it('only lifts what the interface already puts on top', () => {
    for (const candidate of searchHeroShots(INPUT, 8).candidates) {
      if (!candidate.framing.lift) continue;
      // The confirmation, not the big working panel and not the side rail.
      expect(candidate.framing.lift.height).toBeLessThanOrEqual(0.2);
      expect(candidate.framing.lift.width).toBeLessThanOrEqual(0.55);
    }
  });

  it('avoids a frame the film has already shown', () => {
    const before = searchHeroShots(INPUT, 6).candidates.find((c) => c.mechanism === 'isolate')!;
    const after = searchHeroShots(
      { ...INPUT, taken: [{ assetId: 'ast_1', rect: before.framing.to }] },
      6,
    ).candidates.find((c) => c.mechanism === 'isolate')!;
    expect(after.framing.to).not.toEqual(before.framing.to);
  });

  it('ignores a whole-capture frame when judging what the film has shown', () => {
    /*
     * A shot framed on the entire capture contains every other rectangle, so
     * counted as "already shown" it would rule out the whole search — and a
     * film with one spatial shot in it would be a film that can never have a
     * hero.
     */
    const whole = { assetId: 'ast_1', rect: { x: 0, y: 0, width: 1, height: 1 } };
    expect(searchHeroShots({ ...INPUT, taken: [whole] }, 5).candidates.length).toBeGreaterThan(0);
  });

  it('says why, in terms a person can disagree with', () => {
    const best = searchHeroShots(INPUT, 3).candidates[0]!;
    expect(best.why.length).toBeGreaterThan(0);
    for (const line of best.why) expect(line).toMatch(/\(\w+ \d\.\d\d\)$/);
  });

  it('spreads the shortlist across the captures it was given', () => {
    const search = searchHeroShots(
      { ...INPUT, captures: [
        { assetId: 'ast_1', structure: SCREEN },
        { assetId: 'ast_2', structure: SCREEN },
      ] },
      6,
    );
    // One screenshot with six good panels must not take the whole list and
    // leave the judgement above with nothing to actually choose between.
    expect(new Set(search.candidates.map((candidate) => candidate.assetId)).size).toBe(2);
  });

  it('comes back empty and says so when there is nothing to film', () => {
    const search = searchHeroShots({ ...INPUT, captures: [{ assetId: 'ast_1', structure: { ...SCREEN, regions: [] } }] }, 5);
    expect(search.candidates).toHaveLength(0);
    expect(search.notes.join(' ')).toMatch(/no panel in this capture/);
  });
});
