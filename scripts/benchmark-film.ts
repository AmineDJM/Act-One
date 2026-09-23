/**
 * A finished film, measured against the reference films.
 *
 * Runs the analyser the reference bands were measured with over one master,
 * reads its report onto the same bands, and prints where the film sits:
 * inside, below or above each, and by how much. With `--against` it prints
 * the change from an earlier reading, which is how an engine change is judged
 * by what it did to a real film rather than by what it was meant to do.
 *
 *   npm run benchmark:film -- master.mp4 [--json reading.json] [--against earlier.json]
 *
 * Needs python3 with numpy and opencv-python-headless.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyseFilm, benchmarkGrammar, FilmGrammarReport, type FilmPrinciples, type GrammarBenchmark } from '@act-one/qa';

const ANALYSER = path.resolve('scripts/analysis/film_grammar.py');
const ANALYSER_TIMEOUT_MS = 20 * 60_000;

type Reading = {
  film: string;
  benchmark: GrammarBenchmark;
  principles: FilmPrinciples;
  audio: FilmGrammarReport['audio'];
};

const args = process.argv.slice(2);
const film = args.find((arg) => !arg.startsWith('--') && !isOptionValue(arg));
if (!film) {
  console.error('usage: npm run benchmark:film -- master.mp4 [--json reading.json] [--against earlier.json]');
  process.exit(1);
}
const jsonOut = option('--json');
const againstPath = option('--against');

const work = await mkdtemp(path.join(tmpdir(), 'act-one-benchmark-'));
try {
  const reportPath = path.join(work, 'grammar.json');
  await runAnalyser(film, reportPath);
  const parsed = FilmGrammarReport.safeParse(JSON.parse(await readFile(reportPath, 'utf8')));
  if (!parsed.success) {
    throw new Error(`The analyser's report is not the shape this reads: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  const reading: Reading = {
    film: path.basename(film),
    benchmark: benchmarkGrammar(parsed.data),
    principles: await analyseFilm(film, { workDir: work }),
    audio: parsed.data.audio,
  };
  const earlier = againstPath ? (JSON.parse(await readFile(againstPath, 'utf8')) as Reading) : null;
  print(reading, earlier);
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(reading, null, 1));
    console.log(`\n  reading written to ${jsonOut}`);
  }
} catch (error) {
  console.error(`\nBenchmark failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}

function print(reading: Reading, earlier: Reading | null): void {
  console.log(`\n${reading.film}${earlier ? `  (against ${earlier.film})` : ''}`);
  console.log(`  ${'band'.padEnd(26)} ${'measured'.padStart(9)}  ${'reference'.padEnd(14)} position${earlier ? '      was' : ''}`);
  for (const row of reading.benchmark.readings) {
    const before = earlier?.benchmark.readings.find((candidate) => candidate.band === row.band);
    const mark = row.position === 'inside' ? '  inside' : `✗ ${row.position} by ${row.gap.toFixed(2)}w`;
    console.log(
      `  ${row.band.padEnd(26)} ${fmt(row.measured).padStart(9)}  ${`${fmt(row.low)}–${fmt(row.high)}`.padEnd(14)} ${mark.padEnd(20)}` +
        (before ? ` ${fmt(before.measured)}` : ''),
    );
  }
  console.log(`\n  gap on the defect side: ${reading.benchmark.defectGap.toFixed(2)} band widths` +
    (earlier ? ` (was ${earlier.benchmark.defectGap.toFixed(2)})` : ''));
  for (const finding of reading.benchmark.findings) console.log(`    · ${finding.band}: ${finding.says}`);

  const p = reading.principles;
  console.log(`\n  picture: ${p.shots} shots, mean ${p.meanShotSeconds.toFixed(2)}s, spread ${p.shotLengthSpread.toFixed(2)}, ` +
    `flat ${pct(p.flatShare)}, distinct ${pct(p.distinctShare)}, ${p.fields} field(s), motion ${p.motionDensity.toFixed(3)}`);
  if (reading.audio) {
    const a = reading.audio;
    console.log(`  sound:   voice ${pct(a.voiceShareOfRuntime)} of runtime, longest silence ${a.longestSilence.toFixed(2)}s, ` +
      `${a.impacts.length} impacts, ${a.onsets.length} onsets, tempo ${a.bpm ?? '—'}, loudness range ${p.loudnessRangeLu.toFixed(1)} LU`);
  } else {
    console.log('  sound:   NONE');
  }
}

function runAnalyser(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // An argv array, never a shell: the path is whatever the caller typed.
    const child = spawn('python3', [ANALYSER, input, output], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), ANALYSER_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`python3 could not be started: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the analyser stopped (${signal ?? `exit ${code}`}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

function option(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function isOptionValue(arg: string): boolean {
  const index = args.indexOf(arg);
  return index > 0 && (args[index - 1] === '--json' || args[index - 1] === '--against');
}

function fmt(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
