import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ElevenLabsProvider, OpenAiSpeechProvider, NullCostSink, pcmToWav } from '../index.ts';

/**
 * The voice follows the language and the person asked for.
 *
 * Both vendors are stood up on loopback with their documented shapes: OpenAI's
 * speech endpoint, ElevenLabs' voice library and text-to-speech. What is
 * proved is the choice — a French line, a woman's voice — and the direction
 * given to the model, which is where an English accent on a French film
 * comes from when it is left out.
 */
type Call = { method: string; path: string; headers: IncomingMessage['headers']; body: unknown };

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
    const body: unknown = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
    this.calls.push({
      method: request.method ?? 'GET',
      path: url.pathname + url.search,
      headers: request.headers,
      body,
    });

    // OpenAI: bytes back, whatever the format.
    if (url.pathname === '/v1/audio/speech') {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end(Buffer.from('RIFF-fake'));
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
              labels: {
                gender: 'female',
                accent: 'american',
                language: 'en',
                use_case: 'narration',
              },
              verified_languages: [{ language: 'en', model_id: 'eleven_multilingual_v2' }],
            },
            {
              voice_id: 'v_fr_m',
              name: 'Louis',
              category: 'premade',
              labels: { gender: 'male', accent: 'french', language: 'fr', use_case: 'narration' },
              verified_languages: [{ language: 'fr', model_id: 'eleven_multilingual_v2' }],
            },
            {
              voice_id: 'v_fr_f',
              name: 'Charlotte',
              category: 'professional',
              labels: {
                gender: 'female',
                accent: 'french',
                language: 'fr',
                use_case: 'informative_educational',
              },
              verified_languages: [
                { language: 'fr', model_id: 'eleven_multilingual_v2' },
                { language: 'en', model_id: 'eleven_multilingual_v2' },
              ],
            },
            {
              voice_id: 'v_de_f',
              name: 'Anna',
              category: 'premade',
              labels: {
                gender: 'female',
                accent: 'german',
                language: 'de',
                use_case: 'conversational',
              },
              verified_languages: [{ language: 'de', model_id: 'eleven_multilingual_v2' }],
            },
          ],
          total_count: 4,
          has_more: false,
        }),
      );
      return;
    }
    if (url.pathname.startsWith('/v1/text-to-speech/')) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(PCM);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'not found' }));
  }
}

const vendors = new FakeVendors();
const call = { organizationId: 'org_1', projectId: 'prj_1', sceneId: 'scn_1' };

beforeAll(() => vendors.start());
afterAll(() => vendors.stop());
beforeEach(() => {
  vendors.calls = [];
});

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
    expect(sink.records[0]).toMatchObject({
      provider: 'openai-speech',
      operation: 'speech.tts',
      metadata: { voice: 'coral' },
    });
  });

  it("picks a man's voice when asked, and the register's default when not", () => {
    const speech = new OpenAiSpeechProvider({ apiKey: 'sk-test' });
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_neutral', gender: 'male' })).toBe(
      'cedar',
    );
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
    expect(speech.voiceFor({ text: 'x', persona: 'narrator_neutral', gender: 'female' })).toBe(
      'nova',
    );
    await speech.synthesize({ text: 'Hello.', persona: 'narrator_neutral' }, call);
    expect(vendors.calls[0]?.body).not.toHaveProperty('instructions');
  });
});

describe('ElevenLabs voices', () => {
  it('chooses a voice that speaks the language, of the gender asked for', async () => {
    const speech = new ElevenLabsProvider({ apiKey: 'el_test_key', baseUrl: vendors.url });
    expect(
      await speech.voiceFor({
        text: 'x',
        persona: 'narrator_neutral',
        language: 'fr',
        gender: 'female',
      }),
    ).toBe('v_fr_f');
    expect(
      await speech.voiceFor({
        text: 'x',
        persona: 'narrator_neutral',
        language: 'fr',
        gender: 'male',
      }),
    ).toBe('v_fr_m');
    expect(await speech.voiceFor({ text: 'x', persona: 'narrator_neutral', language: 'de' })).toBe(
      'v_de_f',
    );
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

  it('asks for raw PCM and returns a playable WAV, with the register and the speed', async () => {
    const sink = new NullCostSink();
    const speech = new ElevenLabsProvider({
      apiKey: 'el_test_key',
      baseUrl: vendors.url,
      costSink: sink,
    });
    const result = await speech.synthesize(
      {
        text: 'Le matin, tout est déjà rapproché.',
        persona: 'narrator_warm',
        language: 'fr',
        gender: 'female',
        rate: 0.9,
        format: 'wav',
      },
      call,
    );
    const tts = vendors.calls.find((entry) => entry.path.startsWith('/v1/text-to-speech/'));
    expect(tts?.path).toBe('/v1/text-to-speech/v_fr_f?output_format=pcm_24000');
    expect(tts?.body).toEqual({
      text: 'Le matin, tout est déjà rapproché.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true,
        speed: 0.9,
      },
    });
    expect(result.contentType).toBe('audio/wav');
    expect(Buffer.from(result.audio.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(result.audio.subarray(8, 12)).toString('ascii')).toBe('WAVE');
    expect(result.audio.byteLength).toBe(44 + PCM.byteLength);
    // Sample rate, as written in the header.
    expect(new DataView(result.audio.buffer, result.audio.byteOffset).getUint32(24, true)).toBe(
      24_000,
    );
    expect(sink.records[0]).toMatchObject({
      provider: 'elevenlabs',
      operation: 'speech.tts',
      metadata: { voiceId: 'v_fr_f' },
    });
  });

  it('gives the language hint only to the models that take one', async () => {
    const flash = new ElevenLabsProvider({
      apiKey: 'el_test_key',
      baseUrl: vendors.url,
      modelId: 'eleven_flash_v2_5',
    });
    await flash.synthesize({ text: 'Bonjour.', persona: 'narrator_neutral', language: 'fr' }, call);
    const tts = vendors.calls.find((entry) => entry.path.startsWith('/v1/text-to-speech/'));
    expect(tts?.body).toMatchObject({ model_id: 'eleven_flash_v2_5', language_code: 'fr' });
  });

  it('reports the library on a good key, and a rejected key in words without it', async () => {
    const good = await new ElevenLabsProvider({
      apiKey: 'el_test_key',
      baseUrl: vendors.url,
    }).health();
    expect(good.healthy).toBe(true);
    expect(good.message).toBe('4 voices across 3 languages, on eleven_multilingual_v2.');

    const bad = await new ElevenLabsProvider({
      apiKey: 'el_wrong_key',
      baseUrl: vendors.url,
    }).health();
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
