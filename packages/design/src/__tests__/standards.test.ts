import { describe, it, expect } from 'vitest';
import { BrandSystem as BrandSystemSchema, CONTRAST_AA_NON_TEXT, THIRDS, type BrandSystem } from '@act-one/core';
import { contrastRatio, createFrame, createGrid, neutralRamp, place, resolveTokens, type Placement } from '../index.ts';

/**
 * The standards the design engine claims to hold by construction, held.
 * A "designed in" label on the console is a promise about this package; these
 * are the promises, tried against brands that would break a naive design.
 */
function brand(primaryColor: string): BrandSystem {
  return BrandSystemSchema.parse({
    id: 'brd_1', organizationId: 'org_1', name: 'Test', logo: null, logoVariants: [],
    primaryColor, secondaryColor: primaryColor, accentColors: [], primaryCandidates: [primaryColor],
    neutrals: neutralRamp(primaryColor, 9, 0.05), canvasDark: '#07080d', canvasLight: '#ffffff',
    typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
    cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain.', allowsGlow: false,
    allowsGradient: false, confirmedByUser: true, sources: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('non-text contrast is designed in', () => {
  it('corrects every accent to 3:1 against its canvas, on both canvases', () => {
    // A navy accent on a dark canvas and a pale yellow on a light one are the
    // two ways a brand colour fails to carry a meaningful mark.
    for (const colour of ['#101a3a', '#f4e04d', '#3d7bfd', '#ff2d55', '#7a7a7a']) {
      for (const theme of ['dark', 'light'] as const) {
        const tokens = resolveTokens(brand(colour), { aspect: '16:9', theme });
        expect(
          contrastRatio(tokens.accent, tokens.canvas),
          `${colour} on ${theme}`,
        ).toBeGreaterThanOrEqual(CONTRAST_AA_NON_TEXT - 0.01);
      }
    }
  });
});

describe('the rule of thirds is designed in', () => {
  it('places every block on an anchor — a margin, the centre, or the lower third — never near-centre by accident', () => {
    const grid = createGrid(createFrame('16:9'));
    const content = { width: Math.round(grid.safe.width * 0.5), height: Math.round(grid.safe.height * 0.2) };
    const placements: Placement[] = ['top_left', 'center_left', 'bottom_left', 'center', 'top_center', 'bottom_center', 'lower_third'];

    for (const placement of placements) {
      const box = place(grid, content, placement);
      const centreX = (box.x + box.width / 2 - grid.safe.x) / grid.safe.width;
      const centreY = (box.y + box.height / 2 - grid.safe.y) / grid.safe.height;
      const onLeftMargin = box.x === grid.safe.x;
      const centred = Math.abs(centreX - 0.5) < 0.001;
      expect(onLeftMargin || centred, `${placement} x`).toBe(true);

      const atTop = box.y === grid.safe.y;
      const atBottom = box.y + box.height === grid.safe.y + grid.safe.height;
      const vCentred = Math.abs(centreY - 0.5) < 0.001;
      const nearLowerThird = Math.abs(centreY - THIRDS[1]) < 0.08;
      expect(atTop || atBottom || vCentred || nearLowerThird, `${placement} y`).toBe(true);
      // The accidental near-centre: off-centre by less than a tenth, which
      // reads as a miss. No placement lands there.
      const offCentre = Math.abs(centreY - 0.5);
      expect(offCentre < 0.001 || offCentre > 0.1, `${placement} is near-centre`).toBe(true);
    }
  });
});
