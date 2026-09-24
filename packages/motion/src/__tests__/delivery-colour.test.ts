import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BrandSystem as BrandSystemSchema, Scene, Storyboard, type BrandSystem } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * The film is in the colours it was drawn in.
 *
 * A photograph of one flat colour, the brand's green, held full frame: read back
 * the way the file says to read it (limited-range BT.709), the middle of the
 * frame is that green. Encoded from JPEG frames, whose YCbCr is BT.601, and
 * labelled BT.709 without converting, it came back as (41, 194, 134).
 */
const browser =
  resolveBrowserExecutable() ??
  (existsSync(fileURLToPath(new URL('../../../../node_modules/.remotion', import.meta.url))) ? '' : undefined);

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Lumen', logo: null, logoVariants: [],
  primaryColor: '#39d98a', secondaryColor: '#9ab8ff', accentColors: [], primaryCandidates: ['#39d98a'],
  neutrals: neutralRamp('#39d98a', 9, 0.05), canvasDark: '#0b0e14', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Calm.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe.skipIf(browser === undefined)('a film delivered by the Remotion engine', () => {
  it('shows a flat brand colour as that colour, read as the file describes it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-colour-'));
    const green = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#39d98a' } }).png().toBuffer();
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': green.length });
      response.end(green);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const storyboard = Storyboard.parse({
        id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1, handovers: {}, language: 'en',
        scenes: [
          Scene.parse({
            id: 'scn_0', storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 2,
            purpose: 'a flat field', visualType: 'real_media', motionRecipe: { name: 'photo_hold' }, cameraRecipe: {},
            onScreenText: [], narration: '', assetRefs: ['ast_green'], generativeNeeds: [], status: 'ready', notes: '',
          }),
        ],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      });
      const outputPath = path.join(dir, 'green.mp4');
      await renderFilm({
        props: { storyboard, brand, assetUrls: { ast_green: `http://127.0.0.1:${port}/green.png` }, watermarkLabel: null, theme: 'dark' },
        aspect: '16:9', quality: 'preview', fps: 15, outputPath,
        ...(browser ? { browserExecutable: browser } : {}),
      });

      const raw = path.join(dir, 'frame.rgb');
      const read = await runFfmpeg(
        ['-y', '-v', 'error', '-ss', '1.5', '-i', outputPath, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-f', 'rawvideo', raw],
        { timeoutMs: 60_000 },
      );
      expect(read.ok, read.stderr).toBe(true);
      const pixels = await readFile(raw);
      const at = (270 * 960 + 480) * 3;
      const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
      const seen = `(${r}, ${g}, ${b})`;
      expect(Math.abs(r - 57), seen).toBeLessThanOrEqual(4);
      expect(Math.abs(g - 217), seen).toBeLessThanOrEqual(4);
      expect(Math.abs(b - 138), seen).toBeLessThanOrEqual(4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 240_000);
});
