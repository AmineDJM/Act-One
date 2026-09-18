import { z } from 'zod';
import { AppError, languageName } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { estimateNarrationSeconds } from './openai.ts';
import {
  consentCovers,
  defaultGender,
  type SpeechProvider,
  type SpeechRequest,
  type SpeechResult,
  type VoiceConsent,
  type VoicePersona,
} from './types.ts';

/**
 * ElevenLabs: the voice that does not sound synthesised.
 *
 * The voice is chosen from the account's library for the language the line
 * is written in and for who was asked to read it, so a French film is read
 * by a voice that speaks French, not by an English voice doing its best. The
 * library is read once an hour; when it cannot be, a small table of the
 * vendor's stock voices stands in.
 */
const Voice = z.object({
  voice_id: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  labels: z.record(z.string(), z.string().nullable()).optional(),
  verified_languages: z
    .array(
      z.object({
        language: z.string().optional(),
        model_id: z.string().optional(),
        accent: z.string().optional(),
      }),
    )
    .optional(),
});
type Voice = z.infer<typeof Voice>;

const VoiceList = z.object({
  voices: z.array(Voice),
  total_count: z.number().optional(),
  has_more: z.boolean().optional(),
});

/** The vendor's stock voices, when the library cannot be read. */
const STOCK: Record<'female' | 'male', Record<Exclude<VoicePersona, 'brand_custom'>, string>> = {
  female: {
    narrator_neutral: '21m00Tcm4TlvDq8ikWAM',
    narrator_warm: 'EXAVITQu4vr4xnSDxMaL',
    narrator_low: 'XB0fDUlXrJqFGgFRE8W6',
  },
  male: {
    narrator_neutral: 'pNInz6obpgDQGcFmaJgB',
    narrator_warm: 'ErXwobaYiN019PkySvjV',
    narrator_low: 'VR6AewLTigWG4xSOukaG',
  },
};

/** How each register is asked for. Style is expressiveness; stability is the opposite. */
const SETTINGS: Record<
  Exclude<VoicePersona, 'brand_custom'>,
  { stability: number; style: number }
> = {
  narrator_neutral: { stability: 0.5, style: 0.1 },
  narrator_warm: { stability: 0.4, style: 0.35 },
  narrator_low: { stability: 0.6, style: 0.15 },
};

const NARRATION_USE_CASES = new Set([
  'narration',
  'narrative_story',
  'narrative',
  'informative_educational',
  'audiobook',
  'news',
  'advertisement',
  'documentary',
]);

/** USD per 1M characters: the vendor's Scale tier, which a studio's volume lands on. */
const COST_PER_MILLION_CHARS = 150;

const CATALOGUE_TTL_MS = 60 * 60_000;

export type ElevenLabsConfig = {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  costSink?: CostSink;
};

export class ElevenLabsProvider implements SpeechProvider {
  readonly name = 'elevenlabs';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly costSink: CostSink | undefined;
  private catalogue: { voices: Voice[]; at: number } | null = null;

