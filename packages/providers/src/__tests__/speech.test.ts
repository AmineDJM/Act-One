import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { directVoice } from '@act-one/core';
import {
  ElevenLabsProvider,
  OpenAiSpeechProvider,
  NullCostSink,
  ProviderRegistry,
  pcmToWav,
  withAudioTags,
  speechOverrides,
  type VoiceConsent,
} from '../index.ts';

/**
 * The voice follows the language, the person asked for, and the direction.
 *
 * Both vendors are stood up on loopback with their documented shapes: OpenAI's
 * speech and transcription endpoints, ElevenLabs' voice library, shared
 * library, text-to-speech, speech-to-text and cloning. What is proved is the
 * choice — a French line, a woman's voice, a curated voice over the library —
 * and the performance asked for, which on v3 is a stability tier and a
 * sparing tag rather than a dial.
 */
type Call = {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
  /** Field names of a multipart body, in order. */
  fields: string[];
  rawLength: number;
};

const PCM = Buffer.alloc(4800); // 100 ms of silence at 24 kHz, 16-bit mono

class FakeVendors {
  calls: Call[] = [];
  url = '';
  private server: Server | null = null;

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(request.url ?? '/', this.url);
    const contentType = String(request.headers['content-type'] ?? '');
    const json = contentType.includes('application/json') && raw.length > 0;
    const body: unknown = json ? JSON.parse(raw.toString('utf8')) : undefined;
    const fields = contentType.includes('multipart/form-data')
      ? [...raw.toString('latin1').matchAll(/(?<!file)name="([^"]+)"/g)].map((match) => match[1]!)
      : [];
    this.calls.push({
      method: request.method ?? 'GET',
      path: url.pathname + url.search,
      headers: request.headers,
      body,
      fields,
      rawLength: raw.length,
    });

    // OpenAI: bytes back, whatever the format; and a Whisper transcript.
    if (url.pathname === '/v1/audio/speech') {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end(Buffer.from('RIFF-fake'));
      return;
    }
    if (url.pathname === '/v1/audio/transcriptions') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          task: 'transcribe',
          language: 'french',
          duration: 2.4,
          text: 'Le matin, tout est déjà rapproché.',
          words: [
            { word: 'Le', start: 0.1, end: 0.3 },
            { word: 'matin', start: 0.3, end: 0.8 },
          ],
          segments: [
            { start: 0, end: 2.4, text: ' Le matin, tout est déjà rapproché.', no_speech_prob: 0.02, avg_logprob: -0.21 },
            { start: 2.4, end: 2.4, no_speech_prob: 0.9 },
          ],
        }),
      );
      return;
    }
    // ElevenLabs: the library, then the audio.
    if (request.headers['xi-api-key'] !== 'el_test_key') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }),
      );
      return;
    }
    if (url.pathname === '/v2/voices') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          voices: [
            {
              voice_id: 'v_en_f',
              name: 'Rachel',
              category: 'premade',
              labels: { gender: 'female', accent: 'american', language: 'en', use_case: 'narration' },
              verified_languages: [{ language: 'en', model_id: 'eleven_multilingual_v2', locale: 'en-US' }],
            },
            {
              voice_id: 'v_fr_m',
              name: 'Louis',
              category: 'premade',
              labels: { gender: 'male', accent: 'french', language: 'fr', use_case: 'narration' },
              verified_languages: [{ language: 'fr', model_id: 'eleven_multilingual_v2', locale: 'fr-FR' }],
            },
            {
              voice_id: 'v_fr_f',
              name: 'Charlotte',
              category: 'professional',
              labels: { gender: 'female', accent: 'french', language: 'fr', use_case: 'informative_educational' },
              verified_languages: [
                { language: 'fr', model_id: 'eleven_multilingual_v2', locale: 'fr-FR' },
                { language: 'en', model_id: 'eleven_multilingual_v2' },
              ],
            },
            {
              voice_id: 'v_de_f',
              name: 'Anna',
              category: 'premade',
              labels: { gender: 'female', accent: 'german', language: 'de', use_case: 'conversational' },
              verified_languages: [{ language: 'de', model_id: 'eleven_multilingual_v2' }],
            },
            {
              voice_id: 'v_clone',
              name: 'Founder (cloned)',
              category: 'cloned',
              labels: { gender: 'male', language: 'fr' },
              verified_languages: [{ language: 'fr', model_id: 'eleven_multilingual_v2' }],
            },
          ],
          total_count: 5,
          has_more: false,
        }),
      );
      return;
    }
    if (url.pathname === '/v1/shared-voices') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          voices: [
            {
              public_owner_id: 'owner_1',
              voice_id: 'shared_fr_f',
              name: 'Élodie',
              accent: 'parisian',
              gender: 'female',
              age: 'middle_aged',
              use_case: 'narrative_story',
              category: 'professional',
              language: 'fr',
              locale: 'fr-FR',
              description: 'Warm French narrator',
              preview_url: 'https://example.test/elodie.mp3',
            },
          ],
          has_more: false,
        }),
      );
      return;
    }
    if (url.pathname.startsWith('/v1/voices/add/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ voice_id: 'added_fr_f' }));
      return;
    }
    if (url.pathname === '/v1/voices/add') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ voice_id: 'cloned_new', requires_verification: false }));
      return;
    }
    if (url.pathname.startsWith('/v1/voices/') && request.method === 'DELETE') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url.pathname === '/v1/speech-to-text') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          language_code: 'fra',
          language_probability: 0.98,
          text: 'Le matin, tout est déjà rapproché.',
          words: [
            { text: 'Le', start: 0.1, end: 0.3, type: 'word' },
            { text: ' ', start: 0.3, end: 0.3, type: 'spacing' },
            { text: 'matin', start: 0.3, end: 0.8, type: 'word' },
          ],
        }),
      );
      return;
    }
    if (url.pathname.startsWith('/v1/text-to-speech/')) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'request-id': 'req_abc' });
      response.end(PCM);
      return;
    }
    // The score, the built sound, and where every word fell.
    if (url.pathname === '/v1/music') {
      response.writeHead(200, { 'content-type': 'audio/mpeg' });
      response.end(Buffer.from('ID3-score'));
      return;
    }
    if (url.pathname === '/v1/sound-generation') {
      response.writeHead(200, { 'content-type': 'audio/mpeg' });
      response.end(Buffer.from('ID3-sfx'));
      return;
    }
    if (url.pathname === '/v1/forced-alignment') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          words: [
            { text: 'A', start: 0, end: 0.2, loss: 0.02 },
            { text: 'week', start: 0.2, end: 0.6, loss: 0.05 },
            { text: '', start: 0.6, end: 0.6, loss: 0 },
            { text: 'later.', start: 0.6, end: 1.4, loss: 0.9 },
          ],
          loss: 0.1,
        }),
      );
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'not found' }));
  }
}

