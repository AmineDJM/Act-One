import { z } from 'zod';
import { httpRequest, sleep } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import type {
  EditRequest,
  GenerativeMediaProvider,
  ImageRequest,
  MediaAspect,
  MediaJob,
  MediaJobStatus,
  MediaTier,
  VideoRequest,
} from './types.ts';

/**
 * Runway, routed by capability rather than by name.
 *
 * The thing that makes this vendor different from the others here is that the
 * account, not the documentation, decides what exists. The organisation
 * endpoint returns the models this key may actually call, with per-model
 * concurrency and daily ceilings, and the set is large and moves: this account
 * currently reaches sixty-two, spanning several vendors' models behind one
 * API — Gen-4.5, Aleph, Veo 3.1, Kling 3.0, Seedance 2.5, Act Two, upscalers,
 * and ElevenLabs' voice and sound models.
 *
 * So there is no routing table in this file mapping our tiers to model names.
 * A table would be a promise about somebody else's catalogue, and the first
 * thing that happens to such a promise is that a model is retired and a
 * production fails on a name. Instead the catalogue is read at runtime, models
 * are ranked inside each capability, and the tier picks a position in that
 * ranking. A model that vanishes costs one rung, not a film.
 *
 * What the creative code sees is unchanged: a tier, an aspect, a duration.
 * Nothing above this file learns that Kling exists.
 */

const BASE_URL = 'https://api.dev.runwayml.com';

/** The vendor dates its API in a header; an unset one gets the oldest shape. */
const API_VERSION = '2024-11-06';

/** What a capability is, in our vocabulary rather than theirs. */
export type RunwayCapability =
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'text_to_image'
  | 'character_performance'
  | 'text_to_speech'
  | 'sound_effects'
  | 'voice_isolation'
  | 'upscale';

/** Which endpoint serves each capability. */
const ENDPOINT: Record<RunwayCapability, string> = {
  text_to_video: '/v1/text_to_video',
  image_to_video: '/v1/image_to_video',
  video_to_video: '/v1/video_to_video',
  text_to_image: '/v1/text_to_image',
  character_performance: '/v1/character_performance',
  text_to_speech: '/v1/text_to_speech',
  sound_effects: '/v1/text_to_sound',
  voice_isolation: '/v1/voice_isolation',
  upscale: '/v1/video_upscale',
};

/**
 * How a model name is sorted into a capability, and how good it is.
 *
 * Matched on the account's own model identifiers. `rank` orders within a
 * capability, best first; the tier chooses how far down that list to reach.
 * Anything unmatched is still reported by `capabilities()` as unclassified
 * rather than dropped, because a model this build has never heard of is far
 * more likely to be new than to be useless.
 */
