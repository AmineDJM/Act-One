import { z } from 'zod';
import { AppError, type SpeechQuality } from '@act-one/core';
import { NullCostSink, ProviderError, type CostSink, type ProviderHealth } from './types.ts';
import { DEFAULT_ROUTING, OpenAiLlmProvider, setModelPrices } from './llm/openai.ts';
import type { LlmProvider } from './llm/types.ts';
import { BrowserbaseProvider } from './browser/browserbase.ts';
import { LocalChromiumProvider } from './browser/local.ts';
import { KernelProvider } from './browser/kernel.ts';
import type { BrowserAutomationProvider } from './browser/types.ts';
import { HiggsfieldProvider } from './media/higgsfield.ts';
import type { GenerativeMediaProvider } from './media/types.ts';
import { OpenAiSpeechProvider } from './speech/openai.ts';
import { ElevenLabsProvider } from './speech/elevenlabs.ts';
import type { MusicComposer, SoundEffectEngine, SpeechAligner, SpeechProvider, SpeechRecognizer } from './speech/types.ts';
import { LocalFsStorageProvider } from './storage/local.ts';
import { SupabaseStorageProvider } from './storage/supabase.ts';
import type { StorageProvider } from './storage/types.ts';

/**
 * Runtime provider configuration, owned by Super Admin.
 *
 * Nothing here is read by feature code. The pipeline asks the registry for a
 * capability; the registry decides which vendor serves it, whether it is
 * enabled, and what happens when it fails.
 */
/*
 * One source for which model each tier talks to.
 *
 * These defaults used to be written out a second time here, beside the ones in
 * the OpenAI provider, and the two drifted apart the moment either was
 * touched — a deployment that had never opened the console got one set and a
 * deployment that had got the other, with no way to tell which from the
 * outside. The provider owns the answer; this asks it.
 */
const LlmConfig = z.object({
  primary: z.enum(['openai']).default('openai'),
  enabled: z.boolean().default(true),
  routing: z
    .object({
      fast: z.string().default(DEFAULT_ROUTING.fast),
      balanced: z.string().default(DEFAULT_ROUTING.balanced),
      deep: z.string().default(DEFAULT_ROUTING.deep),
    })
    .default(() => ({ ...DEFAULT_ROUTING })),
  /*
   * What each model costs per million tokens, set by the operator.
   *
   * A price list compiled into a build goes stale the week after it ships,
   * and the models this product routes to by default are newer than any table
   * anyone remembered to update — so the ledger charged every call at the
   * dearest rate it knew and was quietly wrong about what the business spends.
   */
  prices: z
    .record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) }))
    .default({}),
});

const BrowserConfig = z.object({
  primary: z.enum(['browserbase', 'local-chromium', 'kernel']).default('browserbase'),
  fallback: z.enum(['browserbase', 'local-chromium', 'kernel', 'none']).default('local-chromium'),
  enabled: z.boolean().default(true),
  maxPagesPerSession: z.number().int().min(1).max(200).default(24),
});

const MediaConfig = z.object({
  primary: z.enum(['higgsfield', 'none']).default('higgsfield'),
  enabled: z.boolean().default(true),
  maxCostPerRequestUsd: z.number().min(0).default(6),
  /** Global cost ceiling per rendered second, across all generative shots. */
  maxCostPerSecondUsd: z.number().min(0).default(0.9),
  maxRetries: z.number().int().min(0).max(5).default(2),
});

const SpeechEngine = z.enum(['openai-speech', 'elevenlabs']);
export type SpeechEngine = z.infer<typeof SpeechEngine>;

const CuratedVoiceConfig = z.object({ voiceId: z.string().min(1), name: z.string().default('') });
const CuratedProfiles = z.object({
  premium: CuratedVoiceConfig.optional(),
  warm: CuratedVoiceConfig.optional(),
  neutral: CuratedVoiceConfig.optional(),
});

/**
 * The voice engines. `primary` reads finals; `preview` reads animatics and
 * drafts, or is the same engine on its cheaper model. The recogniser listens
 * back for QA and is chosen apart from the engine that spoke, so an engine
 * never grades itself.
 */
