import { z } from 'zod';
import type { CallContext, GeminiFile, GeminiGenerateResult, GeminiPart, GeminiVideoProvider } from '@act-one/providers';
import type { FilmIR } from '../schema/document.ts';
import { evidencePack, type EvidencePack } from './evidence-pack.ts';
import { Inspection, Integrator, PASSES, SYSTEM, type PassDefinition, type PassId } from './passes.ts';

/**
 * Running the passes, resumably.
 *
 * Each pass is recorded the moment it finishes, so a worker that dies after
 * the seventh pass resumes at the eighth; a pass that failed is run again on
 * the next attempt and one that completed never is. An answer that does not
 * validate is sent back once with the validation error, and a second failure
 * is a failed pass — never an empty success.
 */
export type ExactFrame = { frame: number; seconds: number; jpeg: Uint8Array };
export type FrameExtractor = (first: number, last: number) => Promise<ExactFrame[]>;

export type InspectionRecord = {
  passId: PassId;
  question: string;
  firstFrame: number;
  lastFrame: number;
  frames: number[];
  output: z.infer<typeof Inspection> | null;
  error: string | null;
  costUsd: number;
};

export type PassRecord = {
  id: PassId | 'integrator';
  title: string;
  status: 'completed' | 'failed';
  model: string | null;
  output: unknown;
  error: string | null;
  costUsd: number;
  tokens: number;
  startedAt: string;
  finishedAt: string;
  inspections: InspectionRecord[];
  fps: number | null;
};

export type GeminiRunInput = {
  provider: GeminiVideoProvider;
  file: GeminiFile;
  document: FilmIR;
  context: CallContext;
  existing?: Partial<Record<PassRecord['id'], PassRecord>>;
  extractFrames?: FrameExtractor;
  /** Called after each pass, completed or failed, so the caller can persist it before the next begins. */
  onRecord?: (record: PassRecord) => Promise<void>;
  only?: PassId[];
};

const MAX_INSPECTION_FRAMES = 36;

export async function runGeminiPasses(input: GeminiRunInput): Promise<Record<string, PassRecord>> {
  const pack = evidencePack(input.document);
  const records: Record<string, PassRecord> = {};
  for (const [id, record] of Object.entries(input.existing ?? {})) if (record) records[id] = record;
  const fps = input.document.frames && input.document.source?.frameTiming?.lastPtsEnd
    ? input.document.frames.count / (Number(input.document.source.frameTiming.lastPtsEnd.ticks) / input.document.source.frameTiming.lastPtsEnd.timescale)
    : 30;

  for (const pass of PASSES) {
    if (input.only && !input.only.includes(pass.id)) continue;
    if (records[pass.id]?.status === 'completed') continue;
    const record = await runPass(input, pass, pack, fps);
    records[pass.id] = record;
    await input.onRecord?.(record);
  }

  if (!input.only && records['integrator']?.status !== 'completed') {
    const record = await runIntegrator(input, pack, records);
    records['integrator'] = record;
    await input.onRecord?.(record);
  }
  return records;
}

async function runPass(input: GeminiRunInput, pass: PassDefinition, pack: EvidencePack, fps: number): Promise<PassRecord> {
  const startedAt = new Date().toISOString();
  const video: GeminiPart = { kind: 'video', file: input.file, fps: pass.fps };
  const prompt = [
    `PASS: ${pass.title}`,
    pass.task,
    '',
    'MEASUREMENTS (cite these ids):',
    pack.text,
  ].join('\n');
  let cost = 0;
  let tokens = 0;
  let model: string | null = null;
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result: GeminiGenerateResult;
    try {
      result = await input.provider.generate(
        {
          parts: [video, { kind: 'text', text: feedback ? `${prompt}\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${feedback}\nAnswer again, following the schema exactly.` : prompt }],
          system: SYSTEM,
          schema: jsonSchema(pass.schema),
          mediaResolution: pass.mediaResolution,
          temperature: 0.2,
          label: `film-ir.${pass.id}`,
        },
        input.context,
      );
    } catch (error) {
      return failed(pass.id, pass.title, startedAt, (error as Error).message, cost, tokens, model, pass.fps);
    }
    cost += result.costUsd;
    tokens += result.usage.totalTokens;
    model = result.model;
    const parsed = pass.schema.safeParse(result.json);
    if (!parsed.success) {
      feedback = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      continue;
    }
    const output = parsed.data as Record<string, unknown>;
    const inspections: InspectionRecord[] = [];
    const requests = (output['inspect'] as { startSeconds: number; endSeconds: number; question: string }[] | undefined) ?? [];
    if (input.extractFrames && requests.length > 0) {
      for (const request of requests.slice(0, 3)) {
        const inspection = await inspect(input, pass.id, request, fps);
        cost += inspection.costUsd;
        inspections.push(inspection);
      }
    }
    return {
      id: pass.id,
      title: pass.title,
      status: 'completed',
      model,
      output,
      error: null,
      costUsd: round(cost, 5),
      tokens,
      startedAt,
      finishedAt: new Date().toISOString(),
      inspections,
      fps: pass.fps,
    };
  }
  return failed(pass.id, pass.title, startedAt, `the answer did not validate twice: ${feedback}`, cost, tokens, model, pass.fps);
}

