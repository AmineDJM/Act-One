import { AppError, NARRATION_WORDS_PER_SECOND } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import {
  consentCovers,
  type SpeechProvider,
  type SpeechRequest,
  type SpeechResult,
  type VoiceConsent,
  type VoicePersona,
} from './types.ts';

const PERSONA_VOICES: Record<VoicePersona, string> = {
  narrator_neutral: 'alloy',
  narrator_warm: 'nova',
  narrator_low: 'onyx',
  brand_custom: 'alloy',
};

/** USD per 1M characters. */
const COST_PER_MILLION_CHARS = 15;

export type OpenAiSpeechConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  costSink?: CostSink;
};

export class OpenAiSpeechProvider implements SpeechProvider {
  readonly name = 'openai-speech';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: OpenAiSpeechConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
      .replace(/\/$/, '');
    this.model = config.model ?? 'gpt-4o-mini-tts';
    this.costSink = config.costSink;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: 'speech',
      healthy: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async synthesize(request: SpeechRequest, context: CallContext): Promise<SpeechResult> {
    return this.call(request, PERSONA_VOICES[request.persona], context);
  }

  async synthesizeWithVoice(
    request: SpeechRequest & { voiceId: string },
    consent: VoiceConsent,
    context: CallContext,
  ): Promise<SpeechResult> {
    if (!consentCovers(consent, {
      organizationId: context.organizationId,
      projectId: context.projectId ?? '',
    })) {
      throw new AppError(
        'forbidden',
        'No valid voice consent on record for this project.',
        { publicMessage: 'We need recorded consent before using that voice.' },
      );
    }
    return this.call(request, request.voiceId, context);
  }

  private async call(
    request: SpeechRequest,
    voice: string,
    context: CallContext,
  ): Promise<SpeechResult> {
    const text = request.text.trim();
    if (!text) throw new ProviderError(this.name, 'Refusing to synthesise empty narration.');

    const format = request.format ?? 'mp3';
    const audio = await httpRequest<Uint8Array>(this.name, `${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: this.headers(),
      body: {
        model: this.model,
        voice,
        input: text,
        response_format: format,
        speed: request.rate ?? 1,
      },
      expect: 'buffer',
      timeoutMs: 120_000,
      attempts: 2,
      signal: context.signal,
    });

    const costUsd = (text.length / 1_000_000) * COST_PER_MILLION_CHARS;
    await this.costSink?.record({
      provider: this.name,
      model: this.model,
      operation: 'speech.tts',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: text.length,
      unit: 'character',
      metadata: { projectId: context.projectId, sceneId: context.sceneId },
    });

    return {
      audio,
      contentType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`,
      durationSecondsEstimate: estimateNarrationSeconds(text, request.rate ?? 1),
      costUsd,
      model: this.model,
    };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }
}

/**
 * Timing estimate used by the storyboard engine before any audio exists, so
 * scene durations can be set against real narration length rather than guessed
 * and then corrected after an expensive render.
 */
export function estimateNarrationSeconds(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const base = words / NARRATION_WORDS_PER_SECOND;
  // Sentence breaks carry real pauses; a naive words-per-second estimate runs
  // consistently short and pushes narration past the cut.
  const sentences = (text.match(/[.!?]+/g) ?? []).length;
  return Math.round(((base + sentences * 0.32) / rate) * 100) / 100;
}
