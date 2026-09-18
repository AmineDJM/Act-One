import { describe, it, expect, afterAll } from 'vitest';
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stat } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { neutralRamp } from '@act-one/design';
import { BrandSystem as BrandSystemSchema, resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { framesToVideoArgs, posterArgs, runFfmpeg } from '@act-one/sound';
import { renderFilm, resolveBrowserExecutable } from '../render.ts';

/**
 * A generated shot, on the screen.
 *
 * This is the test that did not exist. Generated footage was commissioned,
 * paid for, stored and written onto the scene, and then handed to a component
 * that draws images — so nothing played, the scene fell back to type, and no
 * check anywhere noticed because every frame still had something in it.
 *
 * So the assertion is not "the frame is not blank". It is that the frame
 * carries the colour that only exists inside the clip.
 *
 * The clip is served over HTTP rather than handed over as a path, because that
 * is what the renderer is given in production: both storage providers hand out
 * a signed http URL, the local one by serving the directory itself.
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

function scene(over: Partial<Scene> & Pick<Scene, 'id'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 3, purpose: 'A beat',
    visualType: 'generated_broll', narration: '', onScreenText: [], assetRefs: [], momentIds: [],
    motionRecipe: { name: 'footage', easing: 'out_quint', delay: 0, stagger: 0.04, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'ready',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

/**
 * A clip of one unmistakable colour, encoded exactly as the 3D renderer's
 * frames are. Orange appears nowhere in this brand, so a frame containing it
 * can only have come from the clip.
 */
async function orangeClip(dir: string): Promise<string> {
  const width = 640, height = 360;
  for (let frame = 1; frame <= 45; frame += 1) {
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      raw[i * 3] = 235;
      raw[i * 3 + 1] = 110;
      raw[i * 3 + 2] = 20;
    }
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(path.join(dir, `frame_${String(frame).padStart(4, '0')}.png`));
  }
  const clip = path.join(dir, 'shot.mp4');
  const encoded = await runFfmpeg(framesToVideoArgs(path.join(dir, 'frame_%04d.png'), 15, clip));
  expect(encoded.ok, encoded.stderr.slice(-300)).toBe(true);
  return clip;
}

/** How much of a frame is that orange. */
async function orangeShare(framePath: string): Promise<number> {
  const image = sharp(framePath);
  const { width = 0, height = 0 } = await image.metadata();
  const raw = await image.raw().toBuffer();
  const channels = raw.length / (width * height);
  let hits = 0;
  for (let i = 0; i < width * height; i += 1) {
    const r = raw[i * channels]!, g = raw[i * channels + 1]!, b = raw[i * channels + 2]!;
    if (r > 180 && g > 60 && g < 170 && b < 90) hits += 1;
  }
  return hits / (width * height);
}

/** Serves one file, the way the storage provider serves an asset. */
async function serve(file: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void stat(file).then((info) => {
      response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(info.size) });
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).pipe(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/shot.mp4`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const servers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of servers) await close();
});

describe.skipIf(browser === undefined)('a generated shot in the finished film', () => {
  it('plays, rather than being handed to a component that draws images', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-footage-'));
    const clip = await orangeClip(dir);
    const served = await serve(clip);
    servers.push(served.close);

    const storyboard: Storyboard = resequence({
      id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      scenes: [scene({ id: 'broll', assetRefs: ['ast_clip'], purpose: 'Atmosphere' })],
      voiceStrategy: 'none', musicDirection: '', status: 'draft', language: 'en',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const outputPath = path.join(dir, 'film.mp4');
    await renderFilm({
      props: {
        storyboard,
        brand,
        assetUrls: { ast_clip: served.url },
        footageAssetIds: ['ast_clip'],
        watermarkLabel: null,
        cta: 'northwind.example',
        tagline: '',
        theme: 'dark',
      },
      aspect: '16:9',
      quality: 'preview',
      fps: 15,
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
    });

    const frame = path.join(dir, 'mid.png');
    expect((await runFfmpeg(posterArgs(outputPath, 1.5, frame))).ok).toBe(true);
    const share = await orangeShare(frame);
    expect(share, 'the clip is not on the screen').toBeGreaterThan(0.8);
  }, 240_000);

  it('falls back to the words when generation produced nothing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-footage-none-'));
    const storyboard: Storyboard = resequence({
      id: 'sbd_2', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      // The recipe says footage and the shot has none: the scene is its words.
      scenes: [scene({ id: 'broll', assetRefs: [], onScreenText: ['Forty unmatched rows.'] })],
      voiceStrategy: 'none', musicDirection: '', status: 'draft', language: 'en',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const outputPath = path.join(dir, 'film.mp4');
    await renderFilm({
      props: { storyboard, brand, assetUrls: {}, watermarkLabel: null, cta: 'northwind.example', tagline: '', theme: 'dark' },
      aspect: '16:9',
      quality: 'preview',
      fps: 15,
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
    });

    const frame = path.join(dir, 'mid.png');
    expect((await runFfmpeg(posterArgs(outputPath, 1.5, frame))).ok).toBe(true);
    const stats = await sharp(frame).stats();
    const spread = Math.max(...stats.channels.map((channel) => channel.stdev));
    expect(spread, 'the scene rendered nothing at all').toBeGreaterThan(6);
    expect(await orangeShare(frame)).toBeLessThan(0.01);
  }, 240_000);
});
