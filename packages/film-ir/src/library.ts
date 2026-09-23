import type { BenchmarkCounts, BenchmarkMedia } from '@act-one/core';
import type { StorageProvider } from '@act-one/providers';
import type { Checkpoints } from './analyze.ts';
import type { ForensicProbe } from './forensics/report.ts';
import { FILM_IR_SCHEMA, FILM_IR_VERSION, type FilmIR, type ValidationReport } from './schema/document.ts';
import { toSeconds } from './time.ts';
import { VALIDATOR_VERSION } from './validate.ts';

/**
 * What the Benchmark Library needs from a FilmIR, and where it keeps one.
 *
 * The library row is read hundreds of times for every time a FilmIR is
 * opened, so the facts the console lists — what the film is, how complete and
 * how trustworthy its reading — are summarised here once, when the analysis
 * finishes, rather than parsed out of a document of tens of megabytes on
 * every page view.
 */

/** Checkpoints as JSON objects under one prefix of object storage: every stage survives the machine that ran it. */
export function storageCheckpoints(storage: StorageProvider, prefix: string): Checkpoints {
  const key = (name: string) => `${prefix.replace(/\/$/, '')}/${name}.json`;
  return {
    async get<T>(name: string): Promise<T | null> {
      if (!(await storage.exists(key(name)))) return null;
      const bytes = await storage.get(key(name));
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch {
        // A checkpoint cut off mid-write is no checkpoint: the stage runs again.
        return null;
      }
    },
    async put(name: string, value: unknown): Promise<void> {
      await storage.put(key(name), new TextEncoder().encode(JSON.stringify(value)), { contentType: 'application/json', visibility: 'private' });
    },
  };
}

/** The media facts as the container declares them: available seconds after upload. */
export function mediaFromProbe(probe: ForensicProbe): BenchmarkMedia {
  const video = probe.video;
  const rate = video.averageFrameRate ?? video.baseFrameRate;
  const audio = probe.audio[0];
  const declaredSeconds = probe.containerDuration ? toSeconds(probe.containerDuration) : null;
  return {
    durationSeconds: declaredSeconds === null ? null : round(declaredSeconds, 3),
    width: video.width,
    height: video.height,
    frameRate: rate ? `${rate.num}/${rate.den}` : null,
    frameRateSource: rate ? 'declared' : null,
    frameCount: video.declaredFrameCount,
    variableFrameRate: null,
    videoCodec: video.codec,
    container: probe.formatName,
    audio: audio ? { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.channels, integratedLufs: null, truePeakDbtp: null } : null,
  };
}

/** The media facts as measured on the decoded frames and samples. They replace the declarations. */
export function mediaFromDocument(document: FilmIR, fallback: BenchmarkMedia | null): BenchmarkMedia {
  const source = document.source;
  const timing = source?.frameTiming ?? null;
  const common = timing?.distinctDurations.slice().sort((a, b) => b.count - a.count)[0] ?? null;
  const timescale = document.frames?.timescale ?? null;
  const measuredRate = common && timescale ? reduce(timescale, Number(common.ticks)) : null;
  const start = timing?.firstPts ?? null;
  const end = timing?.lastPtsEnd ?? null;
  const audio = source?.audio[0];
  return {
    durationSeconds: start && end ? round(toSeconds(end) - toSeconds(start), 3) : fallback?.durationSeconds ?? null,
    width: source?.video?.width ?? fallback?.width ?? null,
    height: source?.video?.height ?? fallback?.height ?? null,
    frameRate: measuredRate ?? fallback?.frameRate ?? null,
    frameRateSource: measuredRate ? 'measured' : fallback?.frameRateSource ?? null,
    frameCount: timing?.decodedFrames ?? fallback?.frameCount ?? null,
    variableFrameRate: timing?.variableFrameRate ?? null,
    videoCodec: source?.video?.codec ?? fallback?.videoCodec ?? null,
    container: source?.formatName ?? fallback?.container ?? null,
    audio: audio
      ? {
          codec: audio.codec,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          integratedLufs: document.audio.loudness?.integratedLufs.value ?? null,
          truePeakDbtp: document.audio.loudness?.truePeakDbtp.value ?? null,
        }
      : null,
  };
}

export type FilmIrSummary = {
  evidenceMix: Record<string, number>;
  meanConfidence: number | null;
  knownShare: number | null;
  counts: BenchmarkCounts;
  warnings: string[];
  failures: string[];
};

/**
 * How complete and how trustworthy a reading is, in the terms the library lists.
 *
 * Confidence is the mean over values that are known, and never the whole
 * story alone: a document that says UNKNOWN to everything it cannot measure
 * has high confidence in very little, which is what `knownShare` shows.
 *
 * The mix, the share and the confidence are all over values — claims with a
 * value — so the library's bar and its "known" figure describe the same
 * things. The validator's own mix also counts the provenance of every
 * measured series and track column, which is almost never unknown and would
 * make a film look more known than it is; it stays in the validation report.
 */
export function summarizeFilmIR(document: FilmIR, validation: ValidationReport): FilmIrSummary {
  let known = 0;
  let total = 0;
  let confidenceSum = 0;
  const mix: Record<string, number> = {};
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record['evidenceType'] === 'string' && typeof record['confidence'] === 'number' && 'value' in record) {
      total += 1;
      mix[record['evidenceType']] = (mix[record['evidenceType']] ?? 0) + 1;
      if (record['evidenceType'] !== 'UNKNOWN') {
        known += 1;
        confidenceSum += record['confidence'];
      }
    }
    for (const child of Object.values(record)) if (child && typeof child === 'object') visit(child);
  };
  visit(document);
  return {
    evidenceMix: mix,
    meanConfidence: known > 0 ? round(confidenceSum / known, 3) : null,
    knownShare: total > 0 ? round(known / total, 3) : null,
    counts: {
      shots: document.structure.shots.length,
      boundaries: document.structure.boundaries.length,
      textBlocks: document.typography.blocks.length,
      objects: document.objects.length,
      events: document.events.events.length,
      contradictions: document.contradictions.length,
      unsupported: document.unsupported.length,
      uncertainties: document.uncertainties.length,
    },
    warnings: validation.checks.filter((check) => check.status === 'warn').map((check) => `${check.title}: ${check.message}`.slice(0, 400)),
    failures: validation.checks.filter((check) => check.status === 'fail').map((check) => `${check.title}: ${check.message}`.slice(0, 400)),
  };
}

/** Everything that decides what a FilmIR says, in one string: two documents with the same version were made the same way. */
export function analysisVersion(document: FilmIR): string {
  const analyzer = document.producers.find((producer) => producer.kind === 'analyzer')?.version ?? 'none';
  const models = [...new Set(document.producers.filter((producer) => producer.kind === 'model_pass' || producer.kind === 'integrator').map((producer) => producer.model).filter(Boolean))];
  return [`${FILM_IR_SCHEMA} ${FILM_IR_VERSION}`, `forensics ${analyzer}`, `validator ${VALIDATOR_VERSION}`, models.length ? `model ${models.join('+')}` : 'no model'].join(' · ').slice(0, 200);
}

function reduce(numerator: number, denominator: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator) || 1;
  return `${numerator / divisor}/${denominator / divisor}`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
