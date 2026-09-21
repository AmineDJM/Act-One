/**
 * Judges the three creative directions by watching them, not by reading them.
 *
 * WHY THIS EXISTS, STATED PLAINLY. The first pass at selecting a direction was
 * made off contact sheets — twelve stills per film, read by eye. That is a
 * storyboard review wearing a lab coat. A contact sheet cannot see easing, it
 * cannot see whether a cut lands on the beat, it cannot see what a first-time
 * viewer understands by second four, and it cannot see the difference between
 * a hold that is composed and a hold that is dead air. Selecting a direction
 * on stills is exactly the mistake this whole sprint was called to stop.
 *
 * So the real files go to a model that watches video natively, at the deep
 * tier, with the whole MP4 uploaded rather than frames scraped out of it.
 *
 * THE THREE CHANNELS ARE KEPT APART, and that is the point of the output
 * shape. `measured` is FFmpeg and OpenCV: flow, cut positions, static share —
 * facts about pixels, with no opinion in them. `semantic` is the video model's
 * reading: what the film is doing, whether it is understood, what it is worth
 * remembering. `critic` is a second, independent opinion from a different
 * vendor that never sees the first one, so agreement between them is evidence
 * rather than an echo.
 *
 * A number from one channel must never be reported as if it came from
 * another. A model saying "the cut lands on the beat" is an interpretation; an
 * onset detector saying the cut is 40ms after the transient is a measurement;
 * and a director who cannot tell which is which will optimise a film toward
 * whichever one is easier to move.
 *
 *   npm run evaluate:directions
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GeminiVideoAnalyst, OpenAiLlmProvider } from '@act-one/providers';
import { z } from 'zod';
import type { VideoAnalysis } from '@act-one/providers';

const run = promisify(execFile);
const FFPROBE = 'node_modules/@remotion/compositor-linux-x64-gnu/ffprobe';

const CONTEXT = { organizationId: 'org_quality_sprint' };

const FILMS = [
  { slug: 'launch', file: '.renders/launch.mp4' },
  { slug: 'final', file: '.renders/final.mp4' },
  { slug: 'a-paper', file: '.renders/dir-a-paper.mp4' },
  { slug: 'b-depth', file: '.renders/dir-b-depth.mp4' },
  { slug: 'c-field', file: '.renders/dir-c-field.mp4' },
  { slug: 'baseline', file: '.renders/baseline.mp4' },
];

/**
 * What the video model is asked, beyond its standing instructions.
 *
 * Phrased as questions a director would actually ask before choosing between
 * three cuts, and deliberately not as a request for scores. A model asked to
 * rate a film out of ten will produce a number with nothing underneath it; a
 * model asked what a first-time viewer understands at second four has to have
 * watched second four.
 */
const FOCUS = [
  'This is a candidate launch film for a software company. Judge it as a director choosing between cuts.',
  'Say what a first-time viewer understands, and when they understand it.',
  'Say whether the film looks like generic dark-background SaaS motion graphics — small floating',
  'screenshots, centred typography, a subtle zoom — or whether it has a visual idea of its own.',
  'Name the single strongest moment and the single weakest, each with a timecode.',
  'Say whether any type or interface is clipped by the frame edge, with timecodes.',
  'Say what the film is missing that a benchmark launch film would have.',
].join(' ');

/** Facts about pixels. No opinion in them, and none inferred from them here. */
async function measure(file: string): Promise<Record<string, unknown>> {
  const probe = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
    '-of', 'json', file,
  ]);
  const raw = JSON.parse(probe.stdout) as {
    format: { duration: string; bit_rate?: string };
    streams: { codec_name?: string; codec_type?: string; width?: number; height?: number }[];
  };

  let grammar: unknown = null;
  const script = path.resolve('scripts/analysis/film_grammar.py');
  if (existsSync(script)) {
    try {
      // The grammar reader writes to a file rather than to stdout: it prints
      // progress while it works, so a caller that parses stdout parses the
      // progress.
      const json = path.resolve('.renders', `${path.basename(file, '.mp4')}.grammar.json`);
      await run('python3', [script, file, json], { maxBuffer: 32 * 1024 * 1024 });
      grammar = JSON.parse(await readFile(json, 'utf8'));
    } catch (error) {
      // Recorded rather than swallowed: a measurement that did not run is not
      // a measurement of zero, and a fused reading that silently drops a
      // channel is the failure this file exists to prevent.
      grammar = { unavailable: String(error).slice(0, 300) };
    }
  }

  return {
    durationSeconds: Number(raw.format.duration),
    bitRate: raw.format.bit_rate ? Number(raw.format.bit_rate) : null,
    streams: raw.streams.map((s) => ({ codec: s.codec_name, width: s.width ?? null, height: s.height ?? null })),
    filmGrammar: grammar,
  };
}

/** The video model's reading of the real file. */
async function watch(file: string): Promise<VideoAnalysis> {
  const analyst = new GeminiVideoAnalyst({});
  if (!analyst.isConfigured()) throw new Error('No Gemini credential is available in this process.');
  /*
   * Depth is switchable because the deep model's gateway is not always up.
   *
   * The deep path already retries four times before giving up, and there are
   * stretches where all four come back 502 — a full upload each, several
   * minutes each, and no reading at the end of it. When that happens the
   * choice is between no reading and a broader one, and a broader one is
   * worth more than nothing. ACT_ONE_EVAL_DEPTH=normal takes it.
   */
  const depth = (process.env['ACT_ONE_EVAL_DEPTH'] as 'deep' | 'normal' | undefined) ?? 'deep';
  return analyst.analyse({ source: path.resolve(file), depth, fps: depth === 'deep' ? 4 : 2, focus: FOCUS }, CONTEXT);
}


