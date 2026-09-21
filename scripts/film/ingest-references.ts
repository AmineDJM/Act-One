/**
 * Adds films to the reference corpus from the command line.
 *
 * THE SAME ANALYSIS THE CONSOLE RUNS, deliberately. `analyseBenchmark` is the
 * one function that measures a film and has a model watch it, and both the
 * Benchmark Library and this script call it — so a reference added from a
 * terminal is indistinguishable from one uploaded by an operator, and there is
 * no second code path to drift.
 *
 * What this does NOT do is average anything. Each film is kept whole, with its
 * two readings in separate fields, and retrieval asks it questions one at a
 * time. A corpus is a library of contexts in which a decision worked, not a
 * sample to infer rules from — and that is as true at twenty films as at three.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run ingest:references -- <file> [file...]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyseBenchmark, countMoments, loadBenchmarkLab } from '@act-one/qa';
import { GeminiVideoAnalyst } from '@act-one/providers';

const REF = path.resolve('.renders/ref');
mkdirSync(REF, { recursive: true });

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.mp4'));

/*
 * `--retry targetN` re-analyses a film already in the corpus, in place.
 *
 * The case this exists for is a reading that came back describing nothing: the
 * film is fine, the analysis is not, and re-uploading a file that was never
 * the problem would add a duplicate rather than fix anything. It is the same
 * affordance the console offers, for the same reason.
 */
const retry = args.includes('--retry') ? args[args.indexOf('--retry') + 1] : null;

if (files.length === 0 && !retry) {
  console.error('Give me at least one .mp4 to add, or --retry <id> to re-analyse one already in the corpus.');
  process.exit(1);
}

const readingsFile = path.join(REF, 'target-readings.json');
const readings: Record<string, unknown> = existsSync(readingsFile)
  ? JSON.parse(readFileSync(readingsFile, 'utf8'))
  : {};

const analyst = new GeminiVideoAnalyst({});
if (!analyst.isConfigured()) {
  console.log('No video analyst configured: these films will be measured but never watched.');
}

/** The next free slot, so adding films never overwrites one already analysed. */
function nextId(): string {
  let n = 1;
  while (existsSync(path.join(REF, `target${n}.mp4`))) n += 1;
  return `target${n}`;
}

/** Runs both analyses over one film already in the corpus and rewrites its entry. */
async function reanalyse(id: string): Promise<void> {
  const kept = path.join(REF, `${id}.mp4`);
  if (!existsSync(kept)) {
    console.log(`No ${id}.mp4 in the corpus.`);
    return;
  }
  console.log(`\n=== re-analysing ${id}`);
  const before = countMoments((readings[id] as Record<string, unknown>) ?? null);
  const result = await analyseBenchmark(
    kept,
    analyst.isConfigured() ? analyst : null,
    { organizationId: 'org_platform' } as never,
  );
  /*
   * A re-analysis that comes back emptier than what is on file is discarded.
   * The point of retrying is to recover a film that described nothing; letting
   * a worse answer overwrite a better one would make the button that fixes the
   * corpus also the button that can break it.
   */
  if (result.mechanismCount < before) {
    console.log(`  kept the existing reading: the new one described ${result.mechanismCount} moments against ${before}.`);
    return;
  }
  writeFileSync(path.join(REF, `${id}.profile.json`), JSON.stringify(result.measured ?? {}, null, 2));
  if (result.reading) readings[id] = result.reading;
  writeFileSync(readingsFile, JSON.stringify(readings, null, 2));
  console.log(`  ${result.status}  ${before} -> ${result.mechanismCount} described moments`);
  if (result.note) console.log(`  ${result.note}`);
}

if (retry) await reanalyse(retry);

for (const file of files) {
  const source = path.resolve(file);
  if (!existsSync(source)) {
    console.log(`SKIP ${path.basename(file)}: no such file.`);
    continue;
  }
  const id = nextId();
  const kept = path.join(REF, `${id}.mp4`);
  // The original is kept before anything is analysed: a corpus that cannot be
  // re-analysed is one frozen at the capability of the day it was ingested.
  copyFileSync(source, kept);
  console.log(`\n=== ${id}  <- ${path.basename(file)}`);

  const result = await analyseBenchmark(
    kept,
    analyst.isConfigured() ? analyst : null,
    { organizationId: 'org_platform' } as never,
  );

  writeFileSync(path.join(REF, `${id}.profile.json`), JSON.stringify(result.measured ?? {}, null, 2));
  if (result.reading) readings[id] = result.reading;
  writeFileSync(readingsFile, JSON.stringify(readings, null, 2));

  console.log(`  ${result.status}  ${result.durationSeconds.toFixed(1)}s  ${result.mechanismCount} described moments  $${result.costUsd.toFixed(3)}`);
  if (result.note) console.log(`  ${result.note}`);
}

const lab = loadBenchmarkLab();
console.log(`\n=== corpus: ${lab.films.length} film(s) ===`);
for (const film of lab.films) {
  console.log(`  ${film.id.padEnd(9)} ${String(Math.round(film.durationSeconds)).padStart(4)}s  ${String(film.mechanisms.length).padStart(3)} mechanisms`);
}
if (lab.empty.length > 0) {
  console.log(`\n  contributing nothing: ${lab.empty.map((e) => e.id).join(', ')}`);
}
console.log(`\n  total retrievable moments: ${lab.films.reduce((n, f) => n + f.mechanisms.length, 0)}`);