const vendors = new FakeVendors();
const call = { organizationId: 'org_1', projectId: 'prj_1', sceneId: 'scn_1' };
const consent: VoiceConsent = {
  subjectName: 'Amine',
  grantedByUserId: 'usr_1',
  organizationId: 'org_1',
  grantedAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
  scope: 'organization',
  projectId: null,
};

beforeAll(() => vendors.start());
afterAll(() => vendors.stop());
beforeEach(() => {
  vendors.calls = [];
});

const tts = () => vendors.calls.find((entry) => entry.path.startsWith('/v1/text-to-speech/'));

describe('OpenAI voices', () => {
  it("picks a woman's voice for the register and directs it to speak French natively", async () => {
    const sink = new NullCostSink();
    const speech = new OpenAiSpeechProvider({
      apiKey: 'sk-test',
      baseUrl: `${vendors.url}/v1`,
      costSink: sink,
    });
    const result = await speech.synthesize(
      {
        text: 'Le matin, tout est déjà rapproché.',
        persona: 'narrator_warm',
        language: 'fr',
        gender: 'female',
        tone: 'Warm — human, close',
        rate: 1.05,
        format: 'wav',
      },
      call,
    );
    const body = vendors.calls[0]?.body as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini-tts');
    expect(body.voice).toBe('coral');
    expect(body.response_format).toBe('wav');
    expect(body.speed).toBe(1.05);
    expect(String(body.instructions)).toMatch(/native speaker.*\(fr\)/);
    expect(String(body.instructions)).toMatch(/never a foreign one/);
    expect(String(body.instructions)).toMatch(/Warm — human, close/);
    expect(result.contentType).toBe('audio/wav');
    expect(result.voiceId).toBe('coral');
    expect(sink.records[0]).toMatchObject({
      provider: 'openai-speech',
      operation: 'speech.tts',
      metadata: { voice: 'coral', language: 'fr', quality: 'final' },
    });
  });

  it('turns a structured direction into the voice and the instruction', async () => {
    const speech = new OpenAiSpeechProvider({ apiKey: 'sk-test', baseUrl: `${vendors.url}/v1` });
    const direction = directVoice({ context: 'launch_film', language: 'fr', accent: 'france', gender: 'male' });
    await speech.synthesize({ text: 'Une idée. Un film.', persona: 'narrator_neutral', direction }, call);
    const body = vendors.calls[0]?.body as Record<string, unknown>;
    // Cinematic and low: the weighty voice, not the neutral one.
    expect(body.voice).toBe('onyx');
    expect(String(body.instructions)).toMatch(/product launch film/);
    expect(String(body.instructions)).toMatch(/native speaker of fr \(fr-FR\)/);
    expect(String(body.instructions)).toMatch(/Avoid: /);
  });

  it("picks a man's voice when asked, and the register's default when not", () => {
    const speech = new OpenAiSpeechProvider({ apiKey: 'sk-test' });
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_neutral', gender: 'male' })).toBe('cedar');
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_low', gender: 'female' })).toBe('sage');
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_neutral' })).toBe('marin');
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_low' })).toBe('onyx');
  });

  it('falls back to the nine voices the older models have, and does not direct them', async () => {
    const speech = new OpenAiSpeechProvider({
      apiKey: 'sk-test',
      baseUrl: `${vendors.url}/v1`,
      model: 'tts-1-hd',
    });
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_neutral', gender: 'female' })).toBe('nova');
    await speech.synthesize({ text: 'Hello.', persona: 'narrator_neutral' }, call);
    expect(vendors.calls[0]?.body).not.toHaveProperty('instructions');
  });

  it('listens back with Whisper and reports the language as a code', async () => {
    const sink = new NullCostSink();
    const speech = new OpenAiSpeechProvider({ apiKey: 'sk-test', baseUrl: `${vendors.url}/v1`, costSink: sink });
    const transcript = await speech.transcribe({ audio: new Uint8Array(PCM), contentType: 'audio/wav' }, call);
    const request = vendors.calls[0]!;
    expect(request.path).toBe('/v1/audio/transcriptions');
    expect(String(request.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/);
    // Words for the timing, segments for the recogniser's own doubt about each stretch of audio.
    expect(request.fields).toEqual(['model', 'response_format', 'timestamp_granularities[]', 'timestamp_granularities[]', 'file']);
    expect(transcript).toMatchObject({
      language: 'fr',
      durationSeconds: 2.4,
      text: 'Le matin, tout est déjà rapproché.',
      model: 'whisper-1',
    });
    expect(transcript.words).toEqual([
      { word: 'Le', start: 0.1, end: 0.3 },
      { word: 'matin', start: 0.3, end: 0.8 },
    ]);
    // A segment without text is dropped rather than turned into an empty one.
    expect(transcript.segments).toEqual([
      { start: 0, end: 2.4, text: 'Le matin, tout est déjà rapproché.', noSpeechProbability: 0.02, averageLogProbability: -0.21 },
    ]);
    expect(sink.records[0]).toMatchObject({ operation: 'speech.stt', unit: 'second', quantity: 2.4 });
  });
});

describe('ElevenLabs voices', () => {
  it('chooses a voice that speaks the language, of the gender asked for', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    expect(
      await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', language: 'fr', gender: 'female' }),
    ).toBe('v_fr_f');
    expect(
      await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', language: 'fr', gender: 'male' }),
    ).toBe('v_fr_m');
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', language: 'de' })).toBe('v_de_f');
    // The library is read once, not per line.
    expect(vendors.calls.filter((entry) => entry.path.startsWith('/v2/voices'))).toHaveLength(1);
  });

  it('would rather use a stock voice than one of the wrong gender', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    // Nobody in the library speaks German and is a man.
    expect(
      await speech.voiceFor({ text: 'x', persona: 'narrator_low', language: 'de', gender: 'male' }),
    ).toBe('VR6AewLTigWG4xSOukaG');
  });

  it("never casts a clone from the library on its own, and refuses one named without consent", async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    const direction = directVoice({ context: 'launch_film', language: 'fr', gender: 'male' });
    // v_clone is a French man too; Louis is chosen.
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', direction })).toBe('v_fr_m');
    await expect(
      speech.synthesize({ text: 'x', persona: 'brand_custom', voiceId: 'v_clone', direction }, call),
    ).rejects.toThrow(/consent/);
    // A library voice named outright is fine: nobody's likeness is in it.
    await speech.synthesize({ text: 'x', persona: 'brand_custom', voiceId: 'v_fr_f', direction }, call);
    expect(tts()?.path).toMatch(/^\/v1\/text-to-speech\/v_fr_f\?/);
  });

  it('prefers the curated voice for the locale, then the language, over the library', async () => {
    const speech = new ElevenLabsProvider({
      apiKey: 'el_test_key',
      baseUrl: vendors.url,
      curated: {
        'fr-FR': { female: { premium: { voiceId: 'cur_fr_fr_f', name: 'Camille' } } },
        fr: { female: { warm: { voiceId: 'cur_fr_f_warm', name: 'Inès' } }, male: { premium: { voiceId: 'cur_fr_m', name: 'Marc' } } },
      },
    });
    const paris = directVoice({ context: 'launch_film', language: 'fr', accent: 'france', gender: 'female' });
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', direction: paris })).toBe('cur_fr_fr_f');
    const quebec = directVoice({ context: 'launch_film', language: 'fr', accent: 'canada', gender: 'female' });
    // No fr-CA voice curated: the language's set, falling through the profiles.
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', direction: quebec })).toBe('cur_fr_f_warm');
    const man = directVoice({ context: 'launch_film', language: 'fr', gender: 'male' });
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', direction: man })).toBe('cur_fr_m');
    // Nothing curated for German: the library, as before.
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', language: 'de' })).toBe('v_de_f');
  });

  it('reads finals on v3 as a performance: a stability tier, continuity, a seed, and no dials', async () => {
    const sink = new NullCostSink();
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, costSink: sink });
    const direction = directVoice({ context: 'executive_update', language: 'fr', gender: 'female', style: 'calm' });
    const result = await speech.synthesize(
      {
        text: 'Le matin… tout est déjà rapproché.',
        persona: 'narrator_neutral',
        direction,
        format: 'wav',
        continuity: { previousText: 'Bonjour.', nextText: 'Merci.', previousRequestIds: ['req_1', 'req_2'] },
        seed: 42,
      },
      call,
    );
    const request = tts();
    expect(request?.path).toBe('/v1/text-to-speech/v_fr_f?output_format=pcm_24000');
    expect(request?.body).toEqual({
      text: '[softly] Le matin [short pause] tout est déjà rapproché.',
      model_id: 'eleven_v3',
      voice_settings: { stability: 1, similarity_boost: 0.75, use_speaker_boost: true },
      previous_text: 'Bonjour.',
      next_text: 'Merci.',
      previous_request_ids: ['req_1', 'req_2'],
      seed: 42,
    });
    expect(result.model).toBe('eleven_v3');
    expect(result.voiceId).toBe('v_fr_f');
    expect(result.requestId).toBe('req_abc');
    expect(result.characters).toBe('Le matin… tout est déjà rapproché.'.length);
    expect(result.contentType).toBe('audio/wav');
    expect(Buffer.from(result.audio.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(result.audio.subarray(8, 12)).toString('ascii')).toBe('WAVE');
    expect(result.audio.byteLength).toBe(44 + PCM.byteLength);
    expect(new DataView(result.audio.buffer, result.audio.byteOffset).getUint32(24, true)).toBe(24_000);
    expect(sink.records[0]).toMatchObject({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      operation: 'speech.tts',
      metadata: { voiceId: 'v_fr_f', language: 'fr', quality: 'final', take: 'as_directed' },
    });
  });

  it('reads previews on the flash model with the language enforced, at half the cost', async () => {
    const sink = new NullCostSink();
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, costSink: sink });
    const direction = directVoice({ context: 'launch_film', language: 'fr', gender: 'female' });
    const text = 'Le matin, tout est déjà rapproché.';
    const preview = await speech.synthesize({ text, persona: 'narrator_neutral', direction, quality: 'preview' }, call);
    expect(tts()?.body).toMatchObject({
      text,
      model_id: 'eleven_flash_v2_5',
      language_code: 'fr',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1 },
    });
    vendors.calls = [];
    const final = await speech.synthesize({ text, persona: 'narrator_neutral', direction }, call);
    expect(tts()?.body).not.toHaveProperty('language_code');
    expect(preview.costUsd).toBeCloseTo(final.costUsd / 2, 8);
  });

  it('keeps the older models on their dials, with the register and the speed', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, modelId: 'eleven_multilingual_v2' });
    await speech.synthesize(
      { text: 'Le matin.', persona: 'narrator_warm', language: 'fr', gender: 'female', rate: 0.9 },
      call,
    );
    expect(tts()?.body).toEqual({
      text: 'Le matin.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true, speed: 0.9 },
    });
  });

  it('marks the script sparingly: one tag at the top, a breath at an ellipsis, nothing on a marked line', () => {
    const calm = directVoice({ context: 'launch_film', language: 'en', style: 'calm' });
    expect(withAudioTags('One idea… one film.', calm)).toBe('[softly] One idea [short pause] one film.');
    const energetic = directVoice({ context: 'social_cut', language: 'en', style: 'energetic' });
    expect(withAudioTags('Ship it today.', energetic)).toBe('[excited] Ship it today.');
    const cinematic = directVoice({ context: 'launch_film', language: 'en' });
    expect(withAudioTags('The morning is closer.', cinematic)).toBe('The morning is closer.');
    const slow = directVoice({ context: 'launch_film', language: 'en', pace: 'slow' });
    expect(withAudioTags('The morning is closer.', slow)).toBe('[slowly] The morning is closer.');
    expect(withAudioTags('[whispers] Already marked.', calm)).toBe('[whispers] Already marked.');
    expect(withAudioTags('No direction.', null)).toBe('No direction.');
  });

  it('listens back with Scribe and drops the spacing tokens', async () => {
    const sink = new NullCostSink();
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, costSink: sink });
    const transcript = await speech.transcribe({ audio: new Uint8Array(PCM), contentType: 'audio/wav' }, call);
    const request = vendors.calls[0]!;
    expect(request.path).toBe('/v1/speech-to-text');
    expect(request.fields).toEqual(['model_id', 'timestamps_granularity', 'tag_audio_events', 'file']);
    expect(transcript).toMatchObject({ language: 'fra', languageConfidence: 0.98, model: 'scribe_v1', durationSeconds: 0.8 });
    expect(transcript.words.map((word) => word.word)).toEqual(['Le', 'matin']);
    expect(sink.records[0]).toMatchObject({ operation: 'speech.stt', model: 'scribe_v1' });
  });

  it('casts from the account and the shared library, and adds a shared voice by its owner', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    const voices = await speech.searchVoices({ language: 'fr', gender: 'female' }, call);
    expect(voices.map((voice) => voice.id)).toEqual(['v_fr_f', 'shared_fr_f']);
    expect(voices[0]).toMatchObject({ publicOwnerId: null, locale: 'fr-FR', gender: 'female', category: 'professional' });
    expect(voices[1]).toMatchObject({
      publicOwnerId: 'owner_1',
      name: 'Élodie',
      previewUrl: 'https://example.test/elodie.mp3',
      accent: 'parisian',
    });
    const search = vendors.calls.find((entry) => entry.path.startsWith('/v1/shared-voices'))!;
    expect(search.path).toContain('language=fr');
    expect(search.path).toContain('gender=female');

    const added = await speech.addVoice(voices[1]!, call);
    expect(added).toEqual({ voiceId: 'added_fr_f' });
    const add = vendors.calls.find((entry) => entry.path.startsWith('/v1/voices/add/'))!;
    expect(add.path).toBe('/v1/voices/add/owner_1/shared_fr_f');
    expect(add.body).toEqual({ new_name: 'Élodie' });
  });

  it('clones only under a consent that covers the organisation, and records it', async () => {
    const sink = new NullCostSink();
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, costSink: sink });
    const clone = {
      name: 'Amine',
      samples: [{ data: new Uint8Array(PCM), contentType: 'audio/wav', filename: 'take-1.wav' }],
      language: 'fr',
    };
    await expect(speech.cloneVoice(clone, { ...consent, revokedAt: '2026-02-01T00:00:00.000Z' }, call)).rejects.toThrow(
      /consent/,
    );
    await expect(speech.cloneVoice(clone, { ...consent, organizationId: 'org_other' }, call)).rejects.toThrow(/consent/);
    expect(vendors.calls).toHaveLength(0);

    const made = await speech.cloneVoice(clone, consent, call);
    expect(made).toEqual({ voiceId: 'cloned_new' });
    const request = vendors.calls[0]!;
    expect(request.path).toBe('/v1/voices/add');
    expect(request.fields).toEqual(['name', 'remove_background_noise', 'labels', 'files']);
    expect(sink.records[0]).toMatchObject({
      operation: 'speech.clone',
      metadata: { voiceId: 'cloned_new', subject: 'Amine' },
    });

    await speech.deleteVoice('cloned_new', call);
    expect(vendors.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/voices/cloned_new' });
  });

  it('reads a cloned voice under consent, and refuses a revoked one', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    await speech.synthesizeWithVoice(
      { text: 'Bonjour.', persona: 'brand_custom', voiceId: 'v_clone', language: 'fr' },
      consent,
      call,
    );
    expect(tts()?.path).toMatch(/^\/v1\/text-to-speech\/v_clone\?/);
    await expect(
      speech.synthesizeWithVoice(
        { text: 'Bonjour.', persona: 'brand_custom', voiceId: 'v_clone', language: 'fr' },
        { ...consent, revokedAt: '2026-02-01T00:00:00.000Z' },
        call,
      ),
    ).rejects.toThrow(/consent/);
  });

  it('reports the library on a good key, and a rejected key in words without it', async () => {
    const good = await new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url }).health();
    expect(good.healthy).toBe(true);
    expect(good.message).toBe('5 voices across 3 languages; eleven_v3 for finals, eleven_flash_v2_5 for previews.');

    const bad = await new ElevenLabsProvider({ apiKey: 'el_wrong_key', baseUrl: vendors.url }).health();
    expect(bad.healthy).toBe(false);
    expect(bad.message).toMatch(/rejected the API key/);
    expect(bad.message).not.toContain('el_wrong_key');
  });

  it('writes a correct WAV header', () => {
    const wav = pcmToWav(new Uint8Array(1000), 24_000);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(36 + 1000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(1000);
  });
});

