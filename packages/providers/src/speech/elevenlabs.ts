import { z } from 'zod';
import { AppError, languageName, type VoiceDirection, type VoiceGender } from '@act-one/core';
import { httpRequest } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { estimateNarrationSeconds } from './openai.ts';
import {
  consentCovers,
  defaultGender,
  type LibraryVoice,
  type SpeechProvider,
  type SpeechRecognizer,
  type SpeechRequest,
  type SpeechResult,
  type TranscribeRequest,
  type Transcript,
  type VoiceClone,
  type VoiceConsent,
  type VoiceLibrary,
  type VoicePersona,
  type VoiceSearch,
} from './types.ts';

/**
 * ElevenLabs: the premium voice engine.
 *
 * Finals are read on Eleven v3, the most expressive model the vendor has,
 * which takes a performance rather than a setting: stability in three tiers,
 * a sparing audio tag where the direction calls for one, and the lines
 * before and after so a long piece is one read. Previews go to the flash
 * model at a fraction of the price, because an animatic is for timing.
 *
 * The voice is cast, not defaulted: a curated set per language and accent
 * when the platform has one, the account's library otherwise (only voices
 * verified for the language, of the gender asked for), and the vendor's
 * stock voices last. A cloned voice is used only under a recorded consent;
 * there is no code path around that.
 */
