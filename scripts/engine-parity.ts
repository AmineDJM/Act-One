/**
 * The HyperFrames engine against the Remotion engine, measured.
 *
 *   npm run engine-parity -- --films halyard,northwind,meridian,fixture --variants engine,agent
 *
 * Each film is rendered by the Remotion engine (the reference), by the
 * HyperFrames engine drawing every scene itself (`engine`), and by the
 * HyperFrames engine with an agent writing every scene (`agent`, which needs
 * a language model). For every HyperFrames render it reports:
 *
 *  - the delivery: size, frame count, colour description, no sound;
 *  - picture similarity to the Remotion film, frame by frame and per scene
 *    (SSIM and PSNR, from FFmpeg);
 *  - the scene boundaries FilmIR's forensic analyzer finds in each file,
 *    against the storyboard's own;
 *  - what the render cost and how long each phase took.
 *
 * `fixture` is a film made here from generated pictures — a capture, a
 * photograph, a clip with its timecode burned in, an inline SVG logo — with
 * joins between its scenes, so the parts of the engines the reference films
 * never exercise are measured too. Every film here is a demonstration for a
 * fictional company, labelled as such.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { runForensics } from '@act-one/film-ir';
import { renderFilm, type FilmProps } from '@act-one/motion';
import { DirectorySceneStore, renderFilmWithHyperFrames, type HyperFramesRenderResult } from '@act-one/motion-hyperframes';
import { OpenAiLlmProvider, type LlmTier } from '@act-one/providers';
import { resolveFfmpeg, runFfmpeg } from '@act-one/sound';
import { FILMS } from './reference-films-data.ts';

const { values } = parseArgs({
  options: {
    films: { type: 'string', default: 'halyard,northwind,meridian,fixture' },
    variants: { type: 'string', default: 'engine' },
    out: { type: 'string', default: path.resolve('.act-one-demo/engine-parity') },
    tier: { type: 'string', default: 'deep' },
    'skip-remotion': { type: 'boolean', default: false },
    'skip-forensics': { type: 'boolean', default: false },
  },
});

const OUT = path.resolve(values.out!);
const browserExecutable = process.env['ACT_ONE_CHROME_HEADLESS_SHELL'];
const variants = values.variants!.split(',').filter(Boolean) as ('engine' | 'agent')[];

type Film = { slug: string; props: FilmProps };

await mkdir(OUT, { recursive: true });
const fixtures = await startFixtureServer(path.join(OUT, 'fixture-assets'));

try {
  const films: Film[] = [];
  for (const slug of values.films!.split(',').filter(Boolean)) {
    if (slug === 'fixture') films.push({ slug, props: fixtureFilm(fixtures.baseUrl) });
    else {
      const film = FILMS.find((candidate) => candidate.slug === slug);
      if (!film) throw new Error(`No reference film called ${slug}.`);
      films.push({ slug, props: film.props });
    }
  }

  const report: Record<string, unknown> = {};
  for (const film of films) {
    console.log(`\n== ${film.slug}`);
    const boundaries = storyboardBoundaries(film.props.storyboard);
    const remotionPath = path.join(OUT, `${film.slug}.remotion.mp4`);
    const entry: Record<string, unknown> = { storyboardBoundaries: boundaries };

    if (!values['skip-remotion']) {
      const started = Date.now();
      await renderFilm({ props: film.props, aspect: '16:9', quality: 'hd', outputPath: remotionPath, ...(browserExecutable ? { browserExecutable } : {}) });
      entry['remotion'] = { seconds: (Date.now() - started) / 1000, forensics: await boundariesOf(remotionPath, boundaries) };
      console.log(`remotion: ${(entry['remotion'] as { seconds: number }).seconds.toFixed(1)} s`);
    }

    for (const variant of variants) {
      const output = path.join(OUT, `${film.slug}.hf-${variant}.mp4`);
      const started = Date.now();
      const result = await renderFilmWithHyperFrames({
        props: film.props,
        aspect: '16:9',
        quality: 'hd',
        outputPath: output,
        log: (line) => console.log(`  [hf] ${line}`),
        ...(variant === 'agent'
          ? {
              author: {
                llm: new OpenAiLlmProvider({}),
                call: { organizationId: 'org_reference', projectId: `prj_${film.slug}` },
                store: new DirectorySceneStore(path.join(OUT, 'scenes', film.slug)),
                tier: values.tier as LlmTier,
                concurrency: 6,
              },
            }
          : {}),
      });
      const similarity = await similarityTo(remotionPath, output, boundaries);
      entry[`hf-${variant}`] = {
        seconds: (Date.now() - started) / 1000,
        delivery: { width: result.width, height: result.height, durationSeconds: result.durationSeconds },
        scenes: result.scenes.map((scene) => ({ frameId: scene.frameId, source: scene.source, attempts: scene.attempts, costUsd: round(scene.costUsd, 4), fallbackReason: scene.fallbackReason })),
        costUsd: round(result.costUsd, 4),
        checks: { passes: result.checks.passes, rewritten: result.checks.rewritten, findings: result.checks.findings.map((finding) => `${finding.section}/${finding.code}/${finding.severity}`) },
        timingsMs: result.timingsMs,
        notes: result.notes,
        undecodable: result.undecodable,
        similarity,
        forensics: await boundariesOf(output, boundaries),
      };
      console.log(`hf-${variant}: ${summary(result, similarity)}`);
    }

    await contactSheet(film.slug, boundaries, variants);
    report[film.slug] = entry;
  }

  const reportPath = path.join(OUT, 'engine-parity.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
} finally {
  await fixtures.close();
}

/** Where each scene starts, in frames at 30 fps, after the first. */
function storyboardBoundaries(storyboard: Storyboard): number[] {
  return [...storyboard.scenes].sort((a, b) => a.index - b.index).slice(1).map((scene) => Math.round(scene.startTime * 30));
}