const SpeechConfig = z.object({
  primary: SpeechEngine.default('openai-speech'),
  preview: z.enum(['same', 'openai-speech', 'elevenlabs']).default('same'),
  recognizer: SpeechEngine.default('openai-speech'),
  enabled: z.boolean().default(true),
  /** Whether customers may clone a voice at all, consent aside. */
  cloning: z.boolean().default(false),
  /** Alternative reads offered per passage on plans that carry them, 1 to 3. */
  takes: z.number().int().min(1).max(3).default(2),
  /** Passages that fail QA are regenerated this many times before the finding stands. */
  maxRegenerations: z.number().int().min(0).max(3).default(1),
  /** Ceiling per project on what the voice may cost us, USD; 0 is no ceiling. */
  maxCostPerProjectUsd: z.number().min(0).default(0),
  /** Voices chosen by an operator per locale or language: { 'fr-FR': { female: { premium: {...} } } }. */
  curated: z
    .record(
      z.string(),
      z.object({ female: CuratedProfiles.optional(), male: CuratedProfiles.optional() }),
    )
    .default({}),
});
export type SpeechConfig = z.infer<typeof SpeechConfig>;

const StorageConfig = z.object({
  primary: z.enum(['supabase-storage', 'local-fs']).default('supabase-storage'),
  enabled: z.boolean().default(true),
});

