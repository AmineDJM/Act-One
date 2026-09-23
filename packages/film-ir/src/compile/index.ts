import { FILM_IR_SCHEMA, FILM_IR_VERSION, type FilmIR } from '../schema/document.ts';
import type { InterpretationIR } from '../schema/interpretation.ts';
import type { NarrationIR } from '../schema/audio.ts';
import type { WithheldSpeech } from '../narration/asr.ts';
import type { Method, Producer } from '../schema/source.ts';
import type { ForensicReport } from '../forensics/report.ts';
import { compileMeasured, forensicProducer, type Measured } from './deterministic.ts';
import { buildEventGraph } from './events.ts';

/**
 * Assembling one FilmIR.
 *
 * The measured document is built first and stands on its own. Anything later
 * stages add — a transcription, the model's interpretation — is merged onto
 * it through the functions in this package, each of which keeps the measured
 * values and records disagreement rather than overwriting it.
 *
 * The event graph is built from the measurements, before any interpretation,
 * and never rebuilt: its events and sync clusters are what the model was
 * shown and cited by id, so an interpretation merged afterwards must find
 * `evt.0042` meaning what it meant when the model read it. Interpretations
 * do not add events; they annotate the ones measured.
 */
export type CompileInput = {
  id: string;
  title: string | null;
  report: ForensicReport;
  createdAt?: string;
  narration?: { ir: NarrationIR; producer: Producer; methods: Method[]; withheld?: WithheldSpeech[] } | null;
  interpretation?: {
    apply: (document: FilmIR, measured: Measured) => { document: FilmIR; producers: Producer[]; methods: Method[] };
  } | null;
};

export function compileFilmIR(input: CompileInput): { document: FilmIR; measured: Measured } {
  const measured = compileMeasured(input.report);
  const producers: Producer[] = [
    forensicProducer(input.report),
    {
      id: 'compiler',
      kind: 'compiler',
      name: 'actone-film-ir compiler',
      version: FILM_IR_VERSION,
      model: null,
      status: 'completed',
      startedAt: null,
      finishedAt: null,
      inputHash: input.report.input.sha256,
      costUsd: 0,
      notes: [],
    },
  ];
  const methods = [...measured.methods];
  let narration = measured.narration;
  if (input.narration) {
    narration = input.narration.ir;
    producers.push(input.narration.producer);
    methods.push(...input.narration.methods.filter((method) => !methods.some((existing) => existing.id === method.id)));
  }
  let document: FilmIR = {
    schema: FILM_IR_SCHEMA,
    version: FILM_IR_VERSION,
    id: input.id,
    mode: 'reconstruction',
    title: input.title,
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: measured.source,
    target: null,
    methods,
    producers,
    frames: measured.frames,
    objects: measured.objects,
    camera: measured.camera,
    depth: null,
    attention: measured.attention,
    product: measured.product,
    typography: measured.typography,
    audio: measured.audio,
    narration,
    sound: measured.sound,
    structure: measured.structure,
    events: { events: [], relations: [], clusters: [] },
    curves: measured.curves,
    interpretation: null as InterpretationIR | null,
    reconstruction: measured.reconstruction,
    uncertainties: measured.uncertainties,
    contradictions: [],
    unsupported: [],
    validation: null,
  };
  for (const speech of input.narration?.withheld ?? []) {
    document.unsupported.push({
      id: `unsupported.${String(document.unsupported.length + 1).padStart(4, '0')}`,
      claim: `speech "${speech.text}" at ${speech.startSeconds.toFixed(2)}–${speech.endSeconds.toFixed(2)} s`,
      sourceRef: `producer:${input.narration!.producer.id}`,
      reason: speech.reason,
    });
  }
  document.events = buildEventGraph({
    clock: measured.clock,
    samples: measured.samples,
    structure: document.structure,
    typography: document.typography,
    camera: document.camera,
    objects: document.objects,
    attention: document.attention,
    audio: document.audio,
    music: document.sound.music,
    sfx: document.sound.sfx,
    narration: document.narration,
    fieldChanges: input.report.fieldChanges,
    crossfades: input.report.crossfades,
    hopResolution: document.audio.analysis?.hop ?? null,
  });
  if (input.interpretation) {
    const applied = input.interpretation.apply(document, measured);
    document = applied.document;
    document.producers = [...document.producers, ...applied.producers.filter((p) => !document.producers.some((q) => q.id === p.id))];
    document.methods = [...document.methods, ...applied.methods.filter((m) => !document.methods.some((n) => n.id === m.id))];
  }
  return { document, measured };
}
