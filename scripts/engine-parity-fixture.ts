/**
 * The fixture film the engine parity measurement renders beside the
 * reference films: a fictional company's film made from generated material,
 * so the parts of the engines the reference films never exercise — pictures,
 * clips, a logo, filmed captures and joins — are measured too.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import { isolateLayers, operateLayers, resequence, UiRegion, UiSequence, volumeLayers, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import type { FilmProps } from '@act-one/motion';
import { runFfmpeg } from '@act-one/sound';

/**
 * A fictional company's film made from generated material.
 *
 * A product capture, a photograph, a clip that shows its own timecode (so a
 * frame of it says which frame of the source it is), and a vector logo inline
 * as a data address, joined by a camera carry and a field change.
 */
export function fixtureFilm(baseUrl: string): FilmProps {
  const brand = fixtureBrand();
  const scene = sceneBuilder('fixture');

  const storyboard = resequence({
    id: 'sbd_fixture',
    projectId: 'prj_fixture',
    conceptId: 'cpt_fixture',
    treatmentId: 'trt_fixture',
    handovers: {
      scn_fixture_0: { kind: 'camera_carry', seconds: 0.9, anchor: null, reason: 'fixture' },
      scn_fixture_2: { kind: 'field_change', seconds: 0.8, anchor: null, reason: 'fixture' },
    },
    version: 1,
    scenes: [
      scene(0, {
        duration: 4,
        visualType: 'product_ui',
        purpose: 'Show the product',
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('product_window', { aspect: 1.6 }),
        cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.06, fromX: 0, toX: 0, fromY: 0, toY: -0.2, motionBlur: 0.1, depthOfField: 0.6, easing: 'in_out_quart' },
      }),
      scene(1, { duration: 3.6, visualType: 'real_media', purpose: 'Where it is used', onScreenText: ['Every desk, one view.'], assetRefs: ['ast_photo'], motionRecipe: recipeOf('photo_hold') }),
      scene(2, { duration: 3.6, visualType: 'generated_broll', purpose: 'It runs', onScreenText: ['Built for the night shift.'], assetRefs: ['ast_clip'], motionRecipe: recipeOf('footage') }),
      scene(3, {
        duration: 4.2,
        visualType: 'product_ui',
        purpose: 'Film the dashboard',
        onScreenText: ['Every signal in one place.'],
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('product_sequence'),
        // Crops at the frame's own aspect: a 1.6 capture in a 16:9 frame is 0.9 as tall as it is wide.
        uiSequence: UiSequence.parse({
          sourceWidth: 1600,
          sourceHeight: 1000,
          background: { r: 16, g: 20, b: 29 },
          framings: [
            { role: 'establish', move: 'settle', from: { x: 0, y: 0, width: 1, height: 0.9 }, to: { x: 0.05, y: 0.05, width: 0.9, height: 0.81 }, seconds: 1.8, cut: true },
            { role: 'subject', move: 'push', from: { x: 0.02, y: 0.1, width: 0.6, height: 0.54 }, to: { x: 0.05, y: 0.15, width: 0.45, height: 0.405 }, seconds: 2.4, cut: true, lift: { x: 0.06, y: 0.2, width: 0.28, height: 0.2 }, words: 'bottom_right' },
          ],
        }),
      }),
      scene(4, { duration: 3.2, visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['See everything, calmly.'], motionRecipe: recipeOf('cta_end_card') }),
    ],
    voiceStrategy: 'none',
    language: null,
    heroShot: null,
    musicDirection: '',
    status: 'draft',
    parentStoryboardId: null,
    revisionReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Storyboard);

  return {
    storyboard,
    brand,
    assetUrls: {
      ast_capture: `${baseUrl}/capture.png`,
      ast_photo: `${baseUrl}/photo.jpg`,
      ast_clip: `${baseUrl}/clip.mp4`,
    },
    footageAssetIds: ['ast_clip'],
    watermarkLabel: 'Act One',
    cta: 'lumen.example',
    tagline: 'See everything, calmly.',
    theme: 'dark',
  };
}

/**
 * The interface taken apart, measured.
 *
 * A short film whose framings are planned by production's own functions: a
 * panel isolated from its shell, a control pressed and its result lifted, and
 * two volumes, one with its line set behind the panels and one with it in a
 * corner, a panel of the first cut from a second capture. It is carried out
 * of its first scene by a join, so a taken-apart framing is held through one.
 */
