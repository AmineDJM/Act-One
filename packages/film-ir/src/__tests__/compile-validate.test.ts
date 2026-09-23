import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileFilmIR } from '../compile/index.ts';
import { ForensicReport } from '../forensics/report.ts';
import { filmIrJsonSchema } from '../json-schema.ts';
import type { FilmIR } from '../schema/document.ts';
import { rt, sameTime, toSeconds } from '../time.ts';
import { validateFilmIR } from '../validate.ts';

/**
 * The compiler and the validator on a film whose every fact is known.
 *
 * The fixture is the analyzer's report on the synthetic film written by
 * `python3 -m actone_forensics.synthetic` (see that module for the truth:
 * a cut at frame 40, "NEW FEATURE" fading in over frames 50–59, "Deploy in
 * minutes" cutting in at 65, a fade to black over frames 80–89, a cut to
 * "SEARCH" at 100, a click at 1.6 s). Regenerate it with the analyzer
 * whenever the report format changes:
 *
 *   python3 -m actone_forensics.synthetic /tmp/film.mp4
 *   python3 -m actone_forensics.analyze /tmp/film.mp4 fixtures/synthetic-report.json --ffmpeg …
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const report = ForensicReport.parse(JSON.parse(readFileSync(path.join(here, 'fixtures', 'synthetic-report.json'), 'utf8')));
const FRAME = rt(512, 12800);
const at = (frame: number) => rt(512 * frame, 12800);

let document: FilmIR;

beforeAll(() => {
  document = compileFilmIR({ id: 'bench_synthetic', title: 'synthetic', report, createdAt: '2026-09-23T00:00:00.000Z' }).document;
});

const seconds = (time: { ticks: string; timescale: number } | null | undefined) => (time ? toSeconds(time) : null);

describe('compiling the synthetic film', () => {
  it('keeps the stream\'s own clock for every frame', () => {
    expect(document.frames?.count).toBe(125);
    expect(document.frames?.timescale).toBe(12800);
    expect(document.frames?.pts.slice(0, 3)).toEqual(['0', '512', '1024']);
    expect(document.source?.frameTiming?.variableFrameRate).toBe(false);
  });

  it('places the cut as an instant between frames 39 and 40', () => {
    const cut = document.structure.boundaries.find((boundary) => boundary.kind.value === 'hard_cut')!;
    expect(cut.frames).toEqual({ lastOutgoing: 39, firstIncoming: 40 });
    expect(sameTime(cut.at, at(40))).toBe(true);
    expect(sameTime(cut.range.start, cut.range.end)).toBe(true);
    expect(sameTime(cut.range.start, at(40))).toBe(true);
  });

  it('gives the fade to black exactly the frames it ramps over', () => {
    const fade = document.structure.boundaries.find((boundary) => boundary.kind.value === 'fade_out')!;
    expect(fade.frames).toEqual({ lastOutgoing: 79, firstIncoming: 90 });
    // After frame 79 ends and before frame 90 begins: 3.2 s to 3.6 s.
    expect(sameTime(fade.range.start, at(80))).toBe(true);
    expect(sameTime(fade.range.end, at(90))).toBe(true);
    expect(document.structure.shots.map((shot) => [shot.frames.first, shot.frames.last])).toEqual([[0, 39], [40, 79], [90, 99], [100, 124]]);
  });

  it('reads every line of type whole, spaced, and times it to the frame', () => {
    const texts = document.typography.blocks.map((block) => block.text.value);
    expect(texts).toEqual(['LAUNCH DAY', 'NEW FEATURE', 'Deploy in minutes', 'SEARCH']);
    const feature = document.typography.blocks[1]!;
    expect(seconds(feature.timing.firstVisible.value)).toBeCloseTo(2.0, 6);
    expect(seconds(feature.timing.p50.value)).toBeCloseTo(2.2, 6);
    expect(seconds(feature.timing.settled.value)).toBeCloseTo(2.4, 6);
    expect(seconds(feature.timing.exitStart.value)).toBeCloseTo(3.2, 6);
    expect(seconds(feature.timing.lastVisible.value)).toBeCloseTo(3.56, 6);
    // A milestone is known to the frame, not more finely: its bounds are the frame before and the frame itself.
    expect(feature.timing.firstVisible.evidenceType).toBe('MEASURED');
    expect(seconds(feature.timing.firstVisible.lowerBound)).toBeCloseTo(2.0 - toSeconds(FRAME), 6);
    // Font family is never guessed.
    expect(feature.metrics.fontFamily.evidenceType).toBe('UNKNOWN');
    expect(feature.metrics.fontFamily.value).toBeNull();
  });

  it('tells a line that pops on inside a shot from one that arrives with a cut', () => {
    const [launch, , deploy, search] = document.typography.blocks;
    expect(deploy!.enter.opacity).toMatchObject({ evidenceType: 'MEASURED', value: { from: 1, to: 1 } });
    expect(deploy!.enter.opacity.note).toMatch(/whole on one frame and absent on the frame before, inside the shot/);
    expect(seconds(deploy!.timing.firstVisible.value)).toBeCloseTo(2.6, 6);
    for (const block of [launch!, search!]) expect(block.enter.opacity.note).toMatch(/arrives with a boundary/);
  });

  it('measures where the type sits to a fraction of a pixel, and bounds its size and weight', () => {
    // The truth of the clean render, printed by the generator: baseline, cap height, x-height; size in px; weight class.
    const truth = [
      { baseline: 101, cap: 22, x: null, size: 30, weight: 700 },
      { baseline: 100, cap: 20, x: null, size: 28, weight: 700 },
      { baseline: 145, cap: 13, x: 10, size: 18, weight: 400 },
      { baseline: 107, cap: 32, x: null, size: 44, weight: 700 },
    ];
    document.typography.blocks.forEach((block, i) => {
      const want = truth[i]!;
      const line = block.lines[0]!;
      expect(line.baselineY.evidenceType).toBe('MEASURED');
      expect(Math.abs(line.baselineY.value! - want.baseline)).toBeLessThan(0.15);
      expect(Math.abs(block.metrics.capHeightPx.value! - want.cap)).toBeLessThan(0.15);
      if (want.x === null) expect(block.metrics.xHeightPx!.evidenceType).toBe('UNKNOWN');
      else expect(Math.abs(block.metrics.xHeightPx!.value! - want.x)).toBeLessThan(0.15);
      const size = block.metrics.approxSizePx;
      expect(size.evidenceType).toBe('ESTIMATED');
      expect(size.lowerBound!).toBeLessThanOrEqual(want.size);
      expect(size.upperBound!).toBeGreaterThanOrEqual(want.size);
      const weight = block.metrics.approxWeight;
      if (block.metrics.capHeightPx.value! < 16) {
        // Stems of a pixel or two are not trusted to tell a weight.
        expect(weight.evidenceType).toBe('UNKNOWN');
      } else {
        expect(weight.evidenceType).toBe('ESTIMATED');
        expect(weight.lowerBound!).toBeLessThanOrEqual(want.weight);
        expect(weight.upperBound!).toBeGreaterThanOrEqual(want.weight);
      }
    });
  });

  it('hears the click on the cut, the tones\' starts and nothing at their ends', () => {
    const onsets = document.audio.events.filter((event) => event.kind === 'onset' || event.kind === 'transient').map((event) => toSeconds(event.at));
    expect(onsets).toHaveLength(3);
    expect(onsets[0]).toBeCloseTo(0, 3);
    expect(Math.abs(onsets[1]! - 1.6)).toBeLessThan(0.002);
    expect(Math.abs(onsets[2]! - 2.0)).toBeLessThan(0.002);
  });

  it('finds the silences to within a few milliseconds', () => {
    const silences = document.sound.silences.map((silence) => [toSeconds(silence.range.start), toSeconds(silence.range.end)]);
    // The last runs to the end of the decoded audio, which AAC pads out to a whole 1024-sample frame.
    const end = report.audio!.samples / report.audio!.rate;
    const expected = [[1.0, 1.6], [1.605, 2.0], [3.2, end]];
    expect(silences).toHaveLength(3);
    silences.forEach(([start, end], i) => {
      // The encoder's decay after a tone ends is real signal: up to 12 ms of it.
      expect(Math.abs(start! - expected[i]![0]!)).toBeLessThan(0.012);
      expect(Math.abs(end! - expected[i]![1]!)).toBeLessThan(0.012);
    });
  });

  it('never lets a music heuristic claim certainty, however strong its statistic', () => {
    // The same film, as if it were unmistakably music with a strong period, a clear key and a strong accent.
    const loud = structuredClone(report);
    const audio = loud.audio!;
    audio.series['music_probability'] = audio.series['rms_db']!.map(() => 1);
    const onset = audio.events[0]!;
    audio.events = Array.from({ length: 12 }, (_, i) => ({ ...onset, sample: i * 24_000 }));
    audio.tempo = { bpm: 120, strength: 0.95 };
    audio.beats = Array.from({ length: 8 }, (_, i) => ({ sample: i * 24_000, snapped: true }));
    audio.downbeat = { phase: 0, contrast: 5 };
    audio.key = { key: 'A major', correlation: 0.97, margin: 0.6, runnerUp: 'E major' };
    const music = compileFilmIR({ id: 'bench_synthetic_music', title: 'synthetic', report: loud, createdAt: '2026-09-23T00:00:00.000Z' }).document.sound.music;

    expect(music.tempoBpm).toMatchObject({ evidenceType: 'ESTIMATED', value: 120, confidence: 0.8 });
    expect(music.tempoBpm.note).toMatch(/half or double this tempo is not excluded/);
    expect(music.key).toMatchObject({ evidenceType: 'ESTIMATED', value: 'A major', confidence: 0.7 });
    expect(music.beats.provenance.confidence).toBe(0.8);
    expect(music.downbeats.provenance.confidence).toBe(0.6);
    expect(music.present.confidence).toBe(0.8);
  });

  it('calls no tempo, beat or key where two tones and a click establish none', () => {
    expect(document.sound.music.tempoBpm).toMatchObject({ evidenceType: 'UNKNOWN', value: null });
    expect(document.sound.music.tempoBpm.note).toMatch(/too few to establish a period/);
    expect(document.sound.music.beats.times).toEqual([]);
    expect(document.events.events.some((event) => event.type === 'music.beat')).toBe(false);
    expect(document.sound.music.key).toMatchObject({ evidenceType: 'UNKNOWN', value: null });
    expect(document.sound.music.present.confidence).toBeLessThanOrEqual(0.8);
  });

  it('claims no voice and no narration where there is none', () => {
    expect(document.audio.events.some((event) => event.kind === 'voice_start')).toBe(false);
    expect(document.narration.words).toHaveLength(0);
  });

  it('reports pitch only where it can see it: 440 Hz, and unknown above its range', () => {
    const pitch = document.audio.series.find((series) => series.id === 'audio.pitch_hz')!;
    const step = 0.01;
    const inside = (from: number, to: number) => pitch.values.slice(Math.round(from / step), Math.round(to / step)).filter((v): v is number => v !== null);
    const low = inside(0.1, 0.9);
    expect(low.length).toBeGreaterThan(60);
    expect(low.every((value) => Math.abs(value - 440) < 2)).toBe(true);
    expect(inside(2.1, 3.1)).toHaveLength(0);
  });

  it('validates READY, with every value accounted for', () => {
    const { report: validation } = validateFilmIR(document, { now: () => '2026-09-23T00:00:00.000Z' });
    expect(validation.checks.filter((check) => check.status !== 'pass')).toEqual([]);
    expect(validation.status).toBe('READY');
    expect(validation.coverage.frames).toEqual({ expected: 125, analyzed: 125 });
    expect(validation.evidenceMix['MEASURED']).toBeGreaterThan(50);
    expect(validation.evidenceMix['INFERRED'] ?? 0).toBe(0);
  });

  it('exports a JSON Schema the document satisfies in shape', () => {
    const schema = filmIrJsonSchema() as { $schema?: string; properties?: Record<string, unknown>; required?: string[] };
    expect(schema.$schema).toContain('2020-12');
    for (const key of schema.required ?? []) expect(document).toHaveProperty(key);
  });
});

describe('the validator refuses what cannot be trusted', () => {
  const failing = (mutate: (doc: FilmIR) => void) => {
    const doc = structuredClone(document);
    mutate(doc);
    const { report: validation } = validateFilmIR(doc);
    return { status: validation.status, failed: validation.checks.filter((check) => check.status === 'fail').map((check) => check.id), checks: validation.checks };
  };

  it('an unknown that carries a value', () => {
    const result = failing((doc) => {
      (doc.typography.blocks[0]!.metrics.fontFamily as { value: unknown }).value = 'Helvetica';
    });
    expect(result.status).toBe('FAILED');
    expect(result.failed).toContain('provenance');
  });

  it('a reference to something that does not exist', () => {
    const result = failing((doc) => {
      doc.structure.boundaries[0]!.kind.sourceRefs.push('obj:obj.text.9999');
    });
    expect(result.failed).toEqual(['references']);
  });

  it('timestamps that run backwards', () => {
    const result = failing((doc) => {
      doc.frames!.pts[5] = doc.frames!.pts[4]!;
    });
    expect(result.failed).toContain('frames');
  });

  it('an inference with nothing cited under it', () => {
    const result = failing((doc) => {
      doc.structure.shots[0]!.description = { evidenceType: 'INFERRED', confidence: 0.6, method: 'compiler.derivation', sourceRefs: [], value: 'a blue title card' };
    });
    expect(result.failed).toContain('unsupported');
  });

  it('an authored value presented as a reconstruction of the film', () => {
    const result = failing((doc) => {
      doc.typography.blocks[0]!.text.evidenceType = 'SPECIFIED';
    });
    expect(result.failed).toContain('mode');
  });

  it('a method nobody registered', () => {
    const result = failing((doc) => {
      doc.typography.blocks[0]!.text.method = 'ocr.imagined';
    });
    expect(result.failed).toContain('provenance');
  });

  it('an offset between two events that does not match their times', () => {
    const result = failing((doc) => {
      const relation = doc.events.relations[0];
      if (!relation) throw new Error('the fixture has no relations to tamper with');
      relation.offset = rt(BigInt(relation.offset.ticks) + 1n, relation.offset.timescale);
    });
    expect(result.failed).toContain('timelines');
  });

  it('a hole in the film no shot or transition covers', () => {
    const result = failing((doc) => {
      doc.structure.shots[1]!.frames.first = 45;
    });
    expect(result.failed).toContain('structure');
  });

  it('a document that is not the shape of one', () => {
    const { report: validation } = validateFilmIR({ ...structuredClone(document), version: undefined });
    expect(validation.status).toBe('FAILED');
    expect(validation.checks[0]!.id).toBe('schema');
  });

  it('a pass that was meant to run and did not: partial, not ready', () => {
    const { report: validation } = validateFilmIR(document, { expectedPasses: ['p01_holistic', 'integrator'] });
    expect(validation.status).toBe('PARTIAL');
    expect(validation.checks.find((check) => check.id === 'passes')).toMatchObject({ status: 'warn', count: 2 });
  });
});