const CLASSIFIERS: { pattern: RegExp; capabilities: RunwayCapability[]; rank: number }[] = [
  // Video, strongest first. Rank is a judgement about class, not about price.
  { pattern: /^gen4\.5$/, capabilities: ['text_to_video', 'image_to_video'], rank: 100 },
  { pattern: /^veo3\.1$/, capabilities: ['text_to_video', 'image_to_video'], rank: 96 },
  {
    pattern: /^kling3\.0_4k$|^klingO3_4k$/,
    capabilities: ['text_to_video', 'image_to_video'],
    rank: 94,
  },
  { pattern: /^seedance2_5$/, capabilities: ['text_to_video', 'image_to_video'], rank: 92 },
  {
    pattern: /^kling3\.0_pro$|^klingO3_pro$/,
    capabilities: ['text_to_video', 'image_to_video'],
    rank: 90,
  },
  { pattern: /^veo3\.1_fast$/, capabilities: ['text_to_video', 'image_to_video'], rank: 84 },
  { pattern: /^gen4_turbo$/, capabilities: ['image_to_video'], rank: 80 },
  {
    pattern: /^seedance2(_fast|_mini)?$/,
    capabilities: ['text_to_video', 'image_to_video'],
    rank: 78,
  },
  {
    pattern: /^kling(2\.5_turbo_pro|3\.0_standard|O3_standard)$/,
    capabilities: ['text_to_video', 'image_to_video'],
    rank: 76,
  },
  {
    pattern: /^(hailuo3|h3_max|wan3(_prime)?|happyhorse_1_0|grok_imagine_1_5)$/,
    capabilities: ['text_to_video', 'image_to_video'],
    rank: 70,
  },
  { pattern: /^gen3a_turbo$/, capabilities: ['image_to_video'], rank: 60 },
  { pattern: /^multi_shot_video$/, capabilities: ['text_to_video'], rank: 88 },

  // Video in, video out: the tools that change footage rather than make it.
  { pattern: /^aleph2$/, capabilities: ['video_to_video'], rank: 100 },
  { pattern: /^gen4_aleph$/, capabilities: ['video_to_video'], rank: 90 },
  { pattern: /^magnific_video_upscaler_creative$/, capabilities: ['upscale'], rank: 90 },
  { pattern: /^enhance_frame_rate$/, capabilities: ['video_to_video'], rank: 40 },

  // A performance driven onto a character.
  { pattern: /^act_two$/, capabilities: ['character_performance'], rank: 100 },
  { pattern: /^gwm1_avatar/, capabilities: ['character_performance'], rank: 80 },

  // Stills.
  { pattern: /^gpt_image_2_5_(sunburst|flare)$/, capabilities: ['text_to_image'], rank: 100 },
  { pattern: /^seedream5_pro$/, capabilities: ['text_to_image'], rank: 96 },
  { pattern: /^gemini_image3_pro$/, capabilities: ['text_to_image'], rank: 94 },
  { pattern: /^gen4_image$/, capabilities: ['text_to_image'], rank: 90 },
  { pattern: /^gpt_image_2$/, capabilities: ['text_to_image'], rank: 88 },
  { pattern: /^gemini_image3\.1_flash$/, capabilities: ['text_to_image'], rank: 84 },
  {
    pattern: /^(seedream5_lite|gen4_image_turbo|muse_image|grok_imagine_image_2)$/,
    capabilities: ['text_to_image'],
    rank: 70,
  },
  { pattern: /^magnific_precision_upscaler_v2$/, capabilities: ['upscale'], rank: 100 },

  // Sound. These are the ElevenLabs models, reachable here without an
  // ElevenLabs key of our own — which is the only reason this vendor is
  // interesting to the sound system at all.
  { pattern: /^eleven_v3$/, capabilities: ['text_to_speech'], rank: 100 },
  { pattern: /^eleven_multilingual_v2$/, capabilities: ['text_to_speech'], rank: 90 },
  { pattern: /^seed_audio$/, capabilities: ['text_to_speech'], rank: 60 },
  { pattern: /^eleven_multilingual_sts_v2$/, capabilities: ['text_to_speech'], rank: 70 },
  { pattern: /^eleven_text_to_sound_v2$/, capabilities: ['sound_effects'], rank: 100 },
  { pattern: /^eleven_voice_isolation$/, capabilities: ['voice_isolation'], rank: 100 },
];

/** Where a tier lands in a capability's ranking: 0 is the best model available. */
const TIER_POSITION: Record<MediaTier, number> = {
  cinematic: 0,
  studio: 1,
  authentic: 2,
};

/** The frame sizes the vendor accepts, by aspect. Its enums, not free-form. */
const VIDEO_RATIO: Record<MediaAspect, string> = {
  '16:9': '1920:1080',
  '9:16': '1080:1920',
  '1:1': '1080:1080',
  '4:5': '1080:1920',
};
const IMAGE_RATIO: Record<MediaAspect, string> = {
  '16:9': '1920:1080',
  '9:16': '1080:1920',
  '1:1': '1080:1080',
  '4:5': '1080:1440',
};

const Organization = z.object({
  creditBalance: z.number().optional(),
  tier: z
    .object({
      maxMonthlyCreditSpend: z.number().optional(),
      models: z
        .record(
          z.string(),
          z.object({
            maxConcurrentGenerations: z.number().optional(),
            maxDailyGenerations: z.number().optional(),
          }),
        )
        .default({}),
    })
    .default({ models: {} }),
});

const Task = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'THROTTLED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  output: z.array(z.string()).optional(),
  failure: z.string().nullish(),
  failureCode: z.string().nullish(),
  progress: z.number().nullish(),
});
type Task = z.infer<typeof Task>;

const STATUS: Record<Task['status'], MediaJobStatus> = {
  PENDING: 'queued',
  THROTTLED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'canceled',
};

/** What this account can do, as the account itself reports it. */
export type RunwayCapabilities = {
  creditBalance: number | null;
  /** Models grouped by what they are for, best first. */
  byCapability: Record<RunwayCapability, string[]>;
  /** Models the account has that this build does not recognise. Reported, never used blindly. */
  unclassified: string[];
  /** Per-model ceilings, so a planner can avoid queueing past them. */
  limits: Record<string, { concurrent: number | null; daily: number | null }>;
};

export type RunwayConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
  /** Refuses a request the vendor would price above this. */
  maxCostPerRequestUsd?: number;
  polling?: { initialMs?: number; maxMs?: number };
};

