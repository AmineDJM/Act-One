import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CallContext, GeminiFile, GeminiVideoProvider, SpeechRecognizer } from '@act-one/providers';
import { compileFilmIR } from './compile/index.ts';
import { evidencePack } from './gemini/evidence-pack.ts';
import { mergeGemini } from './gemini/merge.ts';
import { PASSES } from './gemini/passes.ts';
import { runGeminiPasses, type PassRecord } from './gemini/run.ts';
import { extractExactFrames, runForensics, type ForensicsProgress } from './forensics/run.ts';
import { ForensicReport } from './forensics/report.ts';
import { ASR_METHODS, buildNarration, type TranscriptInput } from './narration/asr.ts';
import type { FilmIR, ValidationReport } from './schema/document.ts';
import type { Producer } from './schema/source.ts';
import { validateFilmIR } from './validate.ts';
import { SampleClock } from './compile/clock.ts';

/**
 * The reverse compiler: a film file in, one validated FilmIR out.
 *
 *   forensics → transcription → upload → passes → compile → validate
 *
 * Every stage writes a checkpoint the moment it finishes and reads it back
 * before it would start, so the same call after a crash, a deploy or a retry
 * picks up at the first stage that has not finished. A stage that fails
 * leaves the ones before it intact; the caller decides whether the failure is
 * worth another attempt. The document is only as complete as the stages that
 * ran, and its validation report says which did not.
 */
export type Checkpoints = {
  get<T>(name: string): Promise<T | null>;
  put(name: string, value: unknown): Promise<void>;
};

export type AnalyzeStage = 'forensics' | 'transcription' | 'upload' | 'passes' | 'compile' | 'validate';

export type AnalyzeOptions = {
  id: string;
  title: string | null;
  filmPath: string;
  mimeType?: string;
  workDir: string;
  ffmpeg: string;
  python?: string;
  checkpoints: Checkpoints;
  gemini: GeminiVideoProvider | null;
  recognizer: SpeechRecognizer | null;
  context: CallContext;
  /** Stages to run again even if a checkpoint exists. */
  redo?: AnalyzeStage[];
  /**
   * The film's SHA-256, when the caller already has it. Checkpoints whose
   * measurements were made from other bytes describe another film, so none
   * of them is used.
   */
  filmSha256?: string;
  onStage?: (stage: AnalyzeStage, state: 'started' | 'completed' | 'failed' | 'skipped', detail?: string) => Promise<void> | void;
  onProgress?: (stage: AnalyzeStage, progress: number, message: string) => void;
};

export type AnalyzeResult = {
  document: FilmIR;
  validation: ValidationReport;
  passes: Record<string, PassRecord>;
  costUsd: number;
};

export const EXPECTED_PASSES = [...PASSES.map((pass) => pass.id), 'integrator'];

/** Every stage whose result is kept between attempts, each derived from the one before. */
const CHECKPOINTED_STAGES: AnalyzeStage[] = ['forensics', 'transcription', 'upload', 'passes'];

