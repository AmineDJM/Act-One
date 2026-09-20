import { z } from 'zod';
import { AppError } from '@act-one/core';
import { httpRequest, sleep } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { voiceDirection } from './types.ts';
import type {
  EffectRequest,
  GeneratedEffect,
  SoundEffectEngine,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  VoiceConsent,
} from './types.ts';

/**
 * A way to the same voices when our own door is locked.
 *
 * The ElevenLabs integration in this package is correct and is staying exactly
 * as it is. What is wrong is the credential: every call returns
 * `invalid_api_key`, on voice, on music and on sound effects alike, which is
 * an account problem and not a code problem. Rewriting a working provider
 * around a bad key would leave us with a worse provider AND a bad key.
 *
 * What is true at the same time is that the other vendor already in this
 * building resells the same models — `eleven_v3`, `eleven_multilingual_v2`,
 * `eleven_text_to_sound_v2` — against a credential that does work. So this is
 * a second road to the same place, and it exists to keep films being made
 * until the key is replaced.
 *
 * Deliberately NOT a silent substitution. The registry has to choose this, the
 * health check says what it is, and every asset it produces is recorded under
 * this provider's name. A film whose voice quietly came from somewhere else
 * than the one the operator configured is the kind of thing nobody discovers
 * until they are comparing two masters and cannot say why they differ.
 *
 * Temporary, and written to be deletable: when the ElevenLabs credential is
 * replaced, the registry stops choosing this and nothing else has to change.
 */

const BASE_URL = 'https://api.dev.runwayml.com';
const API_VERSION = '2024-11-06';

/** A read, by tier. The account's own model identifiers. */
const VOICE_MODEL = { final: 'eleven_v3', preview: 'eleven_multilingual_v2' } as const;
const EFFECT_MODEL = 'eleven_text_to_sound_v2';

const Task = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'THROTTLED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  output: z.array(z.string()).optional(),
  failure: z.string().nullish(),
});

export type RunwayAudioConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
  /** The vendor voice id to read with. Required: there is no sane default voice. */
  voiceId?: string;
  polling?: { initialMs?: number; maxMs?: number };
};

export class RunwayAudioProvider implements SpeechProvider, SoundEffectEngine {
  readonly name = 'runway-audio';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly voiceId: string;
  private readonly polling: { initialMs: number; maxMs: number };

  constructor(config: RunwayAudioConfig = {}) {
    this.apiKey = (
      config.apiKey ??
      process.env['RUNWAY_API_KEY'] ??
      process.env['RUNWAYML_API_SECRET'] ??
      ''
    ).trim();
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.costSink = config.costSink;
    this.voiceId = (config.voiceId ?? process.env['RUNWAY_VOICE_ID'] ?? '').trim();
    this.polling = {
      initialMs: config.polling?.initialMs ?? 2_000,
      maxMs: config.polling?.maxMs ?? 8_000,
    };
  }

