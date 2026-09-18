import { z } from 'zod';
import { AppError } from '@act-one/core';
import { NullCostSink, ProviderError, type CostSink, type ProviderHealth } from './types.ts';
import { OpenAiLlmProvider } from './llm/openai.ts';
import type { LlmProvider } from './llm/types.ts';
import { BrowserbaseProvider } from './browser/browserbase.ts';
import { LocalChromiumProvider } from './browser/local.ts';
import { KernelProvider } from './browser/kernel.ts';
import type { BrowserAutomationProvider } from './browser/types.ts';
import { HiggsfieldProvider } from './media/higgsfield.ts';
import type { GenerativeMediaProvider } from './media/types.ts';
import { OpenAiSpeechProvider } from './speech/openai.ts';
import { ElevenLabsProvider } from './speech/elevenlabs.ts';
import type { SpeechProvider } from './speech/types.ts';
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
const LlmConfig = z.object({
  primary: z.enum(['openai']).default('openai'),
  enabled: z.boolean().default(true),
  routing: z
    .object({
      fast: z.string().default('gpt-4.1-mini'),
      balanced: z.string().default('gpt-4.1'),
      deep: z.string().default('gpt-4.1'),
    })
    .default(() => ({ fast: 'gpt-4.1-mini', balanced: 'gpt-4.1', deep: 'gpt-4.1' })),
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

const SpeechConfig = z.object({
  primary: z.enum(['openai-speech', 'elevenlabs']).default('openai-speech'),
  enabled: z.boolean().default(true),
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
    speech: SpeechProvider;
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
        new OpenAiLlmProvider({
          costSink: this.costSink,
          routing: this.config.llm.routing,
        }),
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

  speech(): SpeechProvider {
    if (this.overrides?.speech) return this.overrides.speech;
    if (!this.config.speech.enabled) {
      throw new AppError('provider_unavailable', 'Speech synthesis is disabled.');
    }
    return this.memo(`speech:${this.config.speech.primary}`, () => {
      if (this.config.speech.primary === 'elevenlabs') {
        const elevenlabs = new ElevenLabsProvider({ costSink: this.costSink });
        // Chosen but without a key: the film still gets a voice, from OpenAI,
        // rather than no voice and an error at the last stage of a render.
        if (elevenlabs.isConfigured()) return elevenlabs;
      }
      return new OpenAiSpeechProvider({ costSink: this.costSink });
    });
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
