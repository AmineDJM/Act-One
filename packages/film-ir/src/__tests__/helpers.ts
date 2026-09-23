import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFilmIR } from '../compile/index.ts';
import type { Measured } from '../compile/deterministic.ts';
import { ForensicReport } from '../forensics/report.ts';
import type { PassRecord } from '../gemini/run.ts';
import type { PassId } from '../gemini/passes.ts';
import type { FilmIR } from '../schema/document.ts';
import type { Producer } from '../schema/source.ts';

/** The analyzer's report on the synthetic film; see compile-validate.test.ts for what it contains. */
export function syntheticReport(): ForensicReport {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return ForensicReport.parse(JSON.parse(readFileSync(path.join(here, 'fixtures', 'synthetic-report.json'), 'utf8')));
}

export function syntheticDocument(): { document: FilmIR; measured: Measured; report: ForensicReport } {
  const report = syntheticReport();
  const { document, measured } = compileFilmIR({ id: 'bench_synthetic', title: 'synthetic', report, createdAt: '2026-09-23T00:00:00.000Z' });
  return { document, measured, report };
}

const claim = { value: null, evidence: [], confidence: 0 };

/** A valid answer to every pass that says nothing: the baseline a test adds one claim to. */
export function blankAnswers(): Record<PassId | 'integrator', Record<string, unknown>> {
  return {
    p01_holistic: { summary: '', subject: claim, format: claim, language: claim, audience: claim, structureOverview: '' },
    p02_narrative: { thesis: claim, arc: claim, acts: [], beats: [], scenes: [] },
    p03_composition: { textBlocks: [], productShown: claim, productRegions: [], productMoments: [], shots: [] },
    p04_camera_motion: { cameraMoves: [], objectMotion: [], depth: [], motionPhilosophy: claim, cameraPhilosophy: claim, inspect: [] },
    p05_audio: {
      transcript: { text: null, language: null, confidence: 0 },
      speakers: [],
      music: { present: null, description: null, instrumentation: [], evidence: [], confidence: 0 },
      musicSections: [],
      soundEffects: [],
      ambience: claim,
      silence: claim,
      soundPhilosophy: claim,
    },
    p06_sync: { clusters: [], relationships: [], inspect: [] },
    p07_transitions: { boundaries: [], continuousChanges: [], continuity: claim, transitionPhilosophy: claim, inspect: [] },
    p08_moments: { moments: [], creativeIntent: claim, openingStrategy: claim, heroStrategy: claim, resolutionStrategy: claim },
    p09_reconstruction: { strategy: claim, shots: [], notes: [] },
    p10_grammar: { mechanisms: [], signatures: [] },
    integrator: {
      dna: Object.fromEntries(
        ['thesis', 'narrativeArc', 'mood', 'brandPosture', 'visualPhilosophy', 'typographyPhilosophy', 'motionPhilosophy', 'cameraPhilosophy', 'soundPhilosophy', 'productCinematographyPhilosophy', 'transitionPhilosophy', 'attentionStrategy', 'openingStrategy', 'heroStrategy', 'resolutionStrategy'].map((key) => [key, claim]),
      ),
      choices: [],
      curves: { narrativeTension: [], emotionalIntensity: [], informationDensity: [] },
      conflicts: [],
    },
  };
}

/** Completed records for every pass, with the given outputs merged over blank ones. */
export function completedRecords(overrides: Partial<Record<PassId | 'integrator', Record<string, unknown>>> = {}): Record<string, PassRecord> {
  const answers = blankAnswers();
  const records: Record<string, PassRecord> = {};
  for (const [id, output] of Object.entries(answers)) {
    records[id] = {
      id: id as PassRecord['id'],
      title: id,
      status: 'completed',
      model: 'test-model',
      output: { ...output, ...(overrides[id as PassId] ?? {}) },
      error: null,
      costUsd: 0,
      tokens: 0,
      startedAt: '2026-09-23T00:00:00.000Z',
      finishedAt: '2026-09-23T00:00:01.000Z',
      inspections: [],
      fps: id === 'integrator' ? null : 1,
    };
  }
  return records;
}

export const ASR_PRODUCER: Producer = {
  id: 'asr',
  kind: 'asr',
  name: 'Transcription',
  version: '1.0.0',
  model: 'whisper-1',
  status: 'completed',
  startedAt: null,
  finishedAt: null,
  inputHash: null,
  costUsd: null,
  notes: [],
};
