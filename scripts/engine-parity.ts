/**
 * The HyperFrames engine against the Remotion engine, measured.
 *
 *   npm run engine-parity -- --films halyard,northwind,meridian,fixture,layers --variants engine,agent
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
 * `fixture` is a film made here from generated pictures — a capture shown
 * in its window and then filmed as a sequence of framings, a photograph, a
 * clip with its timecode burned in, an inline SVG logo — with joins between
 * its scenes, so the parts of the engines the reference films never
 * exercise are measured too. `layers` is a shorter one made the same way
 * whose captures are taken apart and hung in a volume, framed by production's
 * own planners. Every film here is a demonstration for a fictional company,
 * labelled as such.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Storyboard } from '@act-one/core';
import { runForensics } from '@act-one/film-ir';
import { renderFilm, type FilmProps } from '@act-one/motion';
import { DirectorySceneStore, renderFilmWithHyperFrames, type HyperFramesRenderResult } from '@act-one/motion-hyperframes';
import { OpenAiLlmProvider, type LlmTier } from '@act-one/providers';
import { resolveFfmpeg, runFfmpeg } from '@act-one/sound';
import { fixtureFilm, layersFilm, startFixtureServer } from './engine-parity-fixture.ts';
import { FILMS } from './reference-films-data.ts';

const { values } = parseArgs({
  options: {
    films: { type: 'string', default: 'halyard,northwind,meridian,fixture,layers' },
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
    else if (slug === 'layers') films.push({ slug, props: layersFilm(fixtures.baseUrl) });
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
