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
import { RunwayProvider } from './media/runway.ts';
import { RecraftProvider } from './media/recraft.ts';
import { IdeogramProvider } from './media/ideogram.ts';
import type { GenerativeMediaProvider } from './media/types.ts';
import type { StillCapability, StillImageProvider } from './media/still-types.ts';
import { GeminiVideoAnalyst } from './analysis/gemini-video.ts';
import type { VideoAnalyst } from './analysis/types.ts';
import { OpenAiSpeechProvider } from './speech/openai.ts';
import { ElevenLabsProvider } from './speech/elevenlabs.ts';
import { RunwayAudioProvider } from './speech/runway-audio.ts';
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
/**
 * Whether this process is part of a deployment that needs shared storage.
 *
 * A single machine running everything — a laptop, CI, a one-off script — can
 * read what it wrote. Anything in production cannot assume that, and saying so
 * explicitly beats guessing from the presence of credentials.
 */
export function sharedStorageRequired(): boolean {
  if (process.env['ACT_ONE_SINGLE_MACHINE'] === '1') return false;
  return process.env['NODE_ENV'] === 'production';
}

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
  primary: z.enum(['higgsfield', 'runway', 'none']).default('higgsfield'),
  /**
   * A second engine for moving shots.
   *
   * Off by default, because two engines producing shots for one film is a film
   * with two looks in it unless somebody chose that. Worth having because the
   * vendors have genuinely different catalogues and one of them being down is
   * otherwise a production that stops.
   */
  fallback: z.enum(['higgsfield', 'runway', 'none']).default('none'),
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
  /**
   * Who reads when the configured engine has no working credential.
   *
   * `none` keeps today's behaviour exactly: the voice falls back to OpenAI and
   * music and sound effects simply do not happen. `runway-audio` reaches the
   * same ElevenLabs models through a vendor whose key works, which is a
   * stopgap for a revoked key and is named rather than silent — every asset it
   * makes is recorded under its own provider name.
   */
  standIn: z.enum(['none', 'runway-audio']).default('none'),
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

/**
 * Watching a film, as opposed to making one.
 *
 * Its own capability rather than a corner of the LLM config, because handing
 * frames to a chat model and reading a file natively on its own clock are
 * different things and a caller that cannot tell them apart will ask the wrong
 * one about easing.
 */
const AnalysisConfig = z.object({
  primary: z.enum(['gemini', 'none']).default('gemini'),
  enabled: z.boolean().default(true),
  /** Pin a model only to reproduce an old reading; otherwise the catalogue decides. */
  models: z.object({ broad: z.string().optional(), deep: z.string().optional() }).default({}),
});

const StorageConfig = z.object({
  primary: z.enum(['supabase-storage', 'local-fs']).default('supabase-storage'),
  enabled: z.boolean().default(true),
});