export function layersFilm(baseUrl: string): FilmProps {
  const brand = fixtureBrand();
  const scene = sceneBuilder('layers');
  // The fixture capture's panels and one of its green bars, as the structure pass would find them.
  const panel = (index: number) => UiRegion.parse({ x: (40 + (index % 3) * 500) / 1600, y: (160 + Math.floor(index / 3) * 380) / 1000, width: 460 / 1600, height: 340 / 1000, weight: 0.2, density: 0.4 });
  const bar = UiRegion.parse({ x: 70 / 1600, y: 580 / 1000, width: 290 / 1600, height: 18 / 1000, weight: 0.02, density: 0.9 });
  const sequence = (framings: unknown[]) => UiSequence.parse({ sourceWidth: 1600, sourceHeight: 1000, background: { r: 16, g: 20, b: 29 }, framings });
  const whole = { x: 0, y: 0, width: 1, height: 0.9 };

  const storyboard = resequence({
    id: 'sbd_layers',
    projectId: 'prj_fixture',
    conceptId: 'cpt_fixture',
    treatmentId: 'trt_fixture',
    handovers: { scn_layers_0: { kind: 'camera_carry', seconds: 0.8, anchor: null, reason: 'fixture' } },
    version: 1,
    scenes: [
      scene(0, {
        duration: 4.2,
        visualType: 'product_ui',
        purpose: 'One panel out of the dashboard',
        onScreenText: ['Every signal in one place.'],
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('product_sequence'),
        uiSequence: sequence([
          { role: 'establish', move: 'settle', from: whole, to: { x: 0.03, y: 0.04, width: 0.94, height: 0.846 }, seconds: 1.4, cut: true },
          { role: 'subject', move: 'push', from: { x: 0.2, y: 0.05, width: 0.6, height: 0.54 }, to: { x: 0.25, y: 0.08, width: 0.5, height: 0.45 }, seconds: 2.8, cut: true, words: 'bottom_left', layers: isolateLayers(panel(1), 2.8) },
        ]),
      }),
      scene(1, {
        duration: 3.6,
        visualType: 'product_ui',
        purpose: 'The action and what came of it',
        onScreenText: ['One press, and it is done.'],
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('product_zoom'),
        uiSequence: sequence([
          { role: 'action', move: 'push', from: { x: 0, y: 0.3, width: 0.6, height: 0.54 }, to: { x: 0, y: 0.36, width: 0.66, height: 0.594 }, seconds: 3.6, cut: true, layers: operateLayers(bar, panel(4), 3.6) },
        ]),
      }),
      scene(2, {
        duration: 4,
        visualType: 'product_ui',
        purpose: 'Three surfaces in one space',
        onScreenText: ['Three views, one truth.'],
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('feature_stack'),
        uiSequence: sequence([
          {
            role: 'context', move: 'settle', from: whole, to: whole, seconds: 4, cut: true, space: 'volume', wordsBehind: true,
            layers: volumeLayers([{ rect: panel(0) }, { rect: panel(4) }, { rect: { x: 0.05, y: 0.1, width: 0.5, height: 0.5 }, assetId: 'ast_capture_b', sourceWidth: 1440, sourceHeight: 900 }], 4),
          },
        ]),
      }),
      scene(3, {
        duration: 3.4,
        visualType: 'product_ui',
        purpose: 'Two surfaces, and the line',
        onScreenText: ['Built for the night shift.'],
        assetRefs: ['ast_capture'],
        motionRecipe: recipeOf('floating_ui'),
        uiSequence: sequence([
          { role: 'context', move: 'settle', from: whole, to: whole, seconds: 3.4, cut: true, space: 'volume', words: 'top_left', layers: volumeLayers([{ rect: panel(2) }, { rect: panel(5) }], 3.4) },
        ]),
      }),
    ],
    voiceStrategy: 'none',
    language: null,
    heroShot: null,
    musicDirection: '',
    status: 'draft',
    parentStoryboardId: null,
    revisionReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Storyboard);

  return {
    storyboard,
    brand,
    assetUrls: { ast_capture: `${baseUrl}/capture.png`, ast_capture_b: `${baseUrl}/capture-b.png` },
    footageAssetIds: [],
    watermarkLabel: 'Act One',
    cta: 'lumen.example',
    tagline: 'See everything, calmly.',
    theme: 'dark',
  };
}

function fixtureBrand(): BrandSystem {
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect x="0" y="20" width="60" height="60" rx="12" fill="#39d98a"/><text x="80" y="68" font-family="sans-serif" font-size="44" font-weight="700" fill="#f4f5f8">Lumen</text></svg>`;
  return {
    id: 'brd_fixture',
    organizationId: 'org_reference',
    name: 'Lumen',
    logo: { assetId: null, url: `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`, background: 'dark', format: 'svg', aspectRatio: 3 },
    logoVariants: [],
    primaryColor: '#39d98a',
    secondaryColor: null,
    accentColors: [],
    primaryCandidates: ['#39d98a'],
    neutrals: neutralRamp('#39d98a', 9, 0.05),
    canvasDark: '#0b0e14',
    canvasLight: '#ffffff',
    typography: [],
    visualStyle: 'minimal',
    imageTreatment: 'none',
    layoutDensity: 'balanced',
    cornerStyle: 'subtle',
    cornerRadiusPx: 10,
    motionStyle: 'precise',
    tone: 'Calm.',
    allowsGlow: false,
    allowsGradient: false,
    confirmedByUser: true,
    sources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as BrandSystem;
}

function sceneBuilder(slug: string): (index: number, spec: Partial<Scene> & Pick<Scene, 'duration' | 'visualType' | 'purpose' | 'motionRecipe'>) => Scene {
  return (index: number, spec: Partial<Scene> & Pick<Scene, 'duration' | 'visualType' | 'purpose' | 'motionRecipe'>): Scene =>
    ({
      id: `scn_${slug}_${index}`,
      storyboardId: `sbd_${slug}`,
      index,
      startTime: 0,
      narration: '',
      onScreenText: [],
      assetRefs: [],
      momentIds: [],
      cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
      soundCues: [],
      voiceOver: false,
      generativeNeeds: [],
      threeDSceneId: null,
      status: 'draft',
      parentStoryboardId: null,
      revisionReason: '',
      claimEvidenceIds: [],
      notes: '',
      estimatedCostUsd: 0,
      ...spec,
    }) as Scene;
}

function recipeOf(name: Scene['motionRecipe']['name'], params: Record<string, string | number | boolean> = {}): Scene['motionRecipe'] {
  return { name, easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params };
}

/** Generates the fixture's pictures and clip once, and serves them over HTTP on this machine. */
export async function startFixtureServer(dir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await mkdir(dir, { recursive: true });
  const capture = path.join(dir, 'capture.png');
  if (!(await exists(capture))) {
    const panels = Array.from({ length: 6 }, (_, index) => `<rect x="${40 + (index % 3) * 500}" y="${160 + Math.floor(index / 3) * 380}" width="460" height="340" rx="14" fill="#1b2130"/><rect x="${70 + (index % 3) * 500}" y="${200 + Math.floor(index / 3) * 380}" width="${200 + index * 30}" height="18" rx="9" fill="#39d98a"/>`).join('');
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#10141d"/><rect width="1600" height="110" fill="#161b27"/><circle cx="70" cy="55" r="22" fill="#39d98a"/>${panels}</svg>`)).png().toFile(capture);
  }
  const second = path.join(dir, 'capture-b.png');
  if (!(await exists(second))) {
    // A light interface at another size, so a volume can hang a panel from a capture that is not the shot's own.
    const rows = Array.from({ length: 5 }, (_, index) => `<rect x="120" y="${250 + index * 110}" width="${900 - index * 90}" height="26" rx="6" fill="#c9ced8"/><rect x="1080" y="${244 + index * 110}" width="220" height="38" rx="10" fill="#${index === 0 ? '39d98a' : 'e3e6ec'}"/>`).join('');
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#f4f5f8"/><rect width="1440" height="96" fill="#ffffff"/><rect x="80" y="170" width="1280" height="640" rx="18" fill="#ffffff" stroke="#dde1e8" stroke-width="2"/>${rows}</svg>`)).png().toFile(second);
  }
  const photo = path.join(dir, 'photo.jpg');
  if (!(await exists(photo))) {
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2d3a4f"/><stop offset="1" stop-color="#c9a36b"/></linearGradient></defs><rect width="1920" height="1280" fill="url(#g)"/><rect x="300" y="620" width="1320" height="60" fill="#5a4630"/><rect x="620" y="360" width="680" height="260" rx="10" fill="#0f141c"/></svg>`)).jpeg({ quality: 90 }).toFile(photo);
  }
  const clip = path.join(dir, 'clip.mp4');
  if (!(await exists(clip))) {
    // A timecode burned into every frame, and the default keyframe interval, so the engine's own re-encode is exercised.
    const made = await runFfmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=5:decimals=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { timeoutMs: 120_000 });
    if (!made.ok) throw new Error(`fixture clip: ${made.stderr.slice(-300)}`);
  }

  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
  const server: Server = createServer((request, response) => {
    const name = path.basename(decodeURIComponent((request.url ?? '/').split('?')[0]!));
    const file = path.join(dir, name);
    stat(file)
      .then((info) => {
        response.writeHead(200, { 'content-type': types[path.extname(name)] ?? 'application/octet-stream', 'content-length': info.size, 'accept-ranges': 'bytes' });
        createReadStream(file).pipe(response);
      })
      .catch(() => {
        response.writeHead(404);
        response.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