export const ProviderConfig = z.object({
  llm: LlmConfig.default(() => LlmConfig.parse({})),
  browser: BrowserConfig.default(() => BrowserConfig.parse({})),
  media: MediaConfig.default(() => MediaConfig.parse({})),
  speech: SpeechConfig.default(() => SpeechConfig.parse({})),
  storage: StorageConfig.default(() => StorageConfig.parse({})),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = ProviderConfig.parse({});

export type RegistryOptions = {
  config?: ProviderConfig;
  costSink?: CostSink;
  /** Overrides for tests. Anything supplied here wins over configuration. */
  overrides?: Partial<{
    llm: LlmProvider;
    browser: BrowserAutomationProvider;
    media: GenerativeMediaProvider;
    /** The engine for finals. */
    speech: SpeechProvider;
    /** The engine for previews; finals' engine when absent. */
    speechPreview: SpeechProvider;
    recognizer: SpeechRecognizer;
    /** Scores a film, builds a sound, says where each word fell. */
    composer: MusicComposer;
    soundEffects: SoundEffectEngine;
    aligner: SpeechAligner;
    storage: StorageProvider;
  }>;
};

export class ProviderRegistry {
  readonly config: ProviderConfig;
  readonly costSink: CostSink;

  private readonly overrides: RegistryOptions['overrides'];
  private cache = new Map<string, unknown>();

  constructor(options: RegistryOptions = {}) {
    this.config = options.config ?? DEFAULT_PROVIDER_CONFIG;
    this.costSink = options.costSink ?? new NullCostSink();
    this.overrides = options.overrides ?? {};
  }

  llm(): LlmProvider {
    if (this.overrides?.llm) return this.overrides.llm;
    if (!this.config.llm.enabled) {
      throw new AppError('provider_unavailable', 'Language model provider is disabled.');
    }
    return this.memo(
      'llm',
      () =>
        (() => {
          setModelPrices(this.config.llm.prices);
          return new OpenAiLlmProvider({
            costSink: this.costSink,
            routing: this.config.llm.routing,
          });
        })(),
    );
  }

  browser(): BrowserAutomationProvider {
    if (this.overrides?.browser) return this.overrides.browser;
    if (!this.config.browser.enabled) {
      throw new AppError('provider_unavailable', 'Browser automation is disabled.');
    }
    return this.memo(`browser:${this.config.browser.primary}`, () =>
      this.buildBrowser(this.config.browser.primary),
    );
  }

  /**
   * Browser work is the one place a fallback is genuinely safe: research is
   * idempotent and re-running it on another vendor costs a little money rather
   * than producing a second, subtly different film.
   */
  browserFallback(): BrowserAutomationProvider | null {
    const name = this.config.browser.fallback;
    if (name === 'none' || name === this.config.browser.primary) return null;
    return this.memo(`browser:${name}`, () => this.buildBrowser(name));
  }

  media(): GenerativeMediaProvider {
    if (this.overrides?.media) return this.overrides.media;
    if (!this.config.media.enabled || this.config.media.primary === 'none') {
      throw new AppError(
        'provider_unavailable',
        'Generative media is disabled for this deployment.',
      );
    }
    return this.memo(
      'media',
      () =>
        new HiggsfieldProvider({
          costSink: this.costSink,
          maxCostPerRequestUsd: this.config.media.maxCostPerRequestUsd,
        }),
    );
  }

  mediaOrNull(): GenerativeMediaProvider | null {
    try {
      return this.media();
    } catch {
      return null;
    }
  }

  /**
   * The voice for a quality tier. Finals go to the primary engine; previews
   * to the preview engine when one is set apart, otherwise to the same engine,
   * which picks its cheaper model from the request's quality.
   */
  speech(quality: SpeechQuality = 'final'): SpeechProvider {
    if (quality === 'preview' && this.overrides?.speechPreview) return this.overrides.speechPreview;
    if (this.overrides?.speech) return this.overrides.speech;
    if (!this.config.speech.enabled) {
      throw new AppError('provider_unavailable', 'Speech synthesis is disabled.');
    }
    const engine =
      quality === 'preview' && this.config.speech.preview !== 'same'
        ? this.config.speech.preview
        : this.config.speech.primary;
    return this.memo(`speech:${engine}`, () => this.buildSpeech(engine));
  }

  /** Listens back for QA. Never the engine that spoke unless it is the only one with a key. */
  recognizer(): SpeechRecognizer {
    if (this.overrides?.recognizer) return this.overrides.recognizer;
    const engine = this.config.speech.recognizer;
    return this.memo(`recognizer:${engine}`, () => {
      if (engine === 'elevenlabs') {
        const elevenlabs = new ElevenLabsProvider({ costSink: this.costSink });
        if (elevenlabs.isConfigured()) return elevenlabs;
      }
      return new OpenAiSpeechProvider({ costSink: this.costSink });
    });
  }

  /**
   * The engine that scores a film, builds a sound and says where each word
   * fell — or nothing, when no key is configured.
   *
   * Null rather than a fallback on purpose. A film without a composed score
   * plays the library and is still a film; a film with a silently substituted
   * score is a different film from the one that was directed. The pipeline
   * asks, and falls back to the library where the answer is no.
   */
  composerOrNull(): MusicComposer | null {
    if (this.overrides?.composer) return this.overrides.composer;
    return this.memo('composer', () => {
      const elevenlabs = new ElevenLabsProvider({ costSink: this.costSink });
      return elevenlabs.isConfigured() ? elevenlabs : null;
    });
  }

  soundEffectsOrNull(): SoundEffectEngine | null {
    if (this.overrides?.soundEffects) return this.overrides.soundEffects;
    return this.memo('sound-effects', () => {
      const elevenlabs = new ElevenLabsProvider({ costSink: this.costSink });
      return elevenlabs.isConfigured() ? elevenlabs : null;
    });
  }

  alignerOrNull(): SpeechAligner | null {
    if (this.overrides?.aligner) return this.overrides.aligner;
    return this.memo('aligner', () => {
      const elevenlabs = new ElevenLabsProvider({ costSink: this.costSink });
      return elevenlabs.isConfigured() ? elevenlabs : null;
    });
  }

  private buildSpeech(engine: SpeechEngine): SpeechProvider {
    if (engine === 'elevenlabs') {
      const elevenlabs = new ElevenLabsProvider({
        costSink: this.costSink,
        curated: this.config.speech.curated,
      });
      // Chosen but without a key: the film still gets a voice, from OpenAI,
      // rather than no voice and an error at the last stage of a render.
      if (elevenlabs.isConfigured()) return elevenlabs;
    }
    return new OpenAiSpeechProvider({ costSink: this.costSink });
  }

  storage(): StorageProvider {
    if (this.overrides?.storage) return this.overrides.storage;
    return this.memo(`storage:${this.config.storage.primary}`, () => {
      if (this.config.storage.primary === 'local-fs') return new LocalFsStorageProvider();
      const supabase = new SupabaseStorageProvider();
      // Falling back to disk keeps development and CI working without cloud
      // credentials, and never silently downgrades a configured deployment.
      return supabase.isConfigured() ? supabase : new LocalFsStorageProvider();
    });
  }

  async healthAll(): Promise<ProviderHealth[]> {
    const checks: Promise<ProviderHealth>[] = [];
    const safe = (fn: () => Promise<ProviderHealth>) =>
      fn().catch(
        (error): ProviderHealth => ({
          provider: 'unknown',
          kind: 'llm',
          healthy: false,
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        }),
      );

    for (const build of [
      () => this.llm(),
      () => this.browser(),
      () => this.media(),
      () => this.speech(),
      () => this.storage(),
    ]) {
      try {
        const provider = build();
        checks.push(safe(() => provider.health()));
      } catch (error) {
        checks.push(
          Promise.resolve({
            provider: 'disabled',
            kind: 'llm' as const,
            healthy: false,
            checkedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return Promise.all(checks);
  }

  private buildBrowser(name: string): BrowserAutomationProvider {
    switch (name) {
      case 'browserbase':
        return new BrowserbaseProvider({ costSink: this.costSink });
      case 'kernel':
        return new KernelProvider({ costSink: this.costSink });
      default:
        return new LocalChromiumProvider({ costSink: this.costSink });
    }
  }

  private memo<T>(key: string, build: () => T): T {
    const existing = this.cache.get(key);
    if (existing) return existing as T;
    const value = build();
    this.cache.set(key, value);
    return value;
  }
}

/**
 * The speech overrides for a registry built from stored credentials: the
 * final engine, the preview engine when it is a different one, and the
 * recogniser, each built only when its key is there. Both apps build their
 * registries through this so the console and the worker cannot disagree
 * about who reads a film.
 */
export function speechOverrides(
  config: SpeechConfig,
  build: {
    openai: (options: { transcriptionModel?: string }) => OpenAiSpeechProvider;
    /** Null when no ElevenLabs key is stored. */
    elevenlabs: ((options: Record<string, never>) => ElevenLabsProvider) | null;
  },
): {
  speech: SpeechProvider;
  speechPreview?: SpeechProvider;
  recognizer: SpeechRecognizer;
  /*
   * The same instance, wearing its other hats.
   *
   * The key that scores a film is the key that speaks it, and in a real
   * deployment it is stored in the console rather than in the environment. A
   * registry that built its own ElevenLabs from `process.env` would find
   * nothing there and quietly play the library instead of the score — which
   * is the worst kind of bug, because the film still comes out.
   */
  composer?: MusicComposer;
  soundEffects?: SoundEffectEngine;
  aligner?: SpeechAligner;
} {
  let openai: OpenAiSpeechProvider | null = null;
  let elevenlabs: ElevenLabsProvider | null = null;
  const engine = (name: SpeechEngine): SpeechProvider & SpeechRecognizer => {
    if (name === 'elevenlabs' && build.elevenlabs) {
      elevenlabs ??= build.elevenlabs({});
      return elevenlabs;
    }
    openai ??= build.openai({});
    return openai;
  };
  const speech = engine(config.primary);
  const preview = config.preview === 'same' ? null : engine(config.preview);
  const recognizer = engine(config.recognizer);
  // Whichever role built it, one ElevenLabs is enough to score, build and align.
  const scoring = elevenlabs ?? (build.elevenlabs ? build.elevenlabs({}) : null);
  return {
    speech,
    ...(preview && preview !== speech ? { speechPreview: preview } : {}),
    recognizer,
    ...(scoring ? { composer: scoring, soundEffects: scoring, aligner: scoring } : {}),
  };
}

/**
 * Runs an operation against the primary provider and falls back exactly once.
 * Non-retryable failures (bad request, policy refusal) are never retried on a
 * second vendor — they will fail identically and only cost more.
 */
export async function withFallback<TProvider, TResult>(
  primary: TProvider,
  fallback: TProvider | null,
  run: (provider: TProvider) => Promise<TResult>,
  onFallback?: (error: unknown) => void,
): Promise<TResult> {
  try {
    return await run(primary);
  } catch (error) {
    const retryable = error instanceof ProviderError ? error.retryable : true;
    if (!fallback || !retryable) throw error;
    onFallback?.(error);
    return run(fallback);
  }
}
