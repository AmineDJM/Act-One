import { z } from 'zod';

/**
 * The Benchmark Library: reference films, and how far each one's reading got.
 *
 * A benchmark is a finished film a Super Admin put in the library so Act One
 * can learn from how it was made. The film lives in object storage, and so
 * does its FilmIR — the machine reading of the whole film — once one exists.
 * This record is what the library knows without opening either: where the
 * film is, what it is (duration, frame rate, sound), how far each stage of
 * its analysis got, how trustworthy the result is, and whether the future
 * Creative Director may retrieve it as a reference.
 *
 * Analysis runs as a job, stage by stage, each checkpointed to storage under
 * one run, so a crash, a deploy or a retry resumes where it stopped. A new
 * analysis is a new run: the previous FilmIR stays the library's until the
 * new one is complete.
 */
export const BENCHMARK_STAGES = ['validate', 'probe', 'forensics', 'transcription', 'upload', 'passes', 'compile', 'integrity'] as const;

/**
 * The forensic analyzer this code runs: ANALYZER_VERSION in
 * packages/film-ir/forensics/actone_forensics/common.py, which a test holds
 * it to. An analysis measured by another version says so in the console.
 */
export const BENCHMARK_ANALYZER_VERSION = '1.4.0';

/** The analyzer version an analysis was measured with, read back from its version string; null when it does not say. */
export function measuredWith(analysisVersion: string | null | undefined): string | null {
  return /(?:^| · )forensics (\S+)/.exec(analysisVersion ?? '')?.[1] ?? null;
}
export const BenchmarkStageId = z.enum(BENCHMARK_STAGES);
export type BenchmarkStageId = z.infer<typeof BenchmarkStageId>;

export const BENCHMARK_STAGE_LABELS: Record<BenchmarkStageId, string> = {
  validate: 'File validation',
  probe: 'Container probe',
  forensics: 'Deterministic forensics',
  transcription: 'Transcription',
  upload: 'Upload to the video model',
  passes: 'Multimodal passes',
  compile: 'Cross-validation and FilmIR compile',
  integrity: 'Schema and integrity validation',
};

export const BenchmarkStageStatus = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);
export type BenchmarkStageStatus = z.infer<typeof BenchmarkStageStatus>;

export const BenchmarkStage = z.object({
  status: BenchmarkStageStatus.default('pending'),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  /** What happened, for the console: an error, or why the stage was skipped. */
  detail: z.string().max(600).nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
});
export type BenchmarkStage = z.infer<typeof BenchmarkStage>;

export const BenchmarkStatus = z.enum(['uploaded', 'queued', 'analyzing', 'ready', 'partial', 'failed']);
export type BenchmarkStatus = z.infer<typeof BenchmarkStatus>;

/** Whether the Creative Director may use this film as a reference. */
export const BenchmarkRetrieval = z.enum(['enabled', 'disabled']);
export type BenchmarkRetrieval = z.infer<typeof BenchmarkRetrieval>;

export const BenchmarkContainer = z.enum(['mp4', 'mov', 'webm', 'mkv']);
export type BenchmarkContainer = z.infer<typeof BenchmarkContainer>;

export const BenchmarkSource = z.object({
  storageKey: z.string().min(1).max(400),
  /** As uploaded, cleaned of anything but letters, digits and simple punctuation. */
  fileName: z.string().min(1).max(200),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.string().max(80),
  /** From the file's own first bytes, never from its name. */
  container: BenchmarkContainer,
  uploadedByUserId: z.string().nullable(),
  uploadedAt: z.string(),
  /** Where the film came from: a URL or a note. */
  origin: z.string().max(500).nullable().default(null),
  /** The licence or permission it is held under. */
  rights: z.string().max(500).nullable().default(null),
});
export type BenchmarkSource = z.infer<typeof BenchmarkSource>;

export const BenchmarkMedia = z.object({
  durationSeconds: z.number().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** A rational rate, "25/1" or "30000/1001". */
  frameRate: z.string().max(40).nullable(),
  /** Declared by the container, or measured from the decoded frames' timestamps. */
  frameRateSource: z.enum(['declared', 'measured']).nullable(),
  frameCount: z.number().int().nonnegative().nullable(),
  variableFrameRate: z.boolean().nullable(),
  videoCodec: z.string().max(40).nullable(),
  container: z.string().max(80).nullable(),
  audio: z
    .object({
      codec: z.string().max(40),
      sampleRate: z.number().int().positive(),
      channels: z.number().int().positive(),
      integratedLufs: z.number().nullable(),
      truePeakDbtp: z.number().nullable(),
    })
    .nullable(),
});
export type BenchmarkMedia = z.infer<typeof BenchmarkMedia>;

export const BenchmarkCounts = z.object({
  shots: z.number().int().nonnegative(),
  boundaries: z.number().int().nonnegative(),
  textBlocks: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  contradictions: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  uncertainties: z.number().int().nonnegative(),
});
export type BenchmarkCounts = z.infer<typeof BenchmarkCounts>;

