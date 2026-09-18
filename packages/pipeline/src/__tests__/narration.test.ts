import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Project, directVoice, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import {
  LocalFsStorageProvider,
  NullCostSink,
  ProviderRegistry,
  ScriptedLlmProvider,
  pcmToWav,
  type CallContext,
  type SpeechProvider,
  type SpeechRecognizer,
  type SpeechRequest,
  type SpeechResult,
  type Transcript,
  type TranscribeRequest,
  type VoiceConsent,
} from '@act-one/providers';
import { narrate, seedFor } from '../narration.ts';
import type { StageContext } from '../context.ts';

/**
 * The narration engine, end to end, against a voice that is a synthesiser
 * and an ear that is scripted. FFmpeg is real: the recordings are metered
 * and trimmed for real. What is proved is the engine's judgement — which
 * take it keeps, when it reads again, what it stores and what it reports —
 * not any vendor's voice.
 */
const SAMPLE_RATE = 24_000;

/** A tone of the given length with a little silence either side: a "read". */
function recording(seconds: number, options: { amplitude?: number; head?: number; tail?: number } = {}): Uint8Array {
  const head = options.head ?? 0.15;
  const tail = options.tail ?? 0.2;
  const total = Math.round((head + seconds + tail) * SAMPLE_RATE);
  const pcm = new Uint8Array(total * 2);
  const view = new DataView(pcm.buffer);
  const amplitude = (options.amplitude ?? 0.3) * 32767;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const inside = t >= head && t < head + seconds;
    const sample = inside ? Math.round(amplitude * Math.sin(2 * Math.PI * 220 * t)) : 0;
    view.setInt16(i * 2, Math.max(-32768, Math.min(32767, sample)), true);
  }
  return pcmToWav(pcm, SAMPLE_RATE);
}

type Plan = (request: SpeechRequest, index: number) => { seconds: number; amplitude?: number; fail?: boolean };

class FakeVoice implements SpeechProvider {
  readonly name = 'fake-voice';
  readonly kind = 'speech' as const;
  readonly requests: SpeechRequest[] = [];
  private readonly plan: Plan;
  constructor(plan: Plan) {
    this.plan = plan;
  }
  async health() {
    return { provider: this.name, kind: 'speech' as const, healthy: true, checkedAt: new Date().toISOString() };
  }
  async synthesize(request: SpeechRequest, _context: CallContext): Promise<SpeechResult> {
    this.requests.push(request);
    const shape = this.plan(request, this.requests.length - 1);
    if (shape.fail) throw new Error('vendor down');
    return {
      audio: recording(shape.seconds, { amplitude: shape.amplitude ?? 0.3 }),
      contentType: 'audio/wav',
      durationSecondsEstimate: shape.seconds,
      costUsd: request.text.length * 0.00015,
      model: 'fake-v3',
      voiceId: 'fake_voice_1',
      characters: request.text.length,
      requestId: `req_${this.requests.length}`,
    };
  }
  async synthesizeWithVoice(request: SpeechRequest & { voiceId: string }, _consent: VoiceConsent, context: CallContext) {
    return this.synthesize(request, context);
  }
}

class ScriptedEar implements SpeechRecognizer {
  readonly name = 'fake-ear';
  readonly kind = 'speech' as const;
  readonly heard: TranscribeRequest[] = [];
  private readonly answers: (index: number, request: TranscribeRequest) => Partial<Transcript>;
  constructor(answers: (index: number, request: TranscribeRequest) => Partial<Transcript>) {
    this.answers = answers;
  }
  async health() {
    return { provider: this.name, kind: 'speech' as const, healthy: true, checkedAt: new Date().toISOString() };
  }
  async transcribe(request: TranscribeRequest, _context: CallContext): Promise<Transcript> {
    this.heard.push(request);
    return {
      text: '',
      language: 'en',
      languageConfidence: 0.98,
      durationSeconds: null,
      words: [],
      model: 'fake-ear',
      ...this.answers(this.heard.length - 1, request),
    };
  }
}

let root = '';
let workDir = '';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'act-one-narration-storage-'));
  workDir = await mkdtemp(path.join(tmpdir(), 'act-one-narration-work-'));
});

