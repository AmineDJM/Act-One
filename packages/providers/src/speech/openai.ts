import { AppError, NARRATION_WORDS_PER_SECOND, type VoiceDirection } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import {
  consentCovers,
  defaultGender,
  voiceDirection,
  type SpeechProvider,
  type SpeechRecognizer,
  type SpeechRequest,
  type SpeechResult,
  type TranscribeRequest,
  type Transcript,
  type VoiceConsent,
  type VoicePersona,
} from './types.ts';

/**
 * OpenAI's built-in voices, by who is asked for and the register the film
 * needs. Marin and cedar are the two OpenAI recommends for quality; the
 * older `tts-1` models do not have them and get the nearest of the nine
 * they do.
 */
const VOICES: Record<'female' | 'male', Record<Exclude<VoicePersona, 'brand_custom'>, string>> = {
  female: { narrator_neutral: 'marin', narrator_warm: 'coral', narrator_low: 'sage' },
  male: { narrator_neutral: 'cedar', narrator_warm: 'ash', narrator_low: 'onyx' },
};

const LEGACY_VOICES: Record<string, string> = {
  marin: 'nova',
  cedar: 'alloy',
  coral: 'shimmer',
  ash: 'echo',
  sage: 'nova',
};

/** USD per 1M characters. */
const COST_PER_MILLION_CHARS = 15;
/** USD per minute of audio transcribed. */
const COST_PER_TRANSCRIBED_MINUTE = 0.006;

export type OpenAiSpeechConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** The model that listens back for QA. Must return the language and word timings. */
  transcriptionModel?: string;
  costSink?: CostSink;
};

/**
 * OpenAI as a voice: the fallback engine, and the one that reads previews
 * when the premium engine is reserved for finals. It is also a recogniser,
 * so voice QA can listen with a different ear than the one that spoke.
 */
export class OpenAiSpeechProvider implements SpeechProvider, SpeechRecognizer {
  readonly name = 'openai-speech';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly transcriptionModel: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: OpenAiSpeechConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = (
      config.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.model = config.model ?? 'gpt-4o-mini-tts';
    this.transcriptionModel = config.transcriptionModel ?? 'whisper-1';
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
    return this.call(request, this.voiceFor(request), context);
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
      throw new AppError('forbidden', 'No valid voice consent on record for this project.', {
        publicMessage: 'We need recorded consent before using that voice.',
      });
    }
    return this.call(request, request.voiceId, context);
  }

  /** The voice for who was asked for, or for the register when nobody was. */
  voiceFor(request: SpeechRequest): string {
    const persona = request.direction
      ? personaFor(request.direction)
      : request.persona === 'brand_custom'
        ? 'narrator_neutral'
        : request.persona;
    const gender = request.direction?.gender ?? request.gender ?? defaultGender(persona);
    const voice = VOICES[gender][persona];
    return this.directable() ? voice : (LEGACY_VOICES[voice] ?? voice);
  }

  /** Only the instructable model takes a direction; the older ones ignore it. */
  private directable(): boolean {
    return this.model.startsWith('gpt-');
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
        // Language, accent and register, said to the model: this is what
        // stops a French line being read with an American accent.
        ...(this.directable() ? { instructions: voiceDirection(request) } : {}),
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
      contentType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`,
      durationSecondsEstimate: estimateNarrationSeconds(text, request.rate ?? 1),
      costUsd,
      model: this.model,
      voiceId: voice,
      characters: text.length,
      requestId: null,
    };
  }

  /**
   * Listens back with Whisper, which is the one transcription model that
   * says which language it heard and when each word was said — both of
   * which the QA needs and neither of which the newer models return.
   */
  async transcribe(request: TranscribeRequest, context: CallContext): Promise<Transcript> {
    if (request.audio.byteLength === 0) {
      throw new ProviderError(this.name, 'Refusing to transcribe an empty recording.');
    }
    const form = new FormData();
    form.set('model', this.transcriptionModel);
    form.set('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.set(
      'file',
      new Blob([request.audio as BlobPart], { type: request.contentType }),
      `audio.${extensionFor(request.contentType)}`,
    );

    const raw = await httpRequest<WhisperResponse>(this.name, `${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      timeoutMs: 120_000,
      attempts: 2,
      signal: context.signal,
    });

    const duration = typeof raw?.duration === 'number' ? raw.duration : null;
    const costUsd = ((duration ?? 0) / 60) * COST_PER_TRANSCRIBED_MINUTE;
    await this.costSink?.record({
      provider: this.name,
      model: this.transcriptionModel,
      operation: 'speech.stt',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: duration ?? 0,
      unit: 'second',
      metadata: { projectId: context.projectId, sceneId: context.sceneId },
    });

    return {
      text: String(raw?.text ?? '').trim(),
      language: languageCode(raw?.language),
      languageConfidence: null,
      durationSeconds: duration,
      words: (raw?.words ?? [])
        .filter((word) => typeof word.word === 'string')
        .map((word) => ({ word: word.word, start: Number(word.start ?? 0), end: Number(word.end ?? 0) })),
      model: this.transcriptionModel,
    };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }
}

type WhisperResponse = {
  text?: string;
  language?: string;
  duration?: number;
  words?: { word: string; start?: number; end?: number }[];
};

/** The register of a structured direction, in the terms of the six built-in voices. */
function personaFor(direction: VoiceDirection): Exclude<VoicePersona, 'brand_custom'> {
  if (direction.profile === 'warm') return 'narrator_warm';
  if (direction.style === 'cinematic' || direction.style === 'calm' || direction.energy === 'low') {
    return 'narrator_low';
  }
  return 'narrator_neutral';
}

function extensionFor(contentType: string): string {
  if (/wav/.test(contentType)) return 'wav';
  if (/ogg|opus/.test(contentType)) return 'ogg';
  if (/mp4|m4a|aac/.test(contentType)) return 'm4a';
  if (/webm/.test(contentType)) return 'webm';
  if (/flac/.test(contentType)) return 'flac';
  return 'mp3';
}

/** Whisper names the language in English; the rest of the system speaks ISO 639-1. */
const ISO_BY_ENGLISH_NAME: Record<string, string> = {
  english: 'en', french: 'fr', german: 'de', spanish: 'es', italian: 'it', portuguese: 'pt',
  dutch: 'nl', swedish: 'sv', danish: 'da', norwegian: 'nb', finnish: 'fi', polish: 'pl',
  turkish: 'tr', japanese: 'ja', korean: 'ko', chinese: 'zh', arabic: 'ar', hindi: 'hi',
  russian: 'ru', ukrainian: 'uk', czech: 'cs', greek: 'el', hebrew: 'he', hungarian: 'hu',
  romanian: 'ro', bulgarian: 'bg', croatian: 'hr', slovak: 'sk', slovenian: 'sl', catalan: 'ca',
  indonesian: 'id', malay: 'ms', vietnamese: 'vi', thai: 'th', tamil: 'ta', filipino: 'fil',
  tagalog: 'tl', urdu: 'ur', persian: 'fa', bengali: 'bn', afrikaans: 'af', welsh: 'cy',
  icelandic: 'is', latvian: 'lv', lithuanian: 'lt', estonian: 'et', serbian: 'sr', swahili: 'sw',
};

export function languageCode(heard: string | null | undefined): string | null {
  if (!heard) return null;
  const key = heard.trim().toLowerCase();
  if (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(key)) return key.split('-')[0]!;
  return ISO_BY_ENGLISH_NAME[key] ?? null;
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