export async function analyzeFilm(options: AnalyzeOptions): Promise<AnalyzeResult> {
  await mkdir(options.workDir, { recursive: true });
  const redo = new Set(options.redo ?? []);
  if (options.filmSha256) {
    const measured = await options.checkpoints.get<{ input?: { sha256?: string } }>('forensics');
    if (measured && measured.input?.sha256 !== options.filmSha256) {
      console.warn(`[film-ir] ${options.id}: the checkpoints were made from other bytes (${measured.input?.sha256?.slice(0, 12) ?? 'unknown'}…, not ${options.filmSha256.slice(0, 12)}…); analysing from the start`);
      for (const name of CHECKPOINTED_STAGES) redo.add(name);
    }
  }
  /**
   * One stage, from its checkpoint when it has one. `shortfall` names what a
   * stage that returned still failed to do (a pass that failed among ten):
   * the stage is reported failed, so it can be retried, while the analysis
   * carries on with what it has.
   */
  const stage = async <T>(name: AnalyzeStage, checkpoint: string | null, work: () => Promise<T>, shortfall?: (value: T) => string | null): Promise<T> => {
    if (checkpoint && !redo.has(name)) {
      const existing = await options.checkpoints.get<T>(checkpoint);
      if (existing !== null && existing !== undefined) {
        await options.onStage?.(name, 'skipped', 'already done');
        return existing;
      }
    }
    await options.onStage?.(name, 'started');
    try {
      const value = await work();
      if (checkpoint) await options.checkpoints.put(checkpoint, value);
      const missing = shortfall?.(value) ?? null;
      await options.onStage?.(name, missing ? 'failed' : 'completed', missing?.slice(0, 600));
      return value;
    } catch (error) {
      await options.onStage?.(name, 'failed', (error as Error).message.slice(0, 600));
      throw error;
    }
  };

  // 1. Forensics: everything that can be measured.
  const rawReport = await stage('forensics', 'forensics', () =>
    runForensics(options.filmPath, {
      ffmpeg: options.ffmpeg,
      outputPath: path.join(options.workDir, 'forensics.json'),
      ...(options.python ? { python: options.python } : {}),
      ...(options.context.signal ? { signal: options.context.signal } : {}),
      onProgress: (progress: ForensicsProgress) => options.onProgress?.('forensics', progress.progress, `${progress.stage}: ${progress.message}`),
    }),
  );
  const report = ForensicReport.parse(rawReport);

  /*
   * Stages that failed without stopping the analysis. The measurements stand
   * without a listener or a model, so the document is still compiled — and
   * the validator is told what is missing, so it is never called complete.
   * A cancellation is not one of these: it stops everything.
   */
  const stageFailures: string[] = [];
  const nonFatal = (name: AnalyzeStage) => (error: unknown): null => {
    if (options.context.signal?.aborted) throw error;
    stageFailures.push(`${name}: ${oneLine((error as Error).message ?? String(error)).slice(0, 300)}`);
    return null;
  };

  // 2. Transcription: what is said, by a dedicated recogniser.
  let asrProducer: Producer | null = null;
  const transcript = report.audio && options.recognizer
    ? await stage('transcription', 'transcript', async () => {
        const audioPath = path.join(options.workDir, 'speech.mp3');
        await runFfmpeg(options.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', options.filmPath, '-vn', '-map', `0:${report.probe.audio[0]!.index}`, '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', audioPath], options.context.signal);
        const bytes = new Uint8Array(await readFile(audioPath));
        const result = await options.recognizer!.transcribe({ audio: bytes, contentType: 'audio/mpeg', language: null }, options.context);
        return { text: result.text, language: result.language, words: result.words, segments: result.segments ?? [], model: result.model } satisfies TranscriptInput;
      }).catch(nonFatal('transcription')) // One listener among two: without it the document is partial, not wrong.
    : null;
  if (transcript) {
    asrProducer = {
      id: 'asr',
      kind: 'asr',
      name: 'Transcription',
      version: '1.0.0',
      model: transcript.model,
      status: 'completed',
      startedAt: null,
      finishedAt: null,
      inputHash: report.input.sha256,
      costUsd: null,
      notes: [],
    };
  }
  const narration = transcript && report.audio && asrProducer
    ? (() => {
        const samples = new SampleClock(report.audio!.rate, report.audio!.samples, report.audio!.firstPts, report.audio!.timebase);
        const built = buildNarration({ transcript, audio: report.audio!, samples, producer: asrProducer! });
        if (built.discarded > 0) asrProducer!.notes.push(`${built.discarded} word(s) discarded: heard over measured silence or in segments the recogniser marked as non-speech`);
        if (built.withheld.length > 0) asrProducer!.notes.push(`${built.withheld.length} run(s) of words withheld: no measured voice activity overlaps them`);
        return { ir: built.narration, producer: asrProducer!, methods: ASR_METHODS, withheld: built.withheld };
      })()
    : null;

  // The measured document, before any interpretation: the evidence the passes are shown.
  const measuredOnly = compileFilmIR({ id: options.id, title: options.title, report, narration });

  // 3–4. Upload and passes.
  let passes: Record<string, PassRecord> = {};
  const gemini = options.gemini;
  const file = gemini
    ? await stage('upload', null, async () => {
        const cached = await options.checkpoints.get<GeminiFile>('gemini-file');
        if (cached && !redo.has('upload')) {
          const alive = await gemini.fileStatus(cached.name, options.context).catch(() => null);
          if (alive) return alive;
        }
        const uploaded = await gemini.uploadVideo(options.filmPath, options.mimeType ?? 'video/mp4', `${options.id}`, options.context);
        await options.checkpoints.put('gemini-file', uploaded);
        return uploaded;
      }).catch(nonFatal('upload'))
    : null;
  // Passes an earlier attempt of this run already made, completed or failed.
  const earlierPasses = async (): Promise<Record<string, PassRecord>> => {
    const earlier: Record<string, PassRecord> = {};
    if (redo.has('passes')) return earlier;
    for (const id of EXPECTED_PASSES) {
      const record = await options.checkpoints.get<PassRecord>(`pass-${id}`);
      if (record) earlier[id] = record;
    }
    return earlier;
  };
  if (gemini && !file) {
    // Nothing to watch, so nothing new is asked; what an earlier attempt learned from these same bytes stands.
    passes = await earlierPasses();
    const missing = EXPECTED_PASSES.filter((id) => passes[id]?.status !== 'completed');
    await options.onStage?.('passes', 'failed', `Not run: the film could not be uploaded to the video model; ${missing.length} of ${EXPECTED_PASSES.length} passes missing.`);
  }
  if (gemini && file) {
    passes = await stage('passes', null, async () => {
      const existing = await earlierPasses();
      return runGeminiPasses({
        provider: gemini,
        file,
        document: measuredOnly.document,
        context: options.context,
        existing,
        extractFrames: (first, last) => extractExactFrames(options.filmPath, first, last, { workDir: options.workDir, ...(options.python ? { python: options.python } : {}) }),
        onRecord: async (record) => {
          await options.checkpoints.put(`pass-${record.id}`, record);
          options.onProgress?.('passes', Object.keys(existing).length / EXPECTED_PASSES.length, `${record.id} ${record.status}`);
        },
      });
    }, (records) => {
      const failed = Object.values(records).filter((record) => record.status !== 'completed');
      return failed.length === 0
        ? null
        : `${failed.length} of ${EXPECTED_PASSES.length} passes failed; retrying runs only these: ${failed.map((record) => `${record.id} (${oneLine(record.error ?? 'failed').slice(0, 160)})`).join('; ')}`;
    });
  }

  // 5. Compile: the measurements with the interpretation merged onto them.
  const pack = evidencePack(measuredOnly.document);
  const compiled = await stage('compile', null, async () =>
    compileFilmIR({
      id: options.id,
      title: options.title,
      report,
      narration,
      interpretation: Object.keys(passes).length > 0
        ? { apply: (document, measured) => mergeGemini(document, measured, passes, pack) }
        : null,
    }).document,
  );

  // 6. Validate.
  const { report: validation } = validateFilmIR(compiled, { expectedPasses: options.gemini ? EXPECTED_PASSES : [], stageFailures });
  const document: FilmIR = { ...compiled, validation };
  await options.checkpoints.put('filmir', document);
  await options.onStage?.('validate', 'completed', validation.status);
  const costUsd = Object.values(passes).reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  return { document, validation, passes, costUsd };
}

/** A provider's error on one line: they often carry the service's JSON body, indented. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A file-system checkpoint store: one JSON file per checkpoint, for the command line and tests. */
export function directoryCheckpoints(directory: string): Checkpoints {
  return {
    async get<T>(name: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async put(name: string, value: unknown): Promise<void> {
      const { writeFile } = await import('node:fs/promises');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${name}.json`), JSON.stringify(value));
    },
  };
}

function runFfmpeg(ffmpeg: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed: ${stderr.trim().split('\n').slice(-2).join(' ')}`));
    });
  });
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}