export const ProviderConfig = z.object({
  llm: LlmConfig.default(() => LlmConfig.parse({})),
  browser: BrowserConfig.default(() => BrowserConfig.parse({})),
  media: MediaConfig.default(() => MediaConfig.parse({})),
  speech: SpeechConfig.default(() => SpeechConfig.parse({})),
  analysis: AnalysisConfig.default(() => AnalysisConfig.parse({})),
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
    analyst: VideoAnalyst;
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
    return this.memo(`media:${this.config.media.primary}`, () =>
      this.buildMedia(this.config.media.primary as 'higgsfield' | 'runway'),
    );
  }

  /**
   * The second engine for moving shots, when an operator configured one.
   *
   * Null unless asked for. Falling back between two generative engines is not
   * like falling back between two browsers: research re-run on another vendor
   * produces the same facts, where a shot re-generated on another vendor
   * produces a different shot. So this is a choice somebody makes, and the
   * pipeline that uses it has to be willing to have one shot look different
   * from its neighbours.
   */
  mediaFallback(): GenerativeMediaProvider | null {
    const name = this.config.media.fallback;
    if (name === 'none' || name === this.config.media.primary) return null;
    const provider = this.memo(`media:${name}`, () => this.buildMedia(name));
    return provider.isConfigured?.() === false ? null : provider;
  }

  private buildMedia(name: 'higgsfield' | 'runway'): GenerativeMediaProvider {
    if (name === 'runway') {
      return new RunwayProvider({
        costSink: this.costSink,
        maxCostPerRequestUsd: this.config.media.maxCostPerRequestUsd,
      });
    }
    return new HiggsfieldProvider({
      costSink: this.costSink,
      maxCostPerRequestUsd: this.config.media.maxCostPerRequestUsd,
    });
  }

  /**
   * Providers of stills, by what they are actually for.
   *
   * The router matches on a declared capability rather than on a name, so
   * creative code asks for "something that can make a recolourable vector" or
   * "a composed style frame" and never learns which vendor answered. Only
   * providers that can authenticate are offered, and the list is ordered by
   * how well each one fits the capability asked for.
   *
   * Nothing selects these automatically. They are available to the art
   * direction; an art direction that does not ask gets the film it would have
   * got before any of them existed.
   */
  stills(capability: StillCapability): StillImageProvider[] {
    const all = this.memo('stills', () => [
      new RecraftProvider({ costSink: this.costSink }),
      new IdeogramProvider({ costSink: this.costSink }),
    ]);
    return all.filter(
      (provider) => provider.isConfigured?.() !== false && provider.capabilities().includes(capability),
    );
  }

  /**
   * A model that watches a film, or nothing.
   *
   * Null rather than an error when unconfigured, because analysing a reference
   * is something the system does when it can and lives without when it cannot
   * — unlike a renderer, whose absence is a production that fails.
   */
  videoAnalystOrNull(): VideoAnalyst | null {
    if (this.overrides?.analyst) return this.overrides.analyst;
    if (!this.config.analysis.enabled || this.config.analysis.primary === 'none') return null;
    const analyst = this.memo('analyst', () => {
      const models = this.config.analysis.models;
      return new GeminiVideoAnalyst({
        costSink: this.costSink,
        ...(models.broad || models.deep ? { models } : {}),
      });
    });
    return analyst.isConfigured() ? analyst : null;
  }

  mediaOrNull(): GenerativeMediaProvider | null {
    try {
      return this.media();
    } catch {
      return null;
    }
  }

  /**
   * The media provider, only when it can actually be called.
   *
   * `mediaOrNull` answers a question about configuration — has an operator
   * switched generative media off — and it was being read as an answer to a
   * different question, which is whether a shot written as moving footage can
   * be produced. On a deployment with the feature on and no key the two
   * answers differ, and the film silently came out as stills with nothing
   * anywhere saying why.
   */
  mediaReady(): GenerativeMediaProvider | null {
    const provider = this.mediaOrNull();
    if (provider === null) return null;
    return provider.isConfigured?.() === false ? null : provider;
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
      if (elevenlabs.isConfigured()) return elevenlabs;
      return this.standIn();
    });
  }

  /**
   * The named stand-in for a voice engine whose credential does not work.
   *
   * Returns null unless an operator set `speech.standIn`, so this changes
   * nothing on a deployment that has not asked for it. It exists because the
   * ElevenLabs key currently answers `invalid_api_key` on every call while the
   * same models are reachable through another vendor whose key works — and the
   * right response to a bad credential is a documented detour, not a rewrite
   * of a provider that is doing its job correctly.
   */
  private standIn(): RunwayAudioProvider | null {
    if (this.config.speech.standIn !== 'runway-audio') return null;
    const runway = new RunwayAudioProvider({ costSink: this.costSink });
    return runway.isConfigured() ? runway : null;
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
      // Unless an operator named a stand-in, which reaches the same models
      // through a vendor whose credential works.
      const standIn = this.standIn();
      if (standIn) return standIn;
    }
    return new OpenAiSpeechProvider({ costSink: this.costSink });
  }

  storage(): StorageProvider {
    if (this.overrides?.storage) return this.overrides.storage;
    return this.memo(`storage:${this.config.storage.primary}`, () => {
      if (this.config.storage.primary === 'local-fs') return new LocalFsStorageProvider();
      const supabase = new SupabaseStorageProvider();
      /*
       * Falling back to disk keeps development and CI working without cloud
       * credentials — and it is a downgrade, so it says so.
       *
       * The comment here used to claim it "never silently downgrades a
       * configured deployment", and that is exactly what it did: a deployment
       * whose object-store credentials were missing got local disk, the worker
       * wrote every master to its own instance, and the web service answered
       * ENOENT to every download. The film existed in the database and nowhere
       * a customer could reach. `storageMisconfiguration` is what turns that
       * into something a person is told.
       */
      if (supabase.isConfigured()) return supabase;
      console.warn(
        '[storage] No object store configured; using local disk. ' +
          'Only one process can read what this writes.',
      );
      return new LocalFsStorageProvider();
    });
  }

  /**
   * Why this deployment cannot deliver a film, or nothing.
   *
   * Two services with two disks and a store only one of them can read is not
   * a degraded mode, it is a product that renders films nobody can watch. Said
   * at startup and on the health check, because the alternative is finding out
   * from a customer looking at a black player.
   */
  storageMisconfiguration(): string | null {
    if (this.storage().shared) return null;
    if (!sharedStorageRequired()) return null;
    return (
      'Storage is the local filesystem, which the web service and the render ' +
      'worker cannot share: every finished film will be unreachable from the ' +
      'page that offers it. Configure Supabase Storage ' +
      '(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).'
    );
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