/** SSIM and PSNR against the Remotion film, per frame, summarised per scene. */
async function similarityTo(reference: string, candidate: string, boundaries: number[]) {
  if (!(await exists(reference))) return null;
  const ssimLog = `${candidate}.ssim.log`;
  const psnrLog = `${candidate}.psnr.log`;
  const done = await runFfmpeg(
    ['-v', 'error', '-i', reference, '-i', candidate, '-lavfi', `[0:v][1:v]ssim=stats_file=${ssimLog};[0:v][1:v]psnr=stats_file=${psnrLog}`, '-f', 'null', '-'],
    { timeoutMs: 20 * 60_000 },
  );
  if (!done.ok) return { error: done.stderr.slice(-300) };
  const ssim = (await readFile(ssimLog, 'utf8')).trim().split('\n').map((line) => Number(/All:([\d.]+)/.exec(line)?.[1]));
  const psnr = (await readFile(psnrLog, 'utf8')).trim().split('\n').map((line) => {
    const value = /psnr_avg:([\w.]+)/.exec(line)?.[1] ?? '0';
    return value === 'inf' ? 99 : Number(value);
  });
  await Promise.all([rm(ssimLog, { force: true }), rm(psnrLog, { force: true })]);
  const edges = [0, ...boundaries, ssim.length];
  return {
    frames: ssim.length,
    ssim: { mean: round(mean(ssim), 4), min: round(Math.min(...ssim), 4) },
    psnr: { mean: round(mean(psnr), 1), min: round(Math.min(...psnr), 1) },
    perScene: edges.slice(0, -1).map((from, index) => {
      const to = edges[index + 1]!;
      return { frames: [from, to], ssim: round(mean(ssim.slice(from, to)), 4), psnr: round(mean(psnr.slice(from, to)), 1) };
    }),
  };
}

/** The boundaries FilmIR's forensic analyzer finds, matched to the storyboard's within two frames. */
async function boundariesOf(film: string, expected: number[]) {
  if (values['skip-forensics']) return null;
  try {
    const forensic = await runForensics(film, { outputPath: `${film}.forensics.json`, ffmpeg: await resolveFfmpeg(), ocrHz: 2 });
    const found = forensic.boundaries.map((boundary) => boundary.firstIncoming).sort((a, b) => a - b);
    const matched = expected.filter((frame) => found.some((candidate) => Math.abs(candidate - frame) <= 2));
    return {
      found,
      expected,
      matched: matched.length,
      missed: expected.filter((frame) => !matched.includes(frame)),
      extra: found.filter((frame) => !expected.some((candidate) => Math.abs(candidate - frame) <= 2)),
    };
  } catch (error) {
    return { error: (error as Error).message.slice(0, 300) };
  }
}