describe('the registry', () => {
  it('serves finals, previews and the recogniser from the console’s choices, and falls back without a key', () => {
    const openai = (options: { transcriptionModel?: string }) =>
      new OpenAiSpeechProvider({ apiKey: 'sk-test', ...options });
    const elevenlabs = () => new ElevenLabsProvider({ apiKey: 'el_test_key' });

    const premium = speechOverrides(
      ProviderRegistry.prototype.constructor.length >= 0
        ? {
            primary: 'elevenlabs',
            preview: 'openai-speech',
            recognizer: 'openai-speech',
            enabled: true,
            cloning: false,
            takes: 2,
            maxRegenerations: 1,
            maxCostPerProjectUsd: 0,
            curated: {},
          }
        : (undefined as never),
      { openai, elevenlabs },
    );
    expect(premium.speech.name).toBe('elevenlabs');
    expect(premium.speechPreview?.name).toBe('openai-speech');
    expect(premium.recognizer.name).toBe('openai-speech');
    // One OpenAI instance serves both roles.
    expect(premium.speechPreview).toBe(premium.recognizer);

    const registry = new ProviderRegistry({ overrides: premium });
    expect(registry.speech('final').name).toBe('elevenlabs');
    expect(registry.speech('preview').name).toBe('openai-speech');
    expect(registry.speech().name).toBe('elevenlabs');
    expect(registry.recognizer().name).toBe('openai-speech');

    // Chosen but without a key: OpenAI reads, rather than nothing.
    const keyless = speechOverrides(
      { primary: 'elevenlabs', preview: 'same', recognizer: 'elevenlabs', enabled: true, cloning: false, takes: 1, maxRegenerations: 1, maxCostPerProjectUsd: 0, curated: {} },
      { openai, elevenlabs: null },
    );
    expect(keyless.speech.name).toBe('openai-speech');
    expect(keyless.speechPreview).toBeUndefined();
    expect(keyless.recognizer.name).toBe('openai-speech');
  });

  it('hands the scoring engines the key the console stored, not the environment', async () => {
    /*
     * The bug this exists to prevent: a registry that builds its own
     * ElevenLabs from `process.env` finds nothing in a real deployment, where
     * the key lives encrypted in the console, and quietly plays the library
     * instead of the score. The film still comes out, which is why nobody
     * would notice.
     */
    const openai = new OpenAiSpeechProvider({ apiKey: 'sk-test', baseUrl: vendors.url });
    const stored = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    const config = {
      primary: 'elevenlabs' as const,
      preview: 'same' as const,
      recognizer: 'openai-speech' as const,
      enabled: true,
      cloning: false,
      takes: 1,
      maxRegenerations: 1,
      maxCostPerProjectUsd: 0,
      curated: {},
    };

    const overrides = speechOverrides(config, { openai: () => openai, elevenlabs: () => stored });
    expect(overrides.composer).toBe(stored);
    expect(overrides.soundEffects).toBe(stored);
    expect(overrides.aligner).toBe(stored);

    const registry = new ProviderRegistry({ overrides });
    expect(registry.composerOrNull()).toBe(stored);
    expect(registry.alignerOrNull()).toBe(stored);

    // No key stored: nothing to score with, and the library plays.
    const none = speechOverrides(config, { openai: () => openai, elevenlabs: null });
    expect(none.composer).toBeUndefined();
    expect(new ProviderRegistry({ overrides: none }).composerOrNull()).toBeNull();
  });
});