const Voice = z.object({
  voice_id: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string().nullable()).optional(),
  verified_languages: z
    .array(
      z.object({
        language: z.string().optional(),
        model_id: z.string().optional(),
        accent: z.string().optional(),
        locale: z.string().optional(),
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

const SharedVoice = z.object({
  public_owner_id: z.string(),
  voice_id: z.string(),
  name: z.string(),
  accent: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  use_case: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  verified_languages: z
    .array(z.object({ language: z.string().optional(), locale: z.string().optional() }))
    .optional(),
});

const SharedVoiceList = z.object({ voices: z.array(SharedVoice), has_more: z.boolean().optional() });

const Scribe = z.object({
  language_code: z.string().nullable().optional(),
  language_probability: z.number().nullable().optional(),
  text: z.string(),
  words: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

/** The vendor's stock voices, when nothing better can be cast. */
const STOCK: Record<VoiceGender, Record<Exclude<VoicePersona, 'brand_custom'>, string>> = {
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

/** How each register is asked for on the older models. Style is expressiveness; stability is the opposite. */
const PERSONA_SETTINGS: Record<
  Exclude<VoicePersona, 'brand_custom'>,
  { stability: number; style: number }
> = {
  narrator_neutral: { stability: 0.5, style: 0.1 },
  narrator_warm: { stability: 0.4, style: 0.35 },
  narrator_low: { stability: 0.6, style: 0.15 },
};

/** v3 takes stability in three tiers, not a dial. */
const V3_STABILITY: Record<VoiceDirection['stability'], number> = {
  creative: 0.0,
  natural: 0.5,
  robust: 1.0,
};

const V2_STABILITY: Record<VoiceDirection['stability'], number> = {
  creative: 0.35,
  natural: 0.5,
  robust: 0.7,
};

const V2_STYLE: Record<VoiceDirection['profile'], number> = {
  premium: 0.15,
  warm: 0.35,
  neutral: 0.05,
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

/** USD per 1M characters on the vendor's Scale tier, which a studio's volume lands on. */
const COST_PER_MILLION_CHARS = 150;
/** The flash model is billed at half a character per character. */
const PREVIEW_COST_MULTIPLIER = 0.5;
/** USD per minute of audio transcribed by Scribe. */
const COST_PER_TRANSCRIBED_MINUTE = 0.4 / 60;

const CATALOGUE_TTL_MS = 60 * 60_000;

export const ELEVENLABS_MODELS = { final: 'eleven_v3', preview: 'eleven_flash_v2_5' } as const;

/**
 * A voice chosen by an operator for a language or a locale, a gender and a
 * profile: `{ 'fr-FR': { female: { premium: { voiceId, name } } } }`. The
 * locale is tried first, then the bare language.
 */
export type CuratedVoice = { voiceId: string; name: string };
export type CuratedVoices = Record<
  string,
  Partial<Record<VoiceGender, Partial<Record<VoiceDirection['profile'], CuratedVoice>>>>
>;

export type ElevenLabsConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** One model for both tiers. `models` is the finer setting. */
  modelId?: string;
  models?: { final?: string; preview?: string };
  curated?: CuratedVoices;
  costSink?: CostSink;
};

export class ElevenLabsProvider implements SpeechProvider, SpeechRecognizer, VoiceLibrary {
  readonly name = 'elevenlabs';
  readonly kind = 'speech' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly models: { final: string; preview: string };
  private readonly curated: CuratedVoices;
  private readonly costSink: CostSink | undefined;
  private catalogue: { voices: Voice[]; at: number } | null = null;

  constructor(config: ElevenLabsConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '').trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.elevenlabs.io')
      .replace(/\/$/, '')
      .replace(/\/v1$/, '');
    this.models = {
      final: config.models?.final ?? config.modelId ?? ELEVENLABS_MODELS.final,
      preview: config.models?.preview ?? config.modelId ?? ELEVENLABS_MODELS.preview,
    };
    this.curated = config.curated ?? {};
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
        message: `${voices.length} voices${languages.size > 0 ? ` across ${languages.size} languages` : ''}; ${this.models.final} for finals, ${this.models.preview} for previews.`,
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
      throw new AppError('forbidden', 'No valid voice consent on record for this project.', {
        publicMessage: 'We need recorded consent before using that voice.',
      });
    }
    return this.call(request, request.voiceId, context);
  }

  /**
   * Casts the voice: a named one when the request carries it and it is not a
   * clone, the curated voice for the locale or language, the best of the
   * library that speaks the language, and the stock voice last.
   */
  async voiceFor(request: SpeechRequest): Promise<string> {
    const direction = request.direction ?? null;
    const persona = request.persona === 'brand_custom' ? 'narrator_neutral' : request.persona;
    const gender = direction?.gender ?? request.gender ?? defaultGender(persona);
    const language = (direction?.language ?? request.language)?.toLowerCase() ?? null;
    const name = language ? (languageName(language)?.toLowerCase() ?? null) : null;

    if (request.voiceId) {
      // A brand voice from the library needs no consent; a cloned person does,
      // and only synthesizeWithVoice carries one. Unknown means refuse.
      if (!(await this.isCastable(request.voiceId))) {
        throw new AppError('forbidden', 'That voice is a clone and needs a consent record to be used.', {
          publicMessage: 'We need recorded consent before using that voice.',
        });
      }
      return request.voiceId;
    }

    const curated = this.curatedFor(language, direction?.locale ?? null, gender, direction?.profile ?? 'premium');
    if (curated) return curated;

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
        if (direction?.locale) {
          const wanted = direction.locale.toLowerCase();
          const atHome = (voice.verified_languages ?? []).some((v) => v.locale?.toLowerCase() === wanted);
          if (atHome) score += 2;
        }
      }
      if (NARRATION_USE_CASES.has((labels['use_case'] ?? '').toLowerCase())) score += 1;
      if (voice.category === 'premade' || voice.category === 'professional') score += 1;
      // A clone in the account is somebody's voice; it is never cast by accident.
      if (isClone(voice)) continue;
      if (!best || score > best.score) best = { voice, score };
    }
    // A voice of the wrong gender that happens to speak the language is
    // still the wrong voice; below this the library had nothing right.
    return best && best.score >= 3 ? best.voice.voice_id : STOCK[gender][persona];
  }

  /** The operator's choice for this locale or language, falling through the profiles. */
  private curatedFor(
    language: string | null,
    locale: string | null,
    gender: VoiceGender,
    profile: VoiceDirection['profile'],
  ): string | null {
    const keys = [locale, language].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const set = this.curated[key] ?? this.curated[key.toLowerCase()];
      const byProfile = set?.[gender];
      if (!byProfile) continue;
      const order: VoiceDirection['profile'][] =
        profile === 'warm'
          ? ['warm', 'premium', 'neutral']
          : profile === 'neutral'
            ? ['neutral', 'premium', 'warm']
            : ['premium', 'neutral', 'warm'];
      for (const candidate of order) {
        const voice = byProfile[candidate];
        if (voice?.voiceId) return voice.voiceId;
      }
    }
    return null;
  }

  /**
   * A voice may be cast by name when it is nobody's likeness held on trust:
   * the vendor's own, or a professional's shared in the library. A clone made
   * in this account carries the consent it was made under in its labels, and
   * is reached only through synthesizeWithVoice. Unknown fails closed.
   */
  private async isCastable(voiceId: string): Promise<boolean> {
    try {
      const voice = (await this.loadCatalogue()).find((entry) => entry.voice_id === voiceId);
      return Boolean(voice) && !isClone(voice!);
    } catch {
      return false;
    }
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
          { retryable: true },
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
    const source = request.text.trim();
    if (!source) throw new ProviderError(this.name, 'Refusing to synthesise empty narration.');

    const quality = request.quality ?? 'final';
    const model = quality === 'preview' ? this.models.preview : this.models.final;
    const v3 = isV3(model);
    const format = request.format ?? 'mp3';
    // WAV is not a format the vendor sends; raw PCM is, and a header is ours to write.
    const output =
      format === 'wav' ? 'pcm_24000' : format === 'opus' ? 'opus_48000_128' : 'mp3_44100_128';
    const language = (request.direction?.language ?? request.language)?.toLowerCase() ?? null;
    const text = v3 ? withAudioTags(source, request.direction) : source;
    const rate = Math.min(1.2, Math.max(0.7, request.rate ?? 1));

    let requestId: string | null = null;
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
            model_id: model,
            voice_settings: this.settingsFor(request, v3, rate),
            // The v3 and multilingual models read the language off the text and
            // refuse to be told; the flash and turbo models take a hint.
            ...(language && /flash|turbo/.test(model) ? { language_code: language } : {}),
            ...(request.continuity?.previousText ? { previous_text: request.continuity.previousText } : {}),
            ...(request.continuity?.nextText ? { next_text: request.continuity.nextText } : {}),
            ...(request.continuity?.previousRequestIds?.length
              ? { previous_request_ids: request.continuity.previousRequestIds.slice(-3) }
              : {}),
            ...(typeof request.seed === 'number' ? { seed: Math.abs(Math.floor(request.seed)) % 4_294_967_295 } : {}),
          },
          expect: 'buffer',
          timeoutMs: 120_000,
          signal: context.signal,
          onResponse: (response) => {
            requestId = response.headers.get('request-id');
          },
        },
      );
    } catch (error) {
      throw this.describe(error);
    }

    const costUsd =
      (source.length / 1_000_000) * COST_PER_MILLION_CHARS * (quality === 'preview' ? PREVIEW_COST_MULTIPLIER : 1);
    await this.costSink?.record({
      provider: this.name,
      model,
      operation: 'speech.tts',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: source.length,
      unit: 'character',
      metadata: {
        projectId: context.projectId,
        sceneId: context.sceneId,
        voiceId,
        language,
        quality,
        take: request.take ?? 'as_directed',
      },
    });

    return {
      audio: format === 'wav' ? pcmToWav(audio, 24_000) : audio,
      contentType: format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg',
      durationSecondsEstimate: estimateNarrationSeconds(source, rate),
      costUsd,
      model,
      voiceId,
      characters: source.length,
      requestId,
    };
  }

  /** The performance, in the terms each model generation understands. */
  private settingsFor(request: SpeechRequest, v3: boolean, rate: number): Record<string, number | boolean> {
    const direction = request.direction ?? null;
    const persona = request.persona === 'brand_custom' ? 'narrator_neutral' : request.persona;
    if (v3) {
      // Three tiers, nothing in between: v3 treats stability as a mode.
      return {
        stability: V3_STABILITY[direction?.stability ?? 'natural'],
        similarity_boost: 0.75,
        use_speaker_boost: true,
        // The pace lives in the copy and the direction; speed is the last resort the caller reaches for.
        ...(rate !== 1 ? { speed: rate } : {}),
      };
    }
    const stability = direction ? V2_STABILITY[direction.stability] : PERSONA_SETTINGS[persona].stability;
    const style = direction ? V2_STYLE[direction.profile] : PERSONA_SETTINGS[persona].style;
    return {
      stability,
      similarity_boost: 0.75,
      style,
      use_speaker_boost: true,
      speed: rate,
    };
  }

  // -------------------------------------------------------------------------
  // Listening back
  // -------------------------------------------------------------------------

  /** Scribe hears the language and every word, which is what QA compares against the script. */
  async transcribe(request: TranscribeRequest, context: CallContext): Promise<Transcript> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'ElevenLabs is not configured.', { retryable: false });
    }
    if (request.audio.byteLength === 0) {
      throw new ProviderError(this.name, 'Refusing to transcribe an empty recording.');
    }
    const form = new FormData();
    form.set('model_id', 'scribe_v1');
    form.set('timestamps_granularity', 'word');
    form.set('tag_audio_events', 'false');
    form.set('file', new Blob([request.audio as BlobPart], { type: request.contentType }), 'audio');

    let raw: unknown;
    try {
      raw = await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
        body: form,
        timeoutMs: 120_000,
        attempts: 2,
        signal: context.signal,
      });
    } catch (error) {
      throw this.describe(error);
    }
    const parsed = Scribe.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, 'ElevenLabs answered the transcription with something unexpected.', {
        retryable: true,
      });
    }
    const words = (parsed.data.words ?? [])
      .filter((word) => word.type !== 'spacing' && word.type !== 'audio_event' && word.text.trim())
      .map((word) => ({ word: word.text.trim(), start: word.start ?? 0, end: word.end ?? 0 }));
    const duration = words.length > 0 ? Math.max(...words.map((word) => word.end)) : null;
    const costUsd = ((duration ?? 0) / 60) * COST_PER_TRANSCRIBED_MINUTE;
    await this.costSink?.record({
      provider: this.name,
      model: 'scribe_v1',
      operation: 'speech.stt',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: duration ?? 0,
      unit: 'second',
      metadata: { projectId: context.projectId, sceneId: context.sceneId },
    });
    return {
      text: parsed.data.text.trim(),
      language: parsed.data.language_code ? parsed.data.language_code.toLowerCase().split(/[-_]/)[0]! : null,
      languageConfidence: parsed.data.language_probability ?? null,
      durationSeconds: duration,
      words,
      model: 'scribe_v1',
    };
  }

  // -------------------------------------------------------------------------
  // Casting and cloning
  // -------------------------------------------------------------------------

  /** The account's voices for the language first, then the vendor's shared library. */
  async searchVoices(query: VoiceSearch, _context: CallContext): Promise<LibraryVoice[]> {
    const language = query.language.toLowerCase();
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const own: LibraryVoice[] = [];
    try {
      for (const voice of await this.loadCatalogue()) {
        if (isClone(voice)) continue;
        const speaks =
          (voice.verified_languages ?? []).some((v) => v.language?.toLowerCase() === language) ||
          (voice.labels?.['language'] ?? '').toLowerCase() === language;
        if (!speaks) continue;
        const gender = genderOf(voice.labels?.['gender']);
        if (query.gender && gender && gender !== query.gender) continue;
        own.push({
          id: voice.voice_id,
          name: voice.name ?? voice.voice_id,
          publicOwnerId: null,
          language,
          locale: (voice.verified_languages ?? []).find((v) => v.language?.toLowerCase() === language)?.locale ?? null,
          accent: voice.labels?.['accent'] ?? null,
          gender,
          age: voice.labels?.['age'] ?? null,
          useCase: voice.labels?.['use_case'] ?? null,
          description: voice.description ?? voice.labels?.['description'] ?? null,
          previewUrl: voice.preview_url ?? null,
          category: voice.category ?? null,
        });
      }
    } catch {
      // The shared library still answers.
    }

    const params = new URLSearchParams({ language, page_size: String(limit), sort: 'trending' });
    if (query.gender) params.set('gender', query.gender);
    if (query.locale) params.set('locale', query.locale);
    params.set('use_cases', query.useCase ?? 'narrative_story');
    const parsed = SharedVoiceList.safeParse(await this.get(`/v1/shared-voices?${params.toString()}`));
    const shared: LibraryVoice[] = parsed.success
      ? parsed.data.voices.map((voice) => ({
          id: voice.voice_id,
          name: voice.name,
          publicOwnerId: voice.public_owner_id,
          language: voice.language?.toLowerCase() ?? language,
          locale: voice.locale ?? null,
          accent: voice.accent ?? null,
          gender: genderOf(voice.gender),
          age: voice.age ?? null,
          useCase: voice.use_case ?? null,
          description: voice.description ?? null,
          previewUrl: voice.preview_url ?? null,
          category: voice.category ?? null,
        }))
      : [];
    const seen = new Set(own.map((voice) => voice.id));
    return [...own, ...shared.filter((voice) => !seen.has(voice.id))].slice(0, limit + own.length);
  }

  /** Copies a shared-library voice into the account. Free; a slot, not a clone. */
  async addVoice(
    voice: Pick<LibraryVoice, 'id' | 'publicOwnerId' | 'name'>,
    _context: CallContext,
  ): Promise<{ voiceId: string }> {
    if (!voice.publicOwnerId) return { voiceId: voice.id };
    let raw: unknown;
    try {
      raw = await httpRequest<unknown>(
        this.name,
        `${this.baseUrl}/v1/voices/add/${encodeURIComponent(voice.publicOwnerId)}/${encodeURIComponent(voice.id)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
          body: { new_name: voice.name.slice(0, 80) },
          timeoutMs: 30_000,
        },
      );
    } catch (error) {
      throw this.describe(error);
    }
    this.catalogue = null;
    const id = (raw as { voice_id?: string } | null)?.voice_id;
    return { voiceId: typeof id === 'string' && id ? id : voice.id };
  }

  /**
   * Clones a person's voice from their recordings. The consent is checked
   * here as well as by the caller: the provider is the last line, and it
   * does not trust the pipeline to have asked.
   */
  async cloneVoice(clone: VoiceClone, consent: VoiceConsent, context: CallContext): Promise<{ voiceId: string }> {
    if (
      !consentCovers(consent, {
        organizationId: context.organizationId,
        projectId: context.projectId ?? '',
      })
    ) {
      throw new AppError('forbidden', 'No valid voice consent on record; a voice is never cloned without one.', {
        publicMessage: 'We need recorded consent before cloning a voice.',
      });
    }
    if (clone.samples.length === 0) {
      throw new ProviderError(this.name, 'A voice clone needs at least one recording.');
    }
    const form = new FormData();
    form.set('name', clone.name.slice(0, 80));
    if (clone.description) form.set('description', clone.description.slice(0, 500));
    form.set('remove_background_noise', 'true');
    form.set(
      'labels',
      JSON.stringify({
        ...(clone.labels ?? {}),
        ...(clone.language ? { language: clone.language } : {}),
        consent_subject: consent.subjectName,
        consent_granted_at: consent.grantedAt,
      }),
    );
    for (const sample of clone.samples) {
      form.append('files', new Blob([sample.data as BlobPart], { type: sample.contentType }), sample.filename);
    }
    let raw: unknown;
    try {
      raw = await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
        body: form,
        timeoutMs: 180_000,
      });
    } catch (error) {
      throw this.describe(error);
    }
    const id = (raw as { voice_id?: string } | null)?.voice_id;
    if (typeof id !== 'string' || !id) {
      throw new ProviderError(this.name, 'ElevenLabs answered the clone with no voice id.', { retryable: true });
    }
    this.catalogue = null;
    await this.costSink?.record({
      provider: this.name,
      model: 'instant-voice-clone',
      operation: 'speech.clone',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      quantity: clone.samples.length,
      unit: 'recording',
      metadata: { projectId: context.projectId, voiceId: id, subject: consent.subjectName },
    });
    return { voiceId: id };
  }

  async deleteVoice(voiceId: string, _context: CallContext): Promise<void> {
    try {
      await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
        timeoutMs: 30_000,
      });
    } catch (error) {
      const described = this.describe(error);
      // Already gone is the outcome asked for.
      if (described.status !== 404) throw described;
    }
    this.catalogue = null;
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

export function isV3(model: string): boolean {
  return /_v3\b|_v3_/.test(model) || model.endsWith('v3');
}

/** Made from somebody's recordings: an instant clone, or any voice this platform cloned under consent. */
function isClone(voice: Voice): boolean {
  return voice.category === 'cloned' || Boolean(voice.labels?.['consent_subject']);
}

function genderOf(label: string | null | undefined): VoiceGender | null {
  const value = (label ?? '').toLowerCase();
  if (value === 'female' || value === 'male') return value;
  return null;
}

/**
 * v3 audio tags, used the way a director marks a script: one at the top
 * when the direction calls for it, a breath where the copy already paused,
 * and nothing else. A line full of tags reads like a line full of tags.
 */
export function withAudioTags(text: string, direction: VoiceDirection | null | undefined): string {
  if (!direction) return text;
  if (/\[[a-z ]+\]/i.test(text)) return text; // Already marked by hand.
  const tags: string[] = [];
  if (direction.style === 'energetic' && (direction.energy === 'high' || direction.energy === 'medium-high')) {
    tags.push('[excited]');
  } else if (direction.style === 'calm' || direction.style === 'minimal') {
    tags.push('[softly]');
  } else if (direction.style === 'confident') {
    tags.push('[confident]');
  }
  if (direction.pace === 'slow' && tags.length === 0) tags.push('[slowly]');
  const paused = text.replace(/\s*(…|\.\.\.)\s*/g, ' [short pause] ').replace(/\s{2,}/g, ' ').trim();
  return tags.length > 0 ? `${tags.join(' ')} ${paused}` : paused;
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
