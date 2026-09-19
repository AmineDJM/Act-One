import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { neutralRamp } from '@act-one/design';
import { BrandSystem as BrandSystemSchema, resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { readContainer } from '@act-one/qa';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * Every visual type the film can draw without a vendor, drawn.
 *
 * Ninety-five scenes had been rendered across every project and three visual
 * types had ever appeared in one. The other deterministic types — a quote, a
 * transition, a product window, a zoom — were code that had never produced a
 * frame. This renders one scene of each, at preview size, and looks at the
 * frames: not for taste, for the one thing a test can decide, which is that
 * each scene put something on screen.
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

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'visualType' | 'purpose'> & { recipe: Scene['motionRecipe']['name'] }): Scene {
  const { recipe, ...rest } = over;
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 1.2, narration: '', onScreenText: [],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: recipe, easing: 'out_quint', delay: 0, stagger: 0.04, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.04, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...rest,
  };
}

/** A convincing interface: toolbar, sidebar, rows. Real pixels, not a fake product — a test fixture. */
async function interfacePng(): Promise<string> {
  const width = 1200;
  const height = 750;
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const bar = y < 44;
      const side = x < 220 && !bar;
      const row = !bar && !side && y % 40 > 14 && y % 40 < 24 && x > 260 && x < 260 + ((y * 13) % 700);
      const [r, g, b] = bar ? [24, 26, 32] : side ? [244, 245, 247] : row ? [40, 42, 48] : [255, 255, 255];
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
  const png = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe.skipIf(browser === undefined)('every deterministic visual type', () => {
  it('puts something on screen', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-types-'));
    const storyboard: Storyboard = resequence({
      id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      scenes: [
        scene({ id: 'type', visualType: 'kinetic_typography', purpose: 'Open', onScreenText: ['Forty unmatched rows.'], recipe: 'kinetic_headline' }),
        scene({ id: 'stat', visualType: 'statistic', purpose: 'Proof', onScreenText: ['0', 'unmatched rows remaining'], recipe: 'metric_reveal' }),
        scene({ id: 'quote', visualType: 'quote', purpose: 'Voice', onScreenText: ['It just closed.', 'Head of Finance, fictional'], recipe: 'quote_hold' }),
        scene({ id: 'transition', visualType: 'transition', purpose: 'Break', onScreenText: ['And then.'], recipe: 'depth_transition' }),
        scene({ id: 'product', visualType: 'product_ui', purpose: 'Show', onScreenText: [], assetRefs: ['ast_ui'], recipe: 'product_window' }),
        scene({ id: 'zoom', visualType: 'screenshot_motion', purpose: 'Point', onScreenText: [], assetRefs: ['ast_ui'], recipe: 'product_zoom' }),
        scene({ id: 'end', visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['Close the books.'], recipe: 'cta_end_card' }),
      ],
      voiceStrategy: 'none', musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
      language: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const outputPath = path.join(dir, 'types.mp4');
    await renderFilm({
      props: {
        storyboard,
        brand,
        assetUrls: { ast_ui: await interfacePng() },
        watermarkLabel: null,
        cta: 'northwind.example',
        tagline: 'Close the books while you sleep.',
        theme: 'dark',
      },
      aspect: '16:9',
      quality: 'preview',
      fps: 15,
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
    });

    // The picture as the renderer wrote it. Colour tags and the index come
    // from the mux, which is the render stage's job and is checked there.
    const facts = await readContainer(outputPath);
    expect(facts.video).toMatchObject({ codec: 'avc1', width: 960, height: 540, chromaFormat: 1, bitDepth: 8 });
    expect(facts.video!.sampleCount).toBe(Math.round(storyboard.scenes.length * 1.2 * 15));

    for (const current of storyboard.scenes) {
      const framePath = path.join(dir, `${current.id}.png`);
      const extracted = await runFfmpeg(posterArgs(outputPath, current.startTime + current.duration * 0.6, framePath));
      expect(extracted.ok, `${current.id}: ${extracted.stderr.slice(-200)}`).toBe(true);
      const stats = await sharp(framePath).stats();
      const spread = Math.max(...stats.channels.map((channel) => channel.stdev));
      // A flat frame — the canvas and nothing else — has no spread at all.
      expect(spread, `${current.visualType} rendered a blank frame`).toBeGreaterThan(6);
    }
  }, 240_000);
});