async function contextWith(voice: SpeechProvider, ear: SpeechRecognizer | null, llm = new ScriptedLlmProvider([])): Promise<StageContext & { store: MemoryStore }> {
  const store = new MemoryStore();
  const organizationId = newId('org');
  const project = Project.parse({
    id: newId('prj'),
    organizationId,
    createdByUserId: newId('usr'),
    name: 'Northwind',
    websiteUrl: 'https://northwind.example',
    brief: { durationSeconds: 30, language: 'en', voiceGender: 'female' },
    stage: 'rendering',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const registry = new ProviderRegistry({
    costSink: new NullCostSink(),
    overrides: {
      llm,
      speech: voice,
      ...(ear ? { recognizer: ear } : {}),
      storage: new LocalFsStorageProvider({ root }),
    },
  });
  return {
    store,
    registry,
    organizationId,
    project,
    jobId: newId('job'),
    progress: async () => {},
    activity: async () => {},
  };
}

const direction = directVoice({ context: 'launch_film', language: 'en', gender: 'female' });

describe('the narration engine', () => {
  it('reads each passage with the lines around it, keeps the audio, and reports what it cost', async () => {
    const voice = new FakeVoice(() => ({ seconds: 1.6 }));
    const ear = new ScriptedEar((index) => ({ text: index === 0 ? 'the work moves the moment it lands.' : 'one idea, one film.' }));
    const context = await contextWith(voice, ear);
    const result = await narrate(context, {
      passages: [
        { id: 'p1', text: 'The work moves the moment it lands.', sceneId: 'scn_1', roomSeconds: 3, atSeconds: 0 },
        { id: 'p2', text: 'One idea, one film.', sceneId: 'scn_2', roomSeconds: 3, atSeconds: 3 },
      ],
      direction,
      quality: 'final',
      context: 'launch_film',
      workDir,
      listenBack: true,
    });

    expect(result.failed).toEqual([]);
    expect(result.tracks.map((track) => track.passageId)).toEqual(['p1', 'p2']);
    expect(result.tracks[0]).toMatchObject({ sceneId: 'scn_1', atSeconds: 0, take: 'as_directed', requestId: 'req_1' });
    expect(result.tracks[0]!.durationSeconds).toBeCloseTo(1.95, 1);
    expect(result.tracks[0]!.spokenSeconds).toBeCloseTo(1.6, 1);
    expect(result.tracks[0]!.assetId).toMatch(/^ast_/);

    // Continuity: the second passage is told what came before it, and what the vendor called it.
    expect(voice.requests[1]?.continuity).toEqual({
      previousText: 'The work moves the moment it lands.',
      nextText: null,
      previousRequestIds: ['req_1'],
    });
    expect(voice.requests[0]?.direction).toEqual(direction);
    expect(voice.requests[0]?.seed).toBe(seedFor('p1', 0));
    expect(voice.requests[0]?.quality).toBe('final');

    // Stored as our own asset, with who read it and what it cost.
    const assets = await context.store.assets.listForProject(context.organizationId, context.project.id, 'audio_voice');
    expect(assets).toHaveLength(2);
    const first = assets.find((asset) => asset.metadata['passageId'] === 'p1')!;
    expect(first).toMatchObject({ provider: 'fake-voice', model: 'fake-v3', origin: 'generated', sceneId: 'scn_1' });
    expect(first.metadata).toMatchObject({ selected: true, voiceId: 'fake_voice_1', language: 'en', quality: 'final', take: 'as_directed' });
    expect(first.id).toBe(result.tracks[0]!.assetId);

    expect(result.usage).toMatchObject({ calls: 2, failed: 0, provider: 'fake-voice', model: 'fake-v3' });
    expect(result.usage.characters).toBe('The work moves the moment it lands.'.length + 'One idea, one film.'.length);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
    expect(ear.heard).toHaveLength(2);
  });

  it('reads a passage again when the ear heard the wrong language, and keeps the good read', async () => {
    const voice = new FakeVoice(() => ({ seconds: 1.4 }));
    // First read comes back in French; the second is right.
    const ear = new ScriptedEar((index) =>
      index === 0
        ? { text: 'le travail avance', language: 'fr', languageConfidence: 0.97 }
        : { text: 'the work moves the moment it lands.', language: 'en' },
    );
    const context = await contextWith(voice, ear);
    const result = await narrate(context, {
      passages: [{ id: 'p1', text: 'The work moves the moment it lands.', roomSeconds: 3 }],
      direction,
      quality: 'final',
      context: 'launch_film',
      workDir,
      listenBack: true,
      regenerations: 1,
      keepTakes: true,
    });
    expect(voice.requests).toHaveLength(2);
    expect(voice.requests[1]?.seed).not.toBe(voice.requests[0]?.seed);
    expect(result.tracks[0]?.requestId).toBe('req_2');
    expect(result.issues).toEqual([]);
    const assets = await context.store.assets.listForProject(context.organizationId, context.project.id, 'audio_voice');
    expect(assets.map((asset) => asset.metadata['selected'])).toEqual(expect.arrayContaining([true, false]));
    const rejected = assets.find((asset) => asset.metadata['selected'] === false);
    expect(rejected?.metadata['findings']).toEqual(
      expect.arrayContaining([expect.objectContaining({ check: 'narration_language', severity: 'blocker' })]),
    );
  });

  it('chooses among takes by QA, then by fit to the room, and reports what still stands', async () => {
    // Three takes: the first clips, the second fits, the third runs long.
    const voice = new FakeVoice((request) =>
      request.take === 'as_directed' ? { seconds: 1.6, amplitude: 1.2 } : request.take === 'restrained' ? { seconds: 1.5 } : { seconds: 2.9 },
    );
    const context = await contextWith(voice, null);
    const result = await narrate(context, {
      passages: [{ id: 'p1', text: 'The work moves the moment it lands.', roomSeconds: 2 }],
      direction,
      quality: 'final',
      context: 'launch_film',
      workDir,
      takes: 3,
      regenerations: 0,
    });
    expect(voice.requests.map((request) => request.take)).toEqual(['as_directed', 'restrained', 'warmer']);
    expect(result.tracks[0]?.take).toBe('restrained');
    expect(result.issues).toEqual([]);
    expect(voice.requests[1]?.direction?.stability).toBe('robust');
  });

  it('rewrites a line shorter before it hurries the voice, and keeps the figures', async () => {
    const llm = new ScriptedLlmProvider([{ respond: { text: 'Four hundred teams close their books 3x faster.' } }]);
    const voice = new FakeVoice(() => ({ seconds: 1.5 }));
    const context = await contextWith(voice, null, llm);
    const long = 'Across every one of the four hundred finance teams that already use it, the books now close 3x faster than they used to, month after month.';
    const result = await narrate(context, {
      passages: [{ id: 'p1', text: long, roomSeconds: 5 }],
      direction,
      quality: 'preview',
      context: 'launch_film',
      workDir,
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.messages[1]?.content).toContain('Room: 5.0 seconds');
    expect(voice.requests[0]?.text).toBe('Four hundred teams close their books three times faster.');
    expect(voice.requests[0]?.rate).toBeUndefined();
    expect(result.tracks).toHaveLength(1);
  });

  it('hurries a little only when the copy still runs long, and never past ten percent', async () => {
    const llm = new ScriptedLlmProvider([{ respond: { text: 'Still far too long for the room it has been given here, honestly, by a wide margin.' } }]);
    const voice = new FakeVoice(() => ({ seconds: 1 }));
    const context = await contextWith(voice, null, llm);
    await narrate(context, {
      passages: [{ id: 'p1', text: 'Still far too long for the room it has been given here, honestly, by a very wide margin indeed.', roomSeconds: 2 }],
      direction,
      quality: 'preview',
      context: 'launch_film',
      workDir,
    });
    expect(voice.requests[0]?.rate).toBe(1.1);
  });

  it('reports a passage the engine could not read at all, and goes on with the rest', async () => {
    const voice = new FakeVoice((request) => (request.text.startsWith('Broken') ? { seconds: 1, fail: true } : { seconds: 1.2 }));
    const context = await contextWith(voice, null);
    const result = await narrate(context, {
      passages: [
        { id: 'p1', text: 'Broken line.', sceneId: 'scn_1', roomSeconds: 3 },
        { id: 'p2', text: 'A fine line.', sceneId: 'scn_2', roomSeconds: 3 },
      ],
      direction,
      quality: 'final',
      context: 'launch_film',
      workDir,
      regenerations: 1,
    });
    expect(result.failed).toEqual(['p1']);
    expect(result.tracks.map((track) => track.passageId)).toEqual(['p2']);
    expect(result.issues).toEqual([expect.objectContaining({ check: 'missing_audio', sceneId: 'scn_1', severity: 'major' })]);
    expect(result.usage.failed).toBe(2);
  });

  it('brings uneven passages to one level', async () => {
    const voice = new FakeVoice((_, index) => ({ seconds: 1.2, amplitude: index === 0 ? 0.05 : 0.5 }));
    const context = await contextWith(voice, null);
    const result = await narrate(context, {
      passages: [
        { id: 'p1', text: 'Quiet.', roomSeconds: 3 },
        { id: 'p2', text: 'Loud.', roomSeconds: 3 },
      ],
      direction,
      quality: 'final',
      context: 'launch_film',
      workDir,
    });
    expect(result.issues.some((issue) => issue.check === 'narration_loudness')).toBe(true);
    expect(result.tracks[0]!.integratedLufs).toBeCloseTo(result.tracks[1]!.integratedLufs!, 0);
    expect(result.tracks[0]!.path).toMatch(/-levelled\.wav$/);
  });

  it('seeds are stable per passage and take', () => {
    expect(seedFor('p1', 0)).toBe(seedFor('p1', 0));
    expect(seedFor('p1', 0)).not.toBe(seedFor('p1', 1));
    expect(seedFor('p1', 0)).not.toBe(seedFor('p2', 0));
  });
});
