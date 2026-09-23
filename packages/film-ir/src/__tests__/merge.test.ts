import { describe, expect, it } from 'vitest';
import { evidencePack } from '../gemini/evidence-pack.ts';
import { MODEL_CONFIDENCE_CEILING, mergeGemini } from '../gemini/merge.ts';
import type { FilmIR } from '../schema/document.ts';
import { toSeconds } from '../time.ts';
import { validateFilmIR } from '../validate.ts';
import { EXPECTED_PASSES } from '../analyze.ts';
import { completedRecords, syntheticDocument } from './helpers.ts';

/**
 * The gate every interpretation passes through. The synthetic film is known
 * exactly — a static title until the cut at 1.6 s, "NEW FEATURE" fading in
 * over 2.0–2.4 s, a fade to black from 3.2 s, no voice, no camera — so each
 * test offers one claim and checks what the merge did with it.
 */
const base = syntheticDocument();
const pack = evidencePack(base.document);
const merge = (overrides: Parameters<typeof completedRecords>[0]) => {
  const merged = mergeGemini(base.document, base.measured, completedRecords(overrides), pack);
  const document: FilmIR = {
    ...merged.document,
    producers: [...merged.document.producers, ...merged.producers.filter((p) => !merged.document.producers.some((q) => q.id === p.id))],
    methods: [...merged.document.methods, ...merged.methods.filter((m) => !merged.document.methods.some((n) => n.id === m.id))],
  };
  return document;
};
const claim = (value: string, evidence: string[], confidence = 0.9) => ({ value, evidence, confidence });