/**
 * A window at the film's own frame rate.
 *
 * The frames are the analyzer's own — same decoder, same index — so what the
 * model says about "frame 368" is about the frame the measurements call 368.
 */
async function inspect(
  input: GeminiRunInput,
  passId: PassId,
  request: { startSeconds: number; endSeconds: number; question: string },
  fps: number,
): Promise<InspectionRecord> {
  const start = Math.max(0, Math.min(request.startSeconds, request.endSeconds));
  const end = Math.min(start + 1.5, Math.max(request.startSeconds, request.endSeconds));
  const firstFrame = Math.max(0, Math.floor(start * fps));
  const lastFrame = Math.min((input.document.frames?.count ?? 1) - 1, Math.ceil(end * fps));
  const base = { passId, question: request.question.slice(0, 400), firstFrame, lastFrame, frames: [] as number[], output: null, error: null, costUsd: 0 };
  try {
    let frames = await input.extractFrames!(firstFrame, lastFrame);
    if (frames.length > MAX_INSPECTION_FRAMES) {
      const step = Math.ceil(frames.length / MAX_INSPECTION_FRAMES);
      frames = frames.filter((_, i) => i % step === 0);
    }
    const parts: GeminiPart[] = [];
    for (const frame of frames) {
      parts.push({ kind: 'text', text: `frame ${frame.frame} at ${frame.seconds.toFixed(4)} s` });
      parts.push({ kind: 'image', mimeType: 'image/jpeg', data: frame.jpeg });
    }
    parts.push({ kind: 'text', text: `These are consecutive frames of the film at its own frame rate, each labelled with its frame index and presentation time. ${request.question}\nAnswer about these frames only, citing frame indices.` });
    const result = await input.provider.generate(
      { parts, system: SYSTEM, schema: jsonSchema(Inspection), temperature: 0.1, label: `film-ir.${passId}.inspect` },
      input.context,
    );
    const parsed = Inspection.safeParse(result.json);
    return {
      ...base,
      frames: frames.map((frame) => frame.frame),
      output: parsed.success ? parsed.data : null,
      error: parsed.success ? null : 'the inspection answer did not validate',
      costUsd: result.costUsd,
    };
  } catch (error) {
    return { ...base, error: (error as Error).message.slice(0, 400) };
  }
}

async function runIntegrator(input: GeminiRunInput, pack: EvidencePack, records: Record<string, PassRecord>): Promise<PassRecord> {
  const startedAt = new Date().toISOString();
  const completed = Object.values(records).filter((record) => record.status === 'completed' && record.id !== 'integrator');
  const seconds = Math.ceil(pack.durationSeconds);
  const answers = completed.map((record) => `### ${record.id} (${record.title})\n${JSON.stringify(record.output)}`).join('\n\n');
  const prompt = [
    'INTEGRATION',
    'You have the measurements and the answers of focused passes over the same film (you are not shown the film again).',
    'Write the film\'s DNA, the major directorial choices (facts in what/how/when/howMuch/relativeTo, interpretation only in why), and three inferred curves with exactly one value per second of film.',
    `The film is ${pack.durationSeconds.toFixed(3)} s long, so each curve has ${seconds} values.`,
    'Where passes disagree, prefer the measurements, then the pass whose evidence is more specific, and list the conflict.',
    '',
    'MEASUREMENTS:',
    pack.text,
    '',
    'PASS ANSWERS:',
    answers || '(none completed)',
  ].join('\n');
  let cost = 0;
  let tokens = 0;
  let model: string | null = null;
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await input.provider.generate(
        {
          parts: [{ kind: 'text', text: feedback ? `${prompt}\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${feedback}` : prompt }],
          system: SYSTEM,
          schema: jsonSchema(Integrator),
          temperature: 0.2,
          label: 'film-ir.integrator',
        },
        input.context,
      );
      cost += result.costUsd;
      tokens += result.usage.totalTokens;
      model = result.model;
      const parsed = Integrator.safeParse(result.json);
      if (!parsed.success) {
        feedback = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        continue;
      }
      return { id: 'integrator', title: 'Integration', status: 'completed', model, output: parsed.data, error: null, costUsd: round(cost, 5), tokens, startedAt, finishedAt: new Date().toISOString(), inspections: [], fps: null };
    } catch (error) {
      return failed('integrator', 'Integration', startedAt, (error as Error).message, cost, tokens, model, null);
    }
  }
  return failed('integrator', 'Integration', startedAt, `the answer did not validate twice: ${feedback}`, cost, tokens, model, null);
}

function failed(id: PassRecord['id'], title: string, startedAt: string, error: string, cost: number, tokens: number, model: string | null, fps: number | null): PassRecord {
  return { id, title, status: 'failed', model, output: null, error: error.slice(0, 600), costUsd: round(cost, 5), tokens, startedAt, finishedAt: new Date().toISOString(), inspections: [], fps };
}

/** The JSON Schema a model is held to, from the same Zod schema its answer is validated with. */
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
  delete out['$schema'];
  return out;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
