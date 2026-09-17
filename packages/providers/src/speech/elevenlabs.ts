import { AppError } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { estimateNarrationSeconds } from './openai.ts';
import {
  consentCovers,
  type SpeechProvider,
  type SpeechRequest,
  type SpeechResult,
  type VoiceConsent,
  type VoicePersona,
} from './types.ts';

const PERSONA_VOICES: Record<VoicePersona, string> = {
  narrator_neutral: '21m00Tcm4TlvDq8ikWAM',
  narrator_warm: 'EXAVITQu4vr4xnSDxMaL',
  narrator_low: 'VR6AewLTigWG4xSOukaG',
  brand_custom: '21m00Tcm4TlvDq8ikWAM',
};

const COST_PER_MILLION_CHARS = 150;

export type ElevenLabsConfig = {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  costSink?: CostSink;
};

/**
 * Prepared second source for voice. Not enabled by default — we keep the
 * external surface at four providers until there is a reason to widen it.
 */
export class ElevenLabsProvider implements SpeechProvider {
  readonly name = 'elevenlabs';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: ElevenLabsConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? 'https://api.elevenlabs.io/v1').replace(/\/$/, '');
    this.modelId = config.modelId ?? 'eleven_multilingual_v2';
    this.costSink = config.costSink;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: 'speech',
      healthy: this.isConfigured(),
      checkedAt: new Date().toISOString(),
      message: this.isConfigured() ? undefined : 'ELEVENLABS_API_KEY not configured.',
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
      throw new AppError('forbidden', 'No valid voice consent on record for this project.');
    }
    return this.call(request, request.voiceId, context);
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
    const audio = await httpRequest<Uint8Array>(
      this.name,
      `${this.baseUrl}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, accept: 'audio/mpeg' },
        body: {
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.2 },
        },
        expect: 'buffer',
        timeoutMs: 120_000,
        signal: context.signal,
      },
    );

    const costUsd = (text.length / 1_000_000) * COST_PER_MILLION_CHARS;
    await this.costSink?.record({
      provider: this.name,
      model: this.modelId,
      operation: 'speech.tts',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: text.length,
      unit: 'character',
    });

    return {
      audio,
      contentType: 'audio/mpeg',
      durationSecondsEstimate: estimateNarrationSeconds(text, request.rate ?? 1),
      costUsd,
      model: this.modelId,
    };
  }
}