export const BenchmarkAnalysis = z.object({
  /** The run whose checkpoints are in use. A new analysis is a new run. */
  runId: z.string().nullable().default(null),
  jobId: z.string().nullable().default(null),
  /** Schema, analyzer, passes and validator versions the current FilmIR was made with. */
  version: z.string().max(200).nullable().default(null),
  requestedAt: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  deterministic: z.enum(['pending', 'running', 'completed', 'failed']).default('pending'),
  gemini: z.enum(['pending', 'running', 'completed', 'partial', 'failed', 'skipped']).default('pending'),
  passesCompleted: z.number().int().nonnegative().default(0),
  passesExpected: z.number().int().nonnegative().default(0),
  filmIr: z.enum(['pending', 'ready', 'partial', 'failed']).default('pending'),
  /** Mean confidence of the values that are known. */
  meanConfidence: z.number().min(0).max(1).nullable().default(null),
  /** Share of evidenced values that are not UNKNOWN. */
  knownShare: z.number().min(0).max(1).nullable().default(null),
  evidenceMix: z.record(z.string(), z.number().int().nonnegative()).default({}),
  warnings: z.array(z.string().max(400)).max(40).default([]),
  failures: z.array(z.string().max(400)).max(40).default([]),
  counts: BenchmarkCounts.nullable().default(null),
  costUsd: z.number().nonnegative().default(0),
  /** The last complete FilmIR. Stays in place while a new run is under way. */
  filmIrKey: z.string().max(400).nullable().default(null),
  validationKey: z.string().max(400).nullable().default(null),
  filmIrBytes: z.number().int().nonnegative().nullable().default(null),
  lastAnalyzedAt: z.string().nullable().default(null),
});
export type BenchmarkAnalysis = z.infer<typeof BenchmarkAnalysis>;

export const Benchmark = z.object({
  id: z.string().regex(/^bmk_[a-z0-9]+$/),
  title: z.string().trim().min(1).max(200),
  status: BenchmarkStatus.default('uploaded'),
  retrieval: BenchmarkRetrieval.default('enabled'),
  source: BenchmarkSource,
  media: BenchmarkMedia.nullable().default(null),
  stages: z.record(BenchmarkStageId, BenchmarkStage),
  analysis: BenchmarkAnalysis,
  notes: z.string().max(4000).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Benchmark = z.infer<typeof Benchmark>;

export function freshStages(): Record<BenchmarkStageId, BenchmarkStage> {
  return Object.fromEntries(BENCHMARK_STAGES.map((id) => [id, BenchmarkStage.parse({})])) as Record<BenchmarkStageId, BenchmarkStage>;
}

/** Where a benchmark's files live. One prefix per film, one per run beneath it. */
export function benchmarkKeys(id: string, runId?: string | null) {
  const root = `platform/benchmarks/${id}`;
  const run = runId ? `${root}/runs/${runId}` : null;
  return {
    root,
    source: (container: BenchmarkContainer) => `${root}/source.${container}`,
    run,
    checkpoints: run ? `${run}/checkpoints` : null,
    filmIr: run ? `${run}/FilmIR.json` : null,
    validation: run ? `${run}/validation.json` : null,
  };
}

export const BENCHMARK_CONTENT_TYPES: Record<BenchmarkContainer, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

/**
 * What a film is, from its first bytes.
 *
 * ISO base media files (MP4, MOV, M4V) open with a box whose type is `ftyp`;
 * Matroska and WebM open with the EBML magic number and name their document
 * type in the header that follows. A name or a declared content type is what
 * the uploader says; this is what the file says.
 */
export function sniffContainer(head: Uint8Array): BenchmarkContainer | null {
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    return ascii(head, 8, 12) === 'qt  ' ? 'mov' : 'mp4';
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return ascii(head, 0, Math.min(head.length, 64)).includes('webm') ? 'webm' : 'mkv';
  }
  return null;
}

/** A file name safe to show and to store beside the film: no path, no control characters, bounded. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Letters, digits, spaces, dashes of any kind and a little harmless punctuation; anything else becomes "_".
  const cleaned = base.normalize('NFC').replace(/[^\p{L}\p{N}\p{Pd}._ (),'&+]+/gu, '_').replace(/_+/g, '_').trim().slice(0, 160);
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : 'film';
}

/**
 * A readable title from a file name, until someone writes a better one.
 * Underscores are spaces; hyphens are, in a name that has no spaces of its
 * own; a dot between two digits is a version number and stays.
 */
export function titleFromFileName(name: string): string {
  const stem = cleanFileName(name).replace(/\.[A-Za-z0-9]{2,4}$/, '');
  let title = stem.replace(/_+/g, ' ');
  if (!/\s/.test(stem)) title = title.replace(/-+/g, ' ');
  title = title.replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  return (title || 'Untitled film').slice(0, 200);
}

/** A film the Creative Director may learn from: analysed, complete enough, and not switched off. */
export function benchmarkRetrievable(benchmark: Benchmark): boolean {
  return benchmark.retrieval === 'enabled' && (benchmark.status === 'ready' || benchmark.status === 'partial') && benchmark.analysis.filmIrKey !== null;
}

/** Whether an analysis may be started now: never twice at once. */
export function benchmarkBusy(benchmark: Benchmark): boolean {
  return benchmark.status === 'queued' || benchmark.status === 'analyzing';
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}