export class RunwayProvider implements GenerativeMediaProvider {
  readonly name = 'runway';
  readonly kind = 'media' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly polling: { initialMs: number; maxMs: number };
  private discovered: RunwayCapabilities | null = null;

  constructor(config: RunwayConfig = {}) {
    this.apiKey = (
      config.apiKey ??
      process.env['RUNWAY_API_KEY'] ??
      process.env['RUNWAYML_API_SECRET'] ??
      ''
    ).trim();
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.costSink = config.costSink;
    this.polling = {
      initialMs: config.polling?.initialMs ?? 3_000,
      maxMs: config.polling?.maxMs ?? 12_000,
    };
  }

  isConfigured(): boolean {
    return canAuthenticate('runway', this.apiKey);
  }

  /**
   * Reads the account and says what it can actually do.
   *
   * Free, and it proves more than a credential: a key with no video models
   * enabled is a working key that cannot make a film, and those are different
   * problems with different fixes.
   */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'media' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No Runway credential is configured.' };
    }
    const startedAt = Date.now();
    try {
      const capabilities = await this.capabilities();
      const video = capabilities.byCapability.text_to_video.length;
      const images = capabilities.byCapability.text_to_image.length;
      const speech = capabilities.byCapability.text_to_speech.length;
      return {
        ...base,
        healthy: video > 0 || images > 0,
        latencyMs: Date.now() - startedAt,
        message:
          `${video} video, ${images} image and ${speech} speech models are enabled` +
          `${capabilities.creditBalance === null ? '' : `; ${capabilities.creditBalance} credits`}.`,
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

  /** What this account can do, read once per provider instance. */
  async capabilities(): Promise<RunwayCapabilities> {
    if (this.discovered) return this.discovered;

    const org = await this.api(Organization, 'GET', '/v1/organization');
    const names = Object.keys(org.tier.models);

    const byCapability: Record<RunwayCapability, { name: string; rank: number }[]> = {
      text_to_video: [],
      image_to_video: [],
      video_to_video: [],
      text_to_image: [],
      character_performance: [],
      text_to_speech: [],
      sound_effects: [],
      voice_isolation: [],
      upscale: [],
    };
    const unclassified: string[] = [];

    for (const name of names) {
      const classifier = CLASSIFIERS.find((entry) => entry.pattern.test(name));
      if (!classifier) {
        unclassified.push(name);
        continue;
      }
      for (const capability of classifier.capabilities) {
        byCapability[capability].push({ name, rank: classifier.rank });
      }
    }

    const limits: RunwayCapabilities['limits'] = {};
    for (const [name, limit] of Object.entries(org.tier.models)) {
      limits[name] = {
        concurrent: limit.maxConcurrentGenerations ?? null,
        daily: limit.maxDailyGenerations ?? null,
      };
    }

    this.discovered = {
      creditBalance: org.creditBalance ?? null,
      byCapability: Object.fromEntries(
        Object.entries(byCapability).map(([capability, entries]) => [
          capability,
          entries.sort((a, b) => b.rank - a.rank).map((entry) => entry.name),
        ]),
      ) as RunwayCapabilities['byCapability'],
      unclassified: unclassified.sort(),
      limits,
    };
    return this.discovered;
  }

  /**
   * The model a tier gets for a capability.
   *
   * `cinematic` takes the best the account has, `studio` the next, `authentic`
   * the next again — and every tier falls back to the last available rather
   * than failing, because a tier is a preference and an empty capability is
   * the only real error.
   */
  async modelFor(capability: RunwayCapability, tier: MediaTier): Promise<string> {
    const available = (await this.capabilities()).byCapability[capability];
    if (available.length === 0) {
      throw new ProviderError(
        this.name,
        `This Runway account has no model enabled for ${capability.replace(/_/g, ' ')}.`,
        { retryable: false },
      );
    }
    return available[Math.min(TIER_POSITION[tier], available.length - 1)]!;
  }

  // -------------------------------------------------------------------------

  async generateVideo(request: VideoRequest, context: CallContext): Promise<MediaJob> {
    const capability: RunwayCapability = request.initImageUrl ? 'image_to_video' : 'text_to_video';
    const model = await this.modelFor(capability, request.tier);

    const body: Record<string, unknown> = {
      model,
      promptText: request.prompt,
      ratio: VIDEO_RATIO[request.aspect],
      duration: Math.max(1, Math.round(request.durationSeconds)),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    };
    if (request.initImageUrl) {
      body['promptImage'] = request.initImageUrl;
    }

    return this.submit(ENDPOINT[capability], body, model, 'media.video', context);
  }

  async generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob> {
    const model = await this.modelFor('text_to_image', request.tier);
    const body: Record<string, unknown> = {
      model,
      promptText: request.prompt,
      ratio: IMAGE_RATIO[request.aspect],
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    };
    if (request.referenceUrls?.length) {
      body['referenceImages'] = request.referenceUrls.slice(0, 3).map((uri) => ({ uri }));
    }
    return this.submit(ENDPOINT.text_to_image, body, model, 'media.image', context);
  }

  /**
   * Editing a still is not something this vendor does.
   *
   * It changes footage — Aleph is video in, video out — and pretending a still
   * editor exists here would route an edit somewhere it silently becomes a
   * regeneration. The router should send stills elsewhere.
   */
  async editImage(_request: EditRequest, _context: CallContext): Promise<MediaJob> {
    throw new ProviderError(
      this.name,
      'Runway edits footage rather than stills; route a still edit to a provider that does it.',
      { retryable: false },
    );
  }

  async getJob(jobId: string, context: CallContext): Promise<MediaJob> {
    const task = await this.api(Task, 'GET', `/v1/tasks/${encodeURIComponent(jobId)}`, undefined, {
      timeoutMs: 20_000,
      signal: context.signal,
    });
    return toJob(task, '');
  }

  async waitForJob(
    jobId: string,
    context: CallContext,
    timeoutMs = 10 * 60_000,
  ): Promise<MediaJob> {
    const deadline = Date.now() + timeoutMs;
    let delay = this.polling.initialMs;

    while (Date.now() < deadline) {
      if (context.signal?.aborted) {
        await this.cancel(jobId);
        throw new ProviderError(this.name, 'Generation cancelled.', { retryable: false });
      }
      const job = await this.getJob(jobId, context);
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
        return job;
      }
      await sleep(Math.round(delay * (0.8 + Math.random() * 0.4)));
      delay = Math.min(this.polling.maxMs, delay * 1.5);
    }
    throw new ProviderError(
      this.name,
      `Generation timed out after ${timeoutMs}ms; task ${jobId} may still finish on the vendor's side.`,
      { retryable: true },
    );
  }

  /**
   * What a request costs.
   *
   * The vendor prices in credits and publishes no estimate endpoint, so there
   * is no figure to return that would be its own. Zero, explicitly, rather
   * than a number invented here: a made-up price passed to a budget gate is
   * worse than no price, because the gate then believes it.
   */
  async estimateCost(_request: ImageRequest | VideoRequest | EditRequest): Promise<number> {
    return 0;
  }

  async cancel(jobId: string): Promise<void> {
    await httpRequest(this.name, `${this.baseUrl}/v1/tasks/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: this.headers(),
      attempts: 1,
      timeoutMs: 10_000,
    }).catch(() => undefined);
  }

  // -------------------------------------------------------------------------

  private async submit(
    pathname: string,
    body: Record<string, unknown>,
    model: string,
    operation: 'media.video' | 'media.image',
    context: CallContext,
  ): Promise<MediaJob> {
    const created = await this.api(z.object({ id: z.string() }), 'POST', pathname, body, {
      timeoutMs: 60_000,
      signal: context.signal,
    });

    await this.costSink?.record({
      provider: this.name,
      model,
      operation,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      succeeded: true,
      metadata: {
        taskId: created.id,
        organizationId: context.organizationId,
        projectId: context.projectId ?? null,
        sceneId: context.sceneId ?? null,
      },
    });

    return {
      id: created.id,
      status: 'queued',
      outputUrls: [],
      contentType: operation === 'media.video' ? 'video/mp4' : 'image/png',
      costUsd: 0,
      model,
    };
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
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${pathname}`, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: this.headers(),
      timeoutMs: options.timeoutMs ?? 30_000,
      // A submission is never replayed: the vendor offers no idempotency key,
      // and a request that timed out ambiguously may well have been accepted.
      attempts: method === 'GET' ? 3 : 1,
      ...(options.signal ? { signal: options.signal } : {}),
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

function toJob(task: Task, model: string): MediaJob {
  return {
    id: task.id,
    status: STATUS[task.status],
    outputUrls: task.output ?? [],
    contentType: 'video/mp4',
    costUsd: 0,
    model,
    ...(task.failure || task.failureCode
      ? { error: task.failure ?? task.failureCode ?? 'The generation failed.' }
      : {}),
    ...(typeof task.progress === 'number' ? { progress: task.progress } : {}),
  };
}