describe('mergeGemini', () => {
  it('keeps nothing that cites nothing real', () => {
    const doc = merge({ p02_narrative: { beats: [{ startSeconds: 0.5, endSeconds: 1.5, function: 'hook', summary: 'the title', shotIds: ['shot.999'], evidence: ['text.9999'], confidence: 0.9 }] } });
    expect(doc.structure.beats).toEqual([]);
    expect(doc.unsupported).toContainEqual(expect.objectContaining({ sourceRef: 'pass:p02_narrative', reason: 'no evidence cited that exists' }));
  });

  it('keeps a beat that starts where the film measurably changes, under the confidence ceiling', () => {
    const doc = merge({
      p02_narrative: {
        beats: [
          { startSeconds: 1.6, endSeconds: 3.2, function: 'reveal', summary: 'the feature', shotIds: ['shot.002'], evidence: ['boundary.001'], confidence: 0.99 },
          { startSeconds: 0.8, endSeconds: 1.6, function: 'hook', summary: 'mid-title', shotIds: ['shot.001'], evidence: ['shot.001'], confidence: 0.99 },
        ],
      },
    });
    const [reveal, hook] = doc.structure.beats;
    expect(toSeconds(reveal!.range.value!.start)).toBeCloseTo(1.6, 6);
    expect(reveal!.function).toMatchObject({ evidenceType: 'INFERRED', value: 'reveal', confidence: MODEL_CONFIDENCE_CEILING });
    // Nothing changes near 0.8 s: kept, but lower, and saying why.
    expect(hook!.function.confidence).toBeCloseTo(MODEL_CONFIDENCE_CEILING * 0.7, 3);
    expect(hook!.range.note).toMatch(/nothing measurable changes/);
  });

  it('records a second reading of the type that disagrees with OCR, and trusts the OCR less', () => {
    const before = base.document.typography.blocks[1]!.text.confidence;
    const doc = merge({ p03_composition: { textBlocks: [{ id: 'text.0002', classification: 'product_copy', role: 'headline', reading: 'NEW FEATURES', fontCategory: 'geometric sans', confidence: 0.9 }] } });
    const block = doc.typography.blocks[1]!;
    expect(block.classification).toMatchObject({ value: 'product_copy', evidenceType: 'INFERRED' });
    expect(block.metrics.fontCategory.confidence).toBeLessThanOrEqual(0.6);
    expect(block.metrics.fontFamily.value).toBeNull();
    expect(block.text.confidence).toBeLessThan(before);
    expect(doc.contradictions).toContainEqual(expect.objectContaining({ refs: ['text:text.0002', 'pass:p03_composition'], resolution: 'confidence_reduced' }));
  });

  it('keeps the measurement when a camera move is claimed where the camera is unobservable', () => {
    const doc = merge({ p04_camera_motion: { cameraMoves: [{ id: null, interpretation: 'a slow push in', agent: 'camera', evidence: ['window:2.0-2.4'], confidence: 0.8 }] } });
    expect(doc.camera?.moves ?? []).toEqual([]);
    expect(doc.contradictions).toContainEqual(expect.objectContaining({ refs: ['shot:shot.002', 'pass:p04_camera_motion'], resolution: 'measurement_kept' }));
  });

  it('labels no sound effect where no transient was measured, and hears no speech where no voice was', () => {
    const doc = merge({
      p05_audio: {
        transcript: { text: 'welcome to the launch', language: 'en', confidence: 0.8 },
        soundEffects: [{ id: null, atSeconds: 3.0, label: 'whoosh', evidence: ['window:2.9-3.1'], confidence: 0.8 }],
      },
    });
    expect(doc.narration.transcript.value).toBeNull();
    expect(doc.unsupported.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'no transient was measured within 150 ms',
      'no speech-like signal was measured anywhere in the film',
    ]));
  });

  it('accepts a change without a cut only where the picture measurably changes', () => {
    const doc = merge({
      p07_transitions: {
        continuousChanges: [
          { startSeconds: 2.0, endSeconds: 2.4, technique: 'type fades in', handover: ['preservation'], description: 'the headline fades up over the field', evidence: ['text.0002'], confidence: 0.8 },
          { startSeconds: 0.4, endSeconds: 1.2, technique: 'slow zoom', handover: ['motion_handover'], description: 'the title drifts', evidence: ['shot.001'], confidence: 0.8 },
        ],
      },
    });
    expect(doc.structure.transitions.map((transition) => transition.technique.value)).toEqual(['type fades in']);
    expect(doc.unsupported).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/^nothing measurably changes in that window/) }));
  });

  it('interprets a measured sync cluster and refuses one that does not exist', () => {
    const doc = merge({
      p06_sync: {
        clusters: [
          { id: 'sync.0001', interpretation: 'the title lands with the first tone', deliberate: true, evidence: ['sync.0001'], confidence: 0.7 },
          { id: 'sync.0099', interpretation: 'an imagined hit', deliberate: true, evidence: [], confidence: 0.7 },
        ],
      },
    });
    expect(doc.events.clusters.find((cluster) => cluster.id === 'sync.0001')!.interpretation?.value).toBe('the title lands with the first tone');
    expect(doc.unsupported).toContainEqual(expect.objectContaining({ claim: expect.stringContaining('sync.0099'), reason: 'no such cluster' }));
  });

  it('turns a disagreement only one pass is named in into a note, and one between two into a contradiction', () => {
    const doc = merge({
      integrator: {
        conflicts: [
          { description: 'the opening is read as calm and as tense', passes: ['p02_narrative', 'p08_moments'], resolution: 'calm, from the measured energy' },
          { description: 'a vague doubt', passes: ['p01_holistic'], resolution: 'none' },
        ],
      },
    });
    expect(doc.contradictions.filter((contradiction) => contradiction.refs.includes('pass:p08_moments'))).toHaveLength(1);
    expect(doc.interpretation!.observations.some((observation) => observation.topic === 'conflict' && observation.text.value?.startsWith('a vague doubt'))).toBe(true);
  });

  it('holds every interpretation under the ceiling and leaves a document that validates', () => {
    const doc = merge({
      p01_holistic: { summary: 'A title card, a cut, a feature name fading up, a fade to black.', subject: claim('a feature launch', ['text.0002'], 1), format: claim('title sequence', ['shot.001'], 1) },
      p08_moments: { moments: [{ title: 'the reveal', startSeconds: 2.0, endSeconds: 2.4, description: 'the name fades up', whyItWorks: 'it follows the tone', evidence: ['text.0002'], confidence: 1 }] },
    });
    const inferred: number[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record['evidenceType'] === 'INFERRED' && typeof record['confidence'] === 'number') inferred.push(record['confidence']);
      Object.values(record).forEach(visit);
    };
    visit(doc);
    expect(inferred.length).toBeGreaterThan(3);
    expect(Math.max(...inferred)).toBeLessThanOrEqual(MODEL_CONFIDENCE_CEILING);

    const { report } = validateFilmIR(doc, { expectedPasses: EXPECTED_PASSES });
    expect(report.checks.filter((check) => check.status === 'fail')).toEqual([]);
    // The other passes answered with nothing at all, and the validator says so: partial, never ready.
    expect(report.status).toBe('PARTIAL');
    const passes = report.checks.find((check) => check.id === 'passes')!;
    expect(passes.status).toBe('warn');
    expect(passes.examples).toContain('p02_narrative returned nothing usable');
    expect(passes.examples.some((example) => example.startsWith('p01_holistic'))).toBe(false);
  });

  it('marks a pass that never ran as absent rather than empty-handed', () => {
    const records = completedRecords();
    delete records['p08_moments'];
    const merged = mergeGemini(base.document, base.measured, records, pack);
    expect(merged.document.uncertainties).toContainEqual(expect.objectContaining({ reason: 'not_analyzed', description: expect.stringMatching(/memorable moments/i) }));
    expect(merged.document.interpretation!.dna.openingStrategy.evidenceType).toBe('UNKNOWN');
  });
});