/** One row per engine, one column per scene, each at the scene's middle. */
async function contactSheet(slug: string, boundaries: number[], variantsShown: string[]) {
  const files = [`${slug}.remotion.mp4`, ...variantsShown.map((variant) => `${slug}.hf-${variant}.mp4`)].map((name) => path.join(OUT, name));
  const present: string[] = [];
  for (const file of files) if (await exists(file)) present.push(file);
  const edges = [0, ...boundaries];
  const last = boundaries.length > 0 ? boundaries[boundaries.length - 1]! + 60 : 60;
  const middles = edges.map((from, index) => Math.round((from + (edges[index + 1] ?? last)) / 2));
  const select = middles.map((frame) => `eq(n\\,${frame})`).join('+');
  const rows = present.map((_, index) => `[${index}:v]select='${select}',scale=480:-1,tile=${middles.length}x1[r${index}]`).join(';');
  const stack = present.length > 1 ? `${present.map((_, index) => `[r${index}]`).join('')}vstack=inputs=${present.length}` : '[r0]copy';
  await runFfmpeg(
    ['-y', '-v', 'error', ...present.flatMap((file) => ['-i', file]), '-filter_complex', `${rows};${stack}`, '-frames:v', '1', path.join(OUT, `${slug}.sheet.png`)],
    { timeoutMs: 5 * 60_000 },
  );
}

function summary(result: HyperFramesRenderResult, similarity: Awaited<ReturnType<typeof similarityTo>>): string {
  const sources = result.scenes.map((scene) => scene.source).join(',');
  const similar = similarity && 'frames' in similarity && similarity.ssim && similarity.psnr ? `ssim ${similarity.ssim.mean} psnr ${similarity.psnr.mean}` : 'no reference';
  return `${result.durationSeconds.toFixed(2)} s, ${sources}, $${result.costUsd.toFixed(3)}, ${similar}`;
}

/**
 * A fictional company's film made from generated material.
 *
 * A product capture, a photograph, a clip that shows its own timecode (so a
 * frame of it says which frame of the source it is), and a vector logo inline
 * as a data address, joined by a camera carry and a field change.
 */
function fixtureFilm(baseUrl: string): FilmProps {
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect x="0" y="20" width="60" height="60" rx="12" fill="#39d98a"/><text x="80" y="68" font-family="sans-serif" font-size="44" font-weight="700" fill="#f4f5f8">Lumen</text></svg>`;
  const brand: BrandSystem = {
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

  const scene = (index: number, spec: Partial<Scene> & Pick<Scene, 'duration' | 'visualType' | 'purpose' | 'motionRecipe'>): Scene =>
    ({
      id: `scn_fixture_${index}`,
      storyboardId: 'sbd_fixture',
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
  const recipe = (name: Scene['motionRecipe']['name'], params: Record<string, string | number | boolean> = {}): Scene['motionRecipe'] => ({ name, easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params });

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
        motionRecipe: recipe('product_window', { aspect: 1.6 }),
        cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.06, fromX: 0, toX: 0, fromY: 0, toY: -0.2, motionBlur: 0.1, depthOfField: 0.6, easing: 'in_out_quart' },
      }),
      scene(1, { duration: 3.6, visualType: 'real_media', purpose: 'Where it is used', onScreenText: ['Every desk, one view.'], assetRefs: ['ast_photo'], motionRecipe: recipe('photo_hold') }),
      scene(2, { duration: 3.6, visualType: 'generated_broll', purpose: 'It runs', onScreenText: ['Built for the night shift.'], assetRefs: ['ast_clip'], motionRecipe: recipe('footage') }),
      scene(3, { duration: 3.2, visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['See everything, calmly.'], motionRecipe: recipe('cta_end_card') }),
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

/** Generates the fixture's pictures and clip once, and serves them over HTTP on this machine. */
async function startFixtureServer(dir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await mkdir(dir, { recursive: true });
  const capture = path.join(dir, 'capture.png');
  if (!(await exists(capture))) {
    const panels = Array.from({ length: 6 }, (_, index) => `<rect x="${40 + (index % 3) * 500}" y="${160 + Math.floor(index / 3) * 380}" width="460" height="340" rx="14" fill="#1b2130"/><rect x="${70 + (index % 3) * 500}" y="${200 + Math.floor(index / 3) * 380}" width="${200 + index * 30}" height="18" rx="9" fill="#39d98a"/>`).join('');
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#10141d"/><rect width="1600" height="110" fill="#161b27"/><circle cx="70" cy="55" r="22" fill="#39d98a"/>${panels}</svg>`)).png().toFile(capture);
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

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