/**
 * The score, the built sounds, and where every word actually fell.
 *
 * What is proved here is the contract, because the whole value of the score is
 * that the engine is told the film's own turns: a plan whose movements do not
 * carry the right lengths produces a track, not a score, and the difference
 * is invisible until somebody watches the film.
 */
describe('scoring a film', () => {
  const engine = () => new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url, costSink: new NullCostSink() });

  it('sends the film’s turns as the plan, instrumental and to length', async () => {
    const composed = await engine().compose(
      {
        movements: [
          { text: '[Open] Hold one idea.', durationMs: 6000, positiveStyles: ['low sustained synth'], negativeStyles: ['vocals'], adherence: 'high' },
          { text: '[Resolve] Land it.', durationMs: 7400, positiveStyles: ['piano'], negativeStyles: ['drums'], adherence: 'medium' },
        ],
        instrumental: true,
        seed: 42,
      },
      call,
    );
    expect(composed.contentType).toBe('audio/mpeg');
    expect(composed.durationSeconds).toBeCloseTo(13.4, 2);

    const request = vendors.calls.find((entry) => entry.path.startsWith('/v1/music'));
    const body = request?.body as Record<string, unknown>;
    expect(body['force_instrumental']).toBe(true);
    // Without this the music drifts off the picture within a few seconds.
    expect(body['respect_sections_durations']).toBe(true);
    expect(body['seed']).toBe(42);
    const chunks = (body['composition_plan'] as { chunks: Record<string, unknown>[] }).chunks;
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ duration_ms: 6000, context_adherence: 'high' });
    expect(chunks[1]).toMatchObject({ duration_ms: 7400, context_adherence: 'medium' });
  });

  it('refuses a movement the engine cannot compose, rather than sending it', async () => {
    await expect(
      engine().compose(
        { movements: [{ text: 'too short', durationMs: 900, positiveStyles: ['piano'], negativeStyles: [], adherence: 'high' }], instrumental: true },
        call,
      ),
    ).rejects.toThrow(/between 3 and 120 seconds/);
    expect(vendors.calls.find((entry) => entry.path.startsWith('/v1/music'))).toBeUndefined();
  });

  it('builds one sound from a brief, clamped to what the engine accepts', async () => {
    const built = await engine().effect({ brief: 'A short dry wooden knock, close-miked, almost no tail.', seconds: 40, influence: 0.8, loop: false }, call);
    expect(built.contentType).toBe('audio/mpeg');
    const body = vendors.calls.find((entry) => entry.path.startsWith('/v1/sound-generation'))?.body as Record<string, unknown>;
    expect(body['duration_seconds']).toBe(22);
    expect(body['prompt_influence']).toBe(0.8);
    expect(body['loop']).toBeUndefined();
  });

  it('says where each word fell, and drops what is not a word', async () => {
    const alignment = await engine().align(new Uint8Array([1, 2, 3]), 'A week later.', call);
    expect(alignment.words.map((word) => word.word)).toEqual(['A', 'week', 'later.']);
    expect(alignment.seconds).toBeCloseTo(1.4, 2);
    // A doubtful stretch is reported as doubtful rather than shipped as fact.
    expect(alignment.words.at(-1)?.confidence).toBeCloseTo(0.1, 2);
    const request = vendors.calls.find((entry) => entry.path === '/v1/forced-alignment');
    expect(request?.fields).toContain('text');
  });

  it('will not align nothing', async () => {
    await expect(engine().align(new Uint8Array(), 'words', call)).rejects.toThrow(/both the recording and the words/);
    await expect(engine().align(new Uint8Array([1]), '  ', call)).rejects.toThrow(/both the recording and the words/);
  });
});