  isConfigured(): boolean {
    return canAuthenticate('runway', this.apiKey);
  }

  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'speech' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No Runway credential is configured.' };
    }
    const startedAt = Date.now();
    try {
      const org = await this.api(
        z.object({
          tier: z
            .object({ models: z.record(z.string(), z.unknown()).default({}) })
            .default({ models: {} }),
        }),
        'GET',
        '/v1/organization',
      );
      const models = Object.keys(org.tier.models);
      const voice = models.filter((name) => name.startsWith('eleven_'));
      if (voice.length === 0) {
        return {
          ...base,
          healthy: false,
          latencyMs: Date.now() - startedAt,
          message: 'This Runway account has no ElevenLabs-backed audio models enabled.',
        };
      }
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message:
          `Standing in for ElevenLabs through Runway: ${voice.length} Eleven-backed models` +
          `${this.voiceId ? '' : '. No voice id is configured, so reads will be refused rather than guessed'}.`,
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

  /**
   * A line, read.
   *
   * Refuses without a configured voice rather than picking one. A narrator is
   * a casting decision; an engine that silently chooses one produces a film
   * read by a stranger, and nobody notices until it is delivered.
   */
  async synthesize(request: SpeechRequest, context: CallContext): Promise<SpeechResult> {
    const voiceId = request.voiceId ?? this.voiceId;
    if (!voiceId) {
      throw new AppError(
        'provider_unavailable',
        'No voice is configured for the Runway audio stand-in, and a narrator is not something to guess at.',
      );
    }
    const model = request.quality === 'preview' ? VOICE_MODEL.preview : VOICE_MODEL.final;

    const created = await this.api(
      z.object({ id: z.string() }),
      'POST',
      '/v1/text_to_speech',
      {
        model,
        promptText: request.text,
        voice: { id: voiceId },
        // The performance brief the rest of the system already writes, handed
        // over unchanged so two engines can be given the same direction.
        ...(voiceDirection(request) ? { promptInstruction: voiceDirection(request) } : {}),
        ...(request.seed === null || request.seed === undefined ? {} : { seed: request.seed }),
      },
      context.signal,
    );

    const audio = await this.collect(created.id, context);
    const characters = request.text.length;

    await this.costSink?.record({
      provider: this.name,
      model,
      operation: 'speech.tts',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      quantity: characters,
      unit: 'character',
      succeeded: true,
      metadata: {
        organizationId: context.organizationId,
        projectId: context.projectId ?? null,
        standingInFor: 'elevenlabs',
      },
    });

    return {
      audio,
      contentType: 'audio/mpeg',
      // Estimated, and said so: this path returns a file rather than a
      // duration, and measuring it properly is the mixer's job.
      durationSecondsEstimate: Math.max(1, characters / 14),
      costUsd: 0,
      model,
      voiceId,
      characters,
    };
  }

  /**
   * Reading in a customer's own voice is not offered through this road.
   *
   * A cloned voice lives in the account that holds the consent record, and
   * that account is the ElevenLabs one. Routing a consented clone through a
   * reseller would use a voice the consent does not cover.
   */
  async synthesizeWithVoice(
    _request: SpeechRequest & { voiceId: string },
    _consent: VoiceConsent,
    _context: CallContext,
  ): Promise<SpeechResult> {
    throw new AppError(
      'provider_unavailable',
      'A consented brand voice is only read by the engine that holds the consent; restore the ElevenLabs credential.',
    );
  }

  /** One sound, built from what the shot does. */
  async effect(request: EffectRequest, context: CallContext): Promise<GeneratedEffect> {
    if (!request.brief.trim()) {
      throw new ProviderError(this.name, 'Refusing to build a sound from an empty brief.', {
        retryable: false,
      });
    }
    const created = await this.api(
      z.object({ id: z.string() }),
      'POST',
      '/v1/text_to_sound',
      {
        model: EFFECT_MODEL,
        promptText: request.brief,
        ...(request.seconds === null ? {} : { duration: request.seconds }),
        ...(request.loop ? { loop: true } : {}),
      },
      context.signal,
    );

    const audio = await this.collect(created.id, context);
    await this.costSink?.record({
      provider: this.name,
      model: EFFECT_MODEL,
      operation: 'speech.tts',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      quantity: request.seconds ?? 0,
      unit: 'second',
      succeeded: true,
      metadata: { organizationId: context.organizationId, standingInFor: 'elevenlabs' },
    });

    return {
      audio,
      contentType: 'audio/mpeg',
      seconds: request.seconds ?? 0,
      costUsd: 0,
      model: EFFECT_MODEL,
    };
  }

  // -------------------------------------------------------------------------

  /** Waits for the task, then fetches the bytes it points at. */
  private async collect(taskId: string, context: CallContext): Promise<Uint8Array> {
    const deadline = Date.now() + 5 * 60_000;
    let delay = this.polling.initialMs;

    while (Date.now() < deadline) {
      if (context.signal?.aborted) {
        throw new ProviderError(this.name, 'Cancelled.', { retryable: false });
      }
      const task = await this.api(
        Task,
        'GET',
        `/v1/tasks/${encodeURIComponent(taskId)}`,
        undefined,
        context.signal,
      );

      if (task.status === 'SUCCEEDED') {
        const url = task.output?.[0];
        if (!url) {
          throw new ProviderError(this.name, 'The task succeeded and produced no audio.', {
            retryable: true,
          });
        }
        // The output URL is the vendor's CDN and carries its own
        // authorisation; our credentials are deliberately not sent to it.
        return httpRequest<Uint8Array>(this.name, url, {
          method: 'GET',
          expect: 'buffer',
          attempts: 2,
          timeoutMs: 120_000,
          ...(context.signal ? { signal: context.signal } : {}),
        });
      }
      if (task.status === 'FAILED' || task.status === 'CANCELLED') {
        throw new ProviderError(this.name, task.failure ?? 'The audio could not be produced.', {
          retryable: false,
        });
      }
      await sleep(delay);
      delay = Math.min(this.polling.maxMs, Math.round(delay * 1.5));
    }
    throw new ProviderError(this.name, 'The audio task did not finish within five minutes.', {
      retryable: true,
    });
  }

  private headers(): Record<string, string> {
    const common = { accept: 'application/json', 'X-Runway-Version': API_VERSION };
    if (!this.apiKey && credentialIsManaged('runway')) return common;
    return { ...common, authorization: `Bearer ${this.apiKey}` };
  }

  private async api<T>(
    schema: z.ZodType<T>,
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${pathname}`, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: this.headers(),
      timeoutMs: 60_000,
      attempts: method === 'GET' ? 3 : 1,
      ...(signal ? { signal } : {}),
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, `Unexpected answer from ${pathname}.`, {
        retryable: true,
      });
    }
    return parsed.data;
  }
}
