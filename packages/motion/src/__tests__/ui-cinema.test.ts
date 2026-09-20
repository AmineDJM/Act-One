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
  planUiSequence,
  resequence,
  type BrandSystem,
  type Scene,
  type Storyboard,
  type UiStructure,
} from '@act-one/core';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * The difference between a screenshot and a shot, measured.
 *
 * Two films from exactly the same capture, the same brand, the same seven
 * seconds. One is the staging the system did before — the capture whole,
 * inside a window, on the brand canvas, with the camera recipe's push on it.
 * The other is the same pixels filmed through a framing plan.
 *
 * Neither of the two things this checks is a matter of taste. A picture that
 * fills the frame and a picture that occupies a third of it are different
 * pictures, and eight frames that differ from each other are a sequence while
 * eight that do not are a still.
 */
const browser =
  resolveBrowserExecutable() ??
  (existsSync(fileURLToPath(new URL('../../../../node_modules/.remotion', import.meta.url))) ? '' : undefined);

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#5B45E0', secondaryColor: '#9a8cf0', accentColors: [], primaryCandidates: ['#5B45E0'],
  neutrals: neutralRamp('#5B45E0', 9, 0.05), canvasDark: '#2a0b4e', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const SECONDS = 7;

/** A layout with a header, a record title, a working column and a notice low down. */
async function capturePng(width: number, height: number): Promise<string> {
  const data = Buffer.alloc(width * height * 3, 244);
  const box = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y += 1) {
      for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x += 1) {
        const i = (y * width + x) * 3;
        data[i] = v; data[i + 1] = v; data[i + 2] = v;
      }
    }
  };
  const lines = (x0: number, y0: number, x1: number, y1: number, step: number, v = 38) => {
    for (let t = y0; t < y1; t += step) box(x0, t, x1, t + step * 0.45, v);
  };
  box(0, 0, 1, 0.05, 90);
  lines(0.02, 0.09, 0.3, 0.17, 0.05, 20);
  lines(0.02, 0.28, 0.16, 0.6, 0.035);
  lines(0.42, 0.3, 0.92, 0.72, 0.03);
  lines(0.04, 0.8, 0.24, 0.88, 0.03);
  const png = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

