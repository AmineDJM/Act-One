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
  TITLE_SAFE_INSET,
  VERTICAL_CHROME_BOTTOM,
  resequence,
  type BrandSystem,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * Captions, in the picture.
 *
 * A vertical cut is watched muted in a feed, so its captions are burned in
 * rather than offered as a track. That is a claim about pixels, and the only
 * way to check a claim about pixels is to look at them: this renders a
 * vertical film with one cue in the middle of it, then reads the frames.
 *
 * The canvas is light on purpose. The caption carries its own dark plate —
 * which is the whole point of the contrast rule — so against white it is
 * unmistakable, and its absence is too.
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

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'visualType' | 'purpose'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 3, narration: '', onScreenText: [],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0.04, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.02, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null,
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

/** The darkest pixel in each row, and how many rows carry a plate's worth of dark. */
async function darkRows(framePath: string, from: number, to: number, left: number, right: number) {
  const image = sharp(framePath);
  const { width = 0, height = 0 } = await image.metadata();
  const raw = await image.raw().toBuffer();
  const channels = raw.length / (width * height);
  const rows: number[] = [];
  for (let y = Math.round(height * from); y < Math.round(height * to); y += 1) {
    let dark = 0;
    for (let x = Math.round(width * left); x < Math.round(width * right); x += 1) {
      const i = (y * width + x) * channels;
      const luminance = (raw[i]! * 0.2126 + raw[i + 1]! * 0.7152 + raw[i + 2]! * 0.0722) / 255;
      if (luminance < 0.35) dark += 1;
    }
    rows.push(dark);
  }
  return { rows, width, height };
}

describe.skipIf(browser === undefined)('captions burned into a vertical cut', () => {
  it('is on screen for its cue, gone between cues, and inside the safe area', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-captions-'));
    const storyboard: Storyboard = resequence({
      id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      scenes: [scene({ id: 'open', visualType: 'kinetic_typography', purpose: 'Open', onScreenText: ['Forty unmatched rows.'] })],
      voiceStrategy: 'narrator', heroShot: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
      language: 'en',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const outputPath = path.join(dir, 'captioned.mp4');
    await renderFilm({
      props: {
        storyboard,
        brand,
        assetUrls: {},
        watermarkLabel: null,
        cta: 'northwind.example',
        tagline: '',
        theme: 'light',
        captions: [
          {
            start: 0.5,
            end: 1.6,
            text: 'Four systems, one ledger',
            lines: ['Four systems,', 'one ledger'],
            emphasis: null,
          },
        ],
      },
      aspect: '9:16',
      quality: 'preview',
      fps: 15,
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
    });

    // The band the caption occupies: just above the platform furniture margin.
    const top = 1 - VERTICAL_CHROME_BOTTOM - 0.14;
    const bottom = 1 - VERTICAL_CHROME_BOTTOM + 0.005;

    const during = path.join(dir, 'during.png');
    expect((await runFfmpeg(posterArgs(outputPath, 1.1, during))).ok).toBe(true);
    const shown = await darkRows(during, top, bottom, 0, 1);
    const plate = shown.rows.filter((count) => count > shown.width * 0.15).length;
    expect(plate, 'no caption plate in the band it should occupy').toBeGreaterThan(8);

    const between = path.join(dir, 'between.png');
    expect((await runFfmpeg(posterArgs(outputPath, 2.4, between))).ok).toBe(true);
    const clear = await darkRows(between, top, bottom, 0, 1);
    expect(
      clear.rows.filter((count) => count > clear.width * 0.15).length,
      'the caption is still on screen after its cue ended',
    ).toBe(0);

    /*
     * EBU R 95, checked rather than asserted.
     *
     * The margins are in the component, so a regression that widened the
     * caption would still look fine in isolation. This reads the frame's own
     * edge strips: nothing the caption drew may be inside the 5% inset.
     */
    const leftStrip = await darkRows(during, top, bottom, 0, TITLE_SAFE_INSET);
    const rightStrip = await darkRows(during, top, bottom, 1 - TITLE_SAFE_INSET, 1);
    expect(Math.max(...leftStrip.rows), 'a caption crossed the left title-safe margin').toBe(0);
    expect(Math.max(...rightStrip.rows), 'a caption crossed the right title-safe margin').toBe(0);

    /*
     * And below it: the bottom of a vertical frame belongs to the platform —
     * the caption block, the handle, the action rail — so nothing of ours goes
     * there.
     */
    const furniture = await darkRows(during, 1 - VERTICAL_CHROME_BOTTOM + 0.01, 1, 0, 1);
    expect(Math.max(...furniture.rows), 'a caption sat under the platform chrome').toBe(0);
  }, 240_000);

  it('draws nothing at all when a film has no captions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-captions-none-'));
    const storyboard: Storyboard = resequence({
      id: 'sbd_2', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      scenes: [scene({ id: 'open', visualType: 'kinetic_typography', purpose: 'Open', onScreenText: ['Forty unmatched rows.'] })],
      voiceStrategy: 'none', heroShot: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
      language: 'en',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const outputPath = path.join(dir, 'plain.mp4');
    await renderFilm({
      props: { storyboard, brand, assetUrls: {}, watermarkLabel: null, cta: 'northwind.example', tagline: '', theme: 'light' },
      aspect: '9:16',
      quality: 'preview',
      fps: 15,
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
    });

    const frame = path.join(dir, 'frame.png');
    expect((await runFfmpeg(posterArgs(outputPath, 1.1, frame))).ok).toBe(true);
    const band = await darkRows(frame, 1 - VERTICAL_CHROME_BOTTOM - 0.14, 1 - VERTICAL_CHROME_BOTTOM, 0, 1);
    expect(band.rows.filter((count) => count > band.width * 0.15).length).toBe(0);
  }, 240_000);
});
