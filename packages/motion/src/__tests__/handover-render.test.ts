import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { neutralRamp } from '@act-one/design';
import {
  BrandSystem as BrandSystemSchema,
  Scene,
  Storyboard,
  type BrandSystem,
  type HandoverPlan,
} from '@act-one/core';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * Two beats on screen at once, in a real file.
 *
 * The claim being checked is not that a transition looks nice. It is that the
 * composition can now do something it previously could not do at all: hold
 * material from one beat while the next one is already there. Before the
 * overlapping windows, every scene's frame range ended where the next began,
 * so there was no instant at which both existed — and no amount of direction
 * could produce a transformation out of that.
 *
 * So this renders the same two beats twice, once joined by a cut and once by
 * a carry, and looks at the frame on the boundary. Under a cut the frame
 * belongs entirely to the second beat. Under a carry it must contain both.
 */
const browser =
  resolveBrowserExecutable() ??
  (existsSync(fileURLToPath(new URL('../../../../node_modules/.remotion', import.meta.url))) ? '' : undefined);

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#3d7bfd', secondaryColor: '#9ab8ff', accentColors: [], primaryCandidates: ['#3d7bfd'],
  neutrals: neutralRamp('#3d7bfd', 9, 0.05), canvasDark: '#07080d', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function scene(index: number, text: string): Scene {
  return Scene.parse({
    id: `scn_${index}`, storyboardId: 'sbd_1', index,
    startTime: index * 3, duration: 3,
    purpose: `beat ${index + 1}`, visualType: 'kinetic_typography',
    motionRecipe: { name: 'kinetic_headline' }, cameraRecipe: {},
    onScreenText: [text], narration: '', assetRefs: [], generativeNeeds: [],
    status: 'ready', notes: '',
  });
}

function board(handovers: Record<string, HandoverPlan>): Storyboard {
  return Storyboard.parse({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1',
    version: 1, handovers, language: 'en',
    scenes: [scene(0, 'Forty unmatched rows.'), scene(1, 'Then none.')],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

/** How much ink the frame carries, as a share of its pixels. */
async function ink(framePath: string): Promise<number> {
  const { data, info } = await sharp(framePath).resize(160, 90, { fit: 'fill' }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  let lit = 0;
  for (let i = 0; i < data.length; i += 1) if (data[i]! > 40) lit += 1;
  return lit / (info.width * info.height);
}

describe.skipIf(browser === undefined)('a beat leaving while the next arrives', () => {
  it('puts both on screen at the join, and only one there under a cut', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-handover-'));
    const render = async (name: string, handovers: Record<string, HandoverPlan>) => {
      const outputPath = path.join(dir, `${name}.mp4`);
      await renderFilm({
        props: {
          storyboard: board(handovers), brand, assetUrls: {}, watermarkLabel: null,
          cta: 'northwind.example', tagline: 'Close the books.', theme: 'dark',
        },
        aspect: '16:9', quality: 'preview', fps: 15, outputPath,
        ...(browser ? { browserExecutable: browser } : {}),
      });
      return outputPath;
    };

    const cut = await render('cut', {});
    const carried = await render('carried', {
      scn_0: { kind: 'camera_carry', seconds: 1, anchor: null, reason: 'the move continues' },
    });

    /*
     * Half a second before the second beat starts. Under a cut this instant
     * belongs entirely to the first beat and the second has not been mounted;
     * under a carry the second is already arriving while the first is still
     * leaving, so the frame carries more than either beat holds alone.
     */
    const at = 2.5;
    const cutFrame = path.join(dir, 'cut.png');
    const carriedFrame = path.join(dir, 'carried.png');
    expect((await runFfmpeg(posterArgs(cut, at, cutFrame))).ok).toBe(true);
    expect((await runFfmpeg(posterArgs(carried, at, carriedFrame))).ok).toBe(true);

    /*
     * And the second beat alone, taken from the middle of its own run under
     * the cut, where nothing else is on screen.
     *
     * The assertion is then the unambiguous one rather than a tuned margin:
     * at the join, the carried film holds MORE than either beat holds by
     * itself. Only two beats being present can produce that.
     */
    const aloneFrame = path.join(dir, 'alone.png');
    expect((await runFfmpeg(posterArgs(cut, 4.5, aloneFrame))).ok).toBe(true);

    const [plain, joined, alone] = await Promise.all([
      ink(cutFrame), ink(carriedFrame), ink(aloneFrame),
    ]);
    const where = `first ${plain.toFixed(4)}, second ${alone.toFixed(4)}, join ${joined.toFixed(4)}`;
    expect(plain).toBeGreaterThan(0);
    expect(alone).toBeGreaterThan(0);
    expect(joined, where).toBeGreaterThan(plain);
    expect(joined, where).toBeGreaterThan(alone);

    /*
     * And each beat keeps to its own clock through the join. The first is
     * carried out by the join rather than faded before it begins, so just
     * after the second beat starts both are still on screen; the second,
     * mounted a second early to arrive, holds until its own end rather than
     * clearing a second before the film does.
     */
    const leavingFrame = path.join(dir, 'leaving.png');
    const lateFrame = path.join(dir, 'late.png');
    expect((await runFfmpeg(posterArgs(carried, 3.2, leavingFrame))).ok).toBe(true);
    expect((await runFfmpeg(posterArgs(carried, 5.6, lateFrame))).ok).toBe(true);
    const [leaving, late] = await Promise.all([ink(leavingFrame), ink(lateFrame)]);
    expect(leaving, `leaving ${leaving.toFixed(4)}, ${where}`).toBeGreaterThan(alone);
    expect(late, `late ${late.toFixed(4)}, ${where}`).toBeGreaterThan(alone * 0.8);

    // And the film is not made longer by the overlap: the editorial clock
    // still decides the runtime, which is what every QA measurement keys off.
    const { readContainer } = await import('@act-one/qa');
    const facts = await readContainer(carried);
    expect(facts.durationSeconds).toBeCloseTo(6, 1);
  }, 240_000);
});