  constructor(config: ElevenLabsConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '').trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.elevenlabs.io')
      .replace(/\/$/, '')
      .replace(/\/v1$/, '');
    this.modelId = config.modelId ?? 'eleven_multilingual_v2';
    this.costSink = config.costSink;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Reads the voice library: proves the key, and says how many voices it can choose from. */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'speech' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'ElevenLabs API key not configured.' };
    }
    const startedAt = Date.now();
    try {
      const voices = await this.loadCatalogue();
      const languages = new Set<string>();
      for (const voice of voices) {
        for (const verified of voice.verified_languages ?? []) {
          if (verified.language) languages.add(verified.language);
        }
      }
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: `${voices.length} voices${languages.size > 0 ? ` across ${languages.size} languages` : ''}, on ${this.modelId}.`,
      };
    } catch (error) {
      return {
        ...base,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async synthesize(request: SpeechRequest, context: CallContext): Promise<SpeechResult> {
    return this.call(request, await this.voiceFor(request), context);
  }

  async synthesizeWithVoice(
    request: SpeechRequest & { voiceId: string },
    consent: VoiceConsent,
    context: CallContext,
  ): Promise<SpeechResult> {
    if (
      !consentCovers(consent, {
        organizationId: context.organizationId,
        projectId: context.projectId ?? '',
      })
    ) {
      throw new AppError('forbidden', 'No valid voice consent on record for this project.');
    }
    return this.call(request, request.voiceId, context);
  }

  /**
   * The voice for this line: one that speaks its language, of the gender
   * asked for, made for narration where the library says so.
   */
  async voiceFor(request: SpeechRequest): Promise<string> {
    const persona = request.persona === 'brand_custom' ? 'narrator_neutral' : request.persona;
    const gender = request.gender ?? defaultGender(persona);
    const language = request.language?.toLowerCase() ?? null;
    const name = language ? (languageName(language)?.toLowerCase() ?? null) : null;

    let voices: Voice[] = [];
    try {
      voices = await this.loadCatalogue();
    } catch {
      return STOCK[gender][persona];
    }

    let best: { voice: Voice; score: number } | null = null;
    for (const voice of voices) {
      const labels = voice.labels ?? {};
      const voiceGender = (labels['gender'] ?? '').toLowerCase();
      let score = 0;
      // The wrong gender is not a worse match; it is not a match.
      if (voiceGender && voiceGender !== gender) continue;
      if (voiceGender === gender) score += 3;
      if (language) {
        const verified = (voice.verified_languages ?? []).some(
          (v) => v.language?.toLowerCase() === language,
        );
        const spoken = (labels['language'] ?? '').toLowerCase();
        const accent = (labels['accent'] ?? '').toLowerCase();
        const labelled =
          spoken === language || (name !== null && (spoken === name || accent.includes(name)));
        // A voice that does not speak the language is not a candidate: a
        // French voice reading German is no better than a stock one.
        if (!verified && !labelled) continue;
        score += verified ? 4 : 0;
        score += labelled ? 3 : 0;
      }
      if (NARRATION_USE_CASES.has((labels['use_case'] ?? '').toLowerCase())) score += 1;
      if (voice.category === 'premade' || voice.category === 'professional') score += 1;
      if (!best || score > best.score) best = { voice, score };
    }
    // A voice of the wrong gender that happens to speak the language is
    // still the wrong voice; below this the library had nothing right.
    return best && best.score >= 3 ? best.voice.voice_id : STOCK[gender][persona];
  }

  private async loadCatalogue(): Promise<Voice[]> {
    if (this.catalogue && Date.now() - this.catalogue.at < CATALOGUE_TTL_MS) {
      return this.catalogue.voices;
    }
    const voices: Voice[] = [];
    let token: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query = new URLSearchParams({ page_size: '100' });
      if (token) query.set('next_page_token', token);
      const raw = await this.get(`/v2/voices?${query.toString()}`);
      const parsed = VoiceList.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderError(
          this.name,
          'ElevenLabs answered the voice library with something unexpected.',
          {
            retryable: true,
          },
        );
      }
      voices.push(...parsed.data.voices);
      const next = (raw as { next_page_token?: string | null }).next_page_token ?? null;
      if (!parsed.data.has_more || !next) break;
      token = next;
    }
    this.catalogue = { voices, at: Date.now() };
    return voices;
  }

  private async call(
    request: SpeechRequest,
    voiceId: string,
    context: CallContext,
  ): Promise<SpeechResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'ElevenLabs is not configured.', { retryable: false });
    }
    const text = request.text.trim();
    if (!text) throw new ProviderError(this.name, 'Refusing to synthesise empty narration.');

    const format = request.format ?? 'mp3';
    // WAV is not a format the vendor sends; raw PCM is, and a header is ours to write.
    const output =
      format === 'wav' ? 'pcm_24000' : format === 'opus' ? 'opus_48000_128' : 'mp3_44100_128';
    const persona = request.persona === 'brand_custom' ? 'narrator_neutral' : request.persona;
    const settings = SETTINGS[persona];

    let audio: Uint8Array;
    try {
      audio = await httpRequest<Uint8Array>(
        this.name,
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${output}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            accept: format === 'wav' ? 'application/octet-stream' : 'audio/mpeg',
          },
          body: {
            text,
            model_id: this.modelId,
            voice_settings: {
              stability: settings.stability,
              similarity_boost: 0.75,
              style: settings.style,
              use_speaker_boost: true,
              speed: Math.min(1.2, Math.max(0.7, request.rate ?? 1)),
            },
            // The multilingual model reads the language off the text and
            // refuses to be told; the flash and turbo models take a hint.
            ...(request.language && /flash|turbo/.test(this.modelId)
              ? { language_code: request.language }
              : {}),
          },
          expect: 'buffer',
          timeoutMs: 120_000,
          signal: context.signal,
        },
      );
    } catch (error) {
      throw this.describe(error);
    }

    const costUsd = (text.length / 1_000_000) * COST_PER_MILLION_CHARS;
    await this.costSink?.record({
      provider: this.name,
      model: this.modelId,
      operation: 'speech.tts',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: text.length,
      unit: 'character',
      metadata: { projectId: context.projectId, sceneId: context.sceneId, voiceId },
    });

    return {
      audio: format === 'wav' ? pcmToWav(audio, 24_000) : audio,
      contentType: format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg',
      durationSecondsEstimate: estimateNarrationSeconds(text, request.rate ?? 1),
      costUsd,
      model: this.modelId,
    };
  }

  private async get(path: string): Promise<unknown> {
    try {
      return await httpRequest<unknown>(this.name, `${this.baseUrl}${path}`, {
        headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
        timeoutMs: 15_000,
        attempts: 2,
      });
    } catch (error) {
      throw this.describe(error);
    }
  }

  /** The vendor's status codes in words, with nothing of the key in them. */
  private describe(error: unknown): ProviderError {
    if (!(error instanceof ProviderError)) {
      return new ProviderError(this.name, String(error), { retryable: true, cause: error });
    }
    if (error.status === 401) {
      return new ProviderError(this.name, 'ElevenLabs rejected the API key.', {
        retryable: false,
        status: 401,
      });
    }
    if (error.status === 402) {
      return new ProviderError(this.name, 'The ElevenLabs account is out of characters.', {
        retryable: false,
        status: 402,
      });
    }
    if (error.status === 429) {
      return new ProviderError(this.name, 'ElevenLabs is rate-limiting this account.', {
        retryable: true,
        status: 429,
      });
    }
    return error;
  }
}

/** A RIFF/WAVE header around 16-bit mono PCM. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