function film(id: string, uiSequence: Scene['uiSequence']): Storyboard {
  return resequence({
    id: `sbd_${id}`, projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes: [
      {
        id: `scn_${id}`, storyboardId: `sbd_${id}`, index: 0, startTime: 0, duration: SECONDS,
        purpose: 'Show the record doing the work', narration: '',
        onScreenText: ['One record. Every step.'],
        visualType: 'product_ui', assetRefs: ['ast_ui'], momentIds: [],
        motionRecipe: { name: 'product_window', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
        cameraRecipe: {
          move: 'slow_push', fromScale: 1, toScale: 1.06, fromX: 0, toX: 0, fromY: 0, toY: 0,
          motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart',
        },
        uiSequence,
        soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
        claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
      } satisfies Scene,
    ],
    voiceStrategy: 'none', heroShot: null, musicDirection: '', parentStoryboardId: null, revisionReason: '',
    status: 'draft', language: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

/** Mean absolute difference between two frames, 0..255. Zero means the same picture. */
async function difference(a: string, b: string): Promise<number> {
  const size = { width: 160, height: 90 };
  const [left, right] = await Promise.all(
    [a, b].map((file) => sharp(file).resize(size).greyscale().raw().toBuffer()),
  );
  let total = 0;
  for (let i = 0; i < left!.length; i += 1) total += Math.abs(left![i]! - right![i]!);
  return total / left!.length;
}

describe.skipIf(browser === undefined)('a capture filmed rather than staged', () => {
  it('fills the frame and changes across the shot, where the staged version does neither', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-uicinema-'));
    const src = await capturePng(2324, 1224);
    const structure: UiStructure = {
      width: 2324,
      height: 1224,
      background: { r: 244, g: 244, b: 244 },
      regions: [
        { x: 0.02, y: 0.09, width: 0.28, height: 0.08, weight: 0.12, density: 0.45 },
        { x: 0.42, y: 0.3, width: 0.5, height: 0.42, weight: 0.42, density: 0.5 },
        { x: 0.02, y: 0.28, width: 0.14, height: 0.32, weight: 0.18, density: 0.4 },
        { x: 0.04, y: 0.8, width: 0.2, height: 0.08, weight: 0.08, density: 0.46 },
      ],
    };
    const sequence = planUiSequence(structure, {
      seconds: SECONDS, frameAspect: 16 / 9, renderWidth: 1920, hasWords: true,
    });
    expect(sequence.framings.length).toBeGreaterThanOrEqual(3);

    const measured: Record<string, { canvasShare: number; motion: number }> = {};
    for (const [name, storyboard] of [
      ['staged', film('staged', null)],
      ['filmed', film('filmed', sequence)],
    ] as const) {
      const outputPath = path.join(dir, `${name}.mp4`);
      await renderFilm({
        props: { storyboard, brand, assetUrls: { ast_ui: src }, watermarkLabel: null, theme: 'dark' },
        aspect: '16:9', quality: 'preview', fps: 15, outputPath,
        ...(browser ? { browserExecutable: browser } : {}),
      });

      const frames: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        const framePath = path.join(dir, `${name}-${index}.png`);
        const at = SECONDS * ((index + 0.5) / 8);
        const extracted = await runFfmpeg(posterArgs(outputPath, at, framePath));
        expect(extracted.ok, `${name} at ${at}s: ${extracted.stderr.slice(-200)}`).toBe(true);
        frames.push(framePath);
      }

      /*
       * How much of the frame's edge is brand colour rather than product.
       *
       * This is the measurable half of "a screenshot on a coloured card": the
       * card is the part of the frame the capture is not in, and on a staged
       * shot that part is the whole border. The brand canvas here is a
       * saturated purple on purpose — it is the exact frame the complaint was
       * about — so it can be told apart from the scrim under the words and
       * from the capture's own chrome, neither of which is a card.
       */
      let ring = 0;
      let edge = 0;
      for (const framePath of frames) {
        const { data, info } = await sharp(framePath).resize({ width: 240 }).removeAlpha().raw()
          .toBuffer({ resolveWithObject: true });
        const band = Math.max(2, Math.round(info.height * 0.03));
        for (let y = 0; y < info.height; y += 1) {
          for (let x = 0; x < info.width; x += 1) {
            const onEdge = y < band || y >= info.height - band || x < band || x >= info.width - band;
            if (!onEdge) continue;
            const i = (y * info.width + x) * info.channels;
            edge += 1;
            if (
              Math.abs(data[i]! - 0x2a) < 26 &&
              Math.abs(data[i + 1]! - 0x0b) < 26 &&
              Math.abs(data[i + 2]! - 0x4e) < 26
            ) {
              ring += 1;
            }
          }
        }
      }

      let motion = 0;
      for (let index = 1; index < frames.length; index += 1) {
        motion = Math.max(motion, await difference(frames[index - 1]!, frames[index]!));
      }
      measured[name] = { canvasShare: ring / Math.max(1, edge), motion };
    }

    // The staged treatment puts the capture in a box, so most of the border
    // is brand colour. The filmed one is full bleed: none of it is.
    expect(measured['staged']!.canvasShare).toBeGreaterThan(0.5);
    expect(measured['filmed']!.canvasShare).toBeLessThan(0.05);

    // And the picture actually changes. A four per cent push over seven
    // seconds moves the frame by about a pixel between samples, which is why
    // the staged film reads as a still with a rendering artefact on it.
    expect(measured['filmed']!.motion).toBeGreaterThan(measured['staged']!.motion * 3);
  }, 300_000);
});