/**
 * A second opinion, from a different vendor, that never sees the first one.
 *
 * LABELLED FOR WHAT IT ACTUALLY SEES, which is the whole reason it is a
 * separate channel. This model is handed stills. It has not watched the film:
 * it cannot speak to easing, to whether a cut lands on a transient, or to
 * anything that happens between the frames it was given, and a critique of
 * stills reported as a critique of a film is the exact substitution this
 * evaluation exists to prevent. It is here because two vendors agreeing about
 * a composition is evidence and one vendor asserting it is not, and because a
 * model that has never read the video analysis cannot be echoing it.
 */
const Critique = z.object({
  looksGenericSaas: z.boolean(),
  genericReason: z.string().max(400),
  visualIdea: z.string().max(400),
  strongestFrame: z.string().max(300),
  weakestFrame: z.string().max(300),
  clippedOrBroken: z.array(z.string().max(200)).max(8),
  wouldShipToAClient: z.boolean(),
  againstBenchmark: z.string().max(500),
});

async function critique(file: string, stills: number): Promise<unknown> {
  const llm = new OpenAiLlmProvider({});
  const images: { url: string; detail: 'high' }[] = [];
  const probe = await run(FFPROBE, ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1', file]);
  const duration = Number(probe.stdout.trim());

  for (let i = 0; i < stills; i += 1) {
    const at = (duration * (i + 0.5)) / stills;
    const png = path.resolve('.renders', `${path.basename(file, '.mp4')}.critic.${i}.png`);
    await run('node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg',
      ['-y','-v','error','-ss', at.toFixed(3), '-i', file, '-frames:v','1','-vf','scale=768:-1', png]);
    images.push({ url: `data:image/png;base64,${(await readFile(png)).toString('base64')}`, detail: 'high' });
  }

  const result = await llm.completeJson(
    [
      { role: 'system', content:
        'You are an art director reviewing candidate launch films for a software company. You are being ' +
        'shown evenly spaced STILLS from one film, in order. You have not seen the motion. Judge only what ' +
        'a still can show: composition, typography, colour, whether the product is legible, whether ' +
        'anything is clipped by the frame edge. Say so plainly when a question needs motion to answer.' },
      { role: 'user', content:
        `${stills} stills in order from a ${duration.toFixed(1)}s film. The benchmark is the launch film ` +
        'work of studios like Vucko, Buck and Oddfellows for companies like Linear, Slack and Stripe. ' +
        'Be specific and be hard to please.' },
    ],
    { tier: 'deep', schema: Critique, schemaName: 'critique', images, maxOutputTokens: 1200 },
    CONTEXT,
  );
  return { sawStills: stills, sawVideo: false, model: llm.modelFor('deep'), critique: result.value };
}

const results: Record<string, unknown> = {};
const only = process.env['ACT_ONE_EVAL_ONLY'];

for (const film of FILMS) {
  if (only && film.slug !== only) continue;
  if (!existsSync(film.file)) {
    console.log(`${film.slug}: not rendered yet, skipping`);
    continue;
  }
  console.log(`\n=== ${film.slug} ===`);

  const measured = await measure(film.file);
  console.log(`  MEASURED  ${JSON.stringify(measured).slice(0, 200)}`);

  let semantic: VideoAnalysis | { failed: string };
  try {
    const analysis = await watch(film.file);
    semantic = analysis;
    console.log(`  SEMANTIC  model=${analysis.model} boundaries=${analysis.boundaries.length} beats=${analysis.beats.length} hero=${analysis.heroMoments.length}`);
    if (analysis.comprehension) {
      console.log(`            comprehension: ${JSON.stringify(analysis.comprehension).slice(0, 300)}`);
    }
    for (const moment of analysis.heroMoments.slice(0, 3)) {
      console.log(`            hero ${moment.span.start}-${moment.span.end}s ${JSON.stringify(moment).slice(0, 240)}`);
    }
    for (const limit of analysis.limitations.slice(0, 3)) console.log(`            limitation: ${limit}`);
  } catch (error) {
    semantic = { failed: String(error).slice(0, 500) };
    console.log(`  SEMANTIC  FAILED: ${String(error).slice(0, 300)}`);
  }

  let critic: unknown;
  try {
    critic = await critique(film.file, 8);
    const c = (critic as { critique?: Record<string, unknown> }).critique ?? {};
    console.log(`  CRITIC    genericSaas=${c['looksGenericSaas']} ship=${c['wouldShipToAClient']} (stills only, no motion)`);
    console.log(`            idea: ${String(c['visualIdea']).slice(0, 220)}`);
    if (Array.isArray(c['clippedOrBroken']) && c['clippedOrBroken'].length) {
      console.log(`            broken: ${(c['clippedOrBroken'] as string[]).join(' | ').slice(0, 260)}`);
    }
  } catch (error) {
    critic = { failed: String(error).slice(0, 400) };
    console.log(`  CRITIC    FAILED: ${String(error).slice(0, 220)}`);
  }

  results[film.slug] = { file: film.file, measured, semantic, critic };
}

const out = path.resolve('.renders/direction-evaluation.json');
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`\nwrote ${out}`);
