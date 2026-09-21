import { estimateNarrationSeconds, type VoiceDirection } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { pcmToWav } from './elevenlabs.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import {
  defaultGender,
  voiceDirection,
  type SpeechProvider,
  type SpeechRequest,
  type SpeechResult,
  type VoiceConsent,
  type VoicePersona,
} from './types.ts';

/**
 * Gemini as a voice.
 *
 * This engine exists because the other two stopped answering: the ElevenLabs
 * key is rejected, OpenAI's TTS returns 429 with no credits, and Runway's
 * speech endpoint — which proxies ElevenLabs — turns out to accept only
 * `seed_audio` with `voice: { type: 'reference-audio', audioUri }`, which is
 * voice CLONING and needs a recording of a real person we do not have and
 * would need consent for. Gemini is the one path to narration that is both
 * available and does not start by copying somebody's voice.
 *
 * Two things make it a good fit rather than merely an available one. It takes
 * the performance direction as prose in the prompt, which is exactly the shape
 * `voiceDirection()` already produces for OpenAI's `instructions`. And it is
 * natively multilingual from the text alone, so a French line is read in
 * French without a language flag.
 *
 * It returns headerless PCM. The RIFF header is written here rather than by
 * the caller, because every consumer downstream — `analyseVoice`,
 * `stitchVoice`, the mix — takes a file, and a file needs a header.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** What the vendor returns: signed 16-bit little-endian mono at this rate. */
const SAMPLE_RATE = 24_000;
const CHANNELS = 1;

/**
 * The prebuilt voices, chosen by who reads and in what register.
 *
 * The vendor ships about thirty, each with a one-word character. These are the
 * six that match the personas the rest of the system already speaks in; the
 * names are the vendor's and are passed through untranslated.
 */
const VOICES: Record<'female' | 'male', Record<Exclude<VoicePersona, 'brand_custom'>, string>> = {
  female: { narrator_neutral: 'Erinome', narrator_warm: 'Sulafat', narrator_low: 'Gacrux' },
  male: { narrator_neutral: 'Charon', narrator_warm: 'Achird', narrator_low: 'Alnilam' },
};

/** USD per 1M characters. */
const COST_PER_MILLION_CHARS = 10;

export type GeminiSpeechConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  costSink?: CostSink;
};

export class GeminiSpeechProvider implements SpeechProvider {
  readonly name = 'gemini-speech';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: GeminiSpeechConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? 'gemini-2.5-pro-preview-tts';
    this.costSink = config.costSink;
  }

  async health(): Promise<ProviderHealth> {
    return { provider: this.name, kind: 'speech', healthy: true, checkedAt: new Date().toISOString() };
  }

  async synthesize(request: SpeechRequest, context: CallContext): Promise<SpeechResult> {
    return this.call(request, this.voiceFor(request), context);
  }

  /**
   * There is no cloning path on this engine.
   *
   * The vendor offers prebuilt voices only, so a brand voice cannot be
   * honoured here even with consent in hand. Saying so is better than
   * silently reading the line in a stock voice and filing it under the
   * founder's name.
   */
  async synthesizeWithVoice(
    request: SpeechRequest & { voiceId: string },
    _consent: VoiceConsent,
    _context: CallContext,
  ): Promise<SpeechResult> {
    throw new ProviderError(
      this.name,
      `This engine has prebuilt voices only and cannot read as "${request.voiceId}". Use an engine with a cloning path.`,
      { retryable: false },
    );
  }

  /** The voice for who was asked for, or for the register when nobody was. */
  voiceFor(request: SpeechRequest): string {
    const persona = request.direction
      ? personaFor(request.direction)
      : request.persona === 'brand_custom'
        ? 'narrator_neutral'
        : request.persona;
    const gender = request.direction?.gender ?? request.gender ?? defaultGender(persona);
    return VOICES[gender][persona];
  }

  private async call(request: SpeechRequest, voice: string, context: CallContext): Promise<SpeechResult> {
    const text = request.text.trim();
    if (!text) throw new ProviderError(this.name, 'Refusing to synthesise empty narration.');

    /*
     * The direction and the line, in one prompt.
     *
     * This engine has no separate instructions field: it reads the prompt and
     * decides which part of it is the performance note and which part is the
     * line. The colon and the quotes are what keep that boundary legible — a
     * direction ending in a full stop gets read aloud often enough to be worth
     * the punctuation.
     */
    const direction = voiceDirection(request);
    const prompt = `${direction}\n\nRead exactly this line, and say nothing else:\n"${text}"`;

    const response = await httpRequest<GeminiSpeechResponse>(
      this.name,
      `${this.baseUrl}/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        },
        timeoutMs: 180_000,
        attempts: 2,
        signal: context.signal,
      },
    );

    const inline = response?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!inline?.data) {
      const reason = response?.candidates?.[0]?.finishReason ?? 'no reason given';
      throw new ProviderError(this.name, `The engine returned no audio (${reason}).`, { retryable: true });
    }

    const pcm = Buffer.from(inline.data, 'base64');
    const audio = pcmToWav(pcm, rateFromMimeType(inline.mimeType) ?? SAMPLE_RATE, CHANNELS);
    const costUsd = (text.length / 1_000_000) * COST_PER_MILLION_CHARS;

    await this.costSink?.record({
      provider: this.name,
      model: this.model,
      operation: 'speech.tts',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: text.length,
      unit: 'character',
      metadata: {
        projectId: context.projectId,
        sceneId: context.sceneId,
        voice,
        language: request.direction?.language ?? request.language ?? null,
        quality: request.quality ?? 'final',
      },
    });

    return {
      audio,
      contentType: 'audio/wav',
      // The real length is in the header; this is what the caller asked for.
      durationSecondsEstimate: estimateNarrationSeconds(text, request.rate ?? 1),
      costUsd,
      model: this.model,
      voiceId: voice,
      characters: text.length,
      requestId: null,
    };
  }

  private headers(): Record<string, string> {
    // Managed credentials are injected by the proxy; an unset key sends none.
    return this.apiKey ? { 'x-goog-api-key': this.apiKey } : {};
  }
}

type GeminiSpeechResponse = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
  }[];
};

/** `audio/L16;codec=pcm;rate=24000` — the rate is the only part that varies. */
function rateFromMimeType(mimeType: string | undefined): number | null {
  const match = /rate=(\d+)/.exec(mimeType ?? '');
  return match ? Number(match[1]) : null;
}

/** The register of a structured direction, in the terms of the six voices above. */
function personaFor(direction: VoiceDirection): Exclude<VoicePersona, 'brand_custom'> {
  if (direction.profile === 'warm') return 'narrator_warm';
  if (direction.style === 'cinematic' || direction.style === 'calm' || direction.energy === 'low') {
    return 'narrator_low';
  }
  return 'narrator_neutral';
}
