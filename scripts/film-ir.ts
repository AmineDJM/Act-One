/**
 * The reverse compiler, from the command line.
 *
 *   npm run film-ir -- film.mp4 [--out DIR] [--no-gemini] [--no-asr] [--redo forensics,passes]
 *
 * Runs forensics, transcription, the Gemini passes and the compiler, with a
 * checkpoint after every stage in DIR/checkpoints, and writes DIR/FilmIR.json.
 * Run it again and it resumes; --redo names stages to run again anyway.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeFilm, directoryCheckpoints, checkForensicsRuntime, type AnalyzeStage } from '@act-one/film-ir';
import { GeminiVideoProvider, NullCostSink, OpenAiSpeechProvider } from '@act-one/providers';
import { resolveFfmpeg } from '@act-one/sound';

const args = process.argv.slice(2);
const film = args.find((arg, i) => !arg.startsWith('--') && !['--out', '--redo', '--id'].includes(args[i - 1] ?? ''));
if (!film) {
  console.error('usage: npm run film-ir -- film.mp4 [--out DIR] [--no-gemini] [--no-asr] [--redo stage,stage]');
  process.exit(1);
}
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
};
const out = path.resolve(option('--out') ?? `.act-one-film-ir/${path.basename(film, path.extname(film))}`);
const id = option('--id') ?? `bench_${path.basename(film, path.extname(film)).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;

const runtime = await checkForensicsRuntime();
if (!runtime.ok) {
  console.error(`The analyzer cannot run here: ${runtime.reason}`);
  process.exit(1);
}
const costSink = new NullCostSink();
const started = Date.now();
await mkdir(out, { recursive: true });
const result = await analyzeFilm({
  id,
  title: path.basename(film),
  filmPath: path.resolve(film),
  workDir: path.join(out, 'work'),
  ffmpeg: await resolveFfmpeg(),
  checkpoints: directoryCheckpoints(path.join(out, 'checkpoints')),
  gemini: args.includes('--no-gemini') ? null : new GeminiVideoProvider({ costSink }),
  recognizer: args.includes('--no-asr') ? null : new OpenAiSpeechProvider({ costSink }),
  context: { organizationId: 'org_platform', projectId: null },
  redo: (option('--redo') ?? '').split(',').filter(Boolean) as AnalyzeStage[],
  onStage: (stage, state, detail) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${stage.padEnd(13)} ${state}${detail ? `: ${detail}` : ''}`),
  onProgress: (stage, _progress, message) => {
    if (stage === 'passes') console.log(`         ${message}`);
  },
});
await writeFile(path.join(out, 'FilmIR.json'), JSON.stringify(result.document));
await writeFile(path.join(out, 'validation.json'), JSON.stringify(result.validation, null, 1));
const v = result.validation;
console.log(`\n${v.status} · ${result.document.frames?.count ?? 0} frames · ${result.document.objects.length} tracks · ${result.document.events.events.length} events · ${result.document.contradictions.length} contradictions · ${result.document.unsupported.length} unsupported claims`);
for (const check of v.checks) if (check.status !== 'pass') console.log(`  ${check.status} ${check.id}: ${check.message}`);
console.log(`evidence: ${Object.entries(v.evidenceMix).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`model cost $${result.costUsd.toFixed(3)} (ledger: $${costSink.records.reduce((s, r) => s + r.actualCostUsd, 0).toFixed(3)}) · ${((Date.now() - started) / 1000).toFixed(0)}s · ${path.join(out, 'FilmIR.json')}`);
