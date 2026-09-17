import { z } from 'zod';
import { httpRequest, sleep } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import type {
  EditRequest,
  GenerativeMediaProvider,
  ImageRequest,
  MediaJob,
  MediaJobStatus,
  MediaTier,
  VideoRequest,
} from './types.ts';

/**
 * Model routing table.
 *
 * This is the only place in the codebase that knows a vendor model name, and it
 * is runtime-configurable from Super Admin. Everything upstream speaks in tiers.
 */
export type HiggsfieldRouting = {
  image: Record<MediaTier, string>;
  video: Record<MediaTier, string>;
  edit: string;
  fallbackVideo: string;
};

export const DEFAULT_HIGGSFIELD_ROUTING: HiggsfieldRouting = {
  image: { authentic: 'soul', studio: 'soul', cinematic: 'soul-hd' },
  video: { authentic: 'dop-lite', studio: 'dop-turbo', cinematic: 'dop-hd' },
  edit: 'soul-edit',
  fallbackVideo: 'dop-lite',
};

/** USD. Video is priced per second, images per image. */
const PRICING = {
  image: { authentic: 0.03, studio: 0.05, cinematic: 0.12 } as Record<MediaTier, number>,
  videoPerSecond: { authentic: 0.09, studio: 0.18, cinematic: 0.42 } as Record<MediaTier, number>,
  edit: 0.06,
};

const JobResponse = z.object({
  id: z.string(),
  status: z.string(),
  progress: z.number().optional(),
  error: z.union([z.string(), z.object({ message: z.string() })]).nullish(),
  results: z
    .array(
      z.object({
        url: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  output: z
    .object({
      url: z.string().optional(),
      urls: z.array(z.string()).optional(),
    })
    .optional(),
});

export type HiggsfieldConfig = {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  routing?: Partial<HiggsfieldRouting>;
  costSink?: CostSink;
  /** Hard ceiling; a request estimated above this is refused before it is sent. */
  maxCostPerRequestUsd?: number;
};

export class HiggsfieldProvider implements GenerativeMediaProvider {
  readonly name = 'higgsfield';
  readonly kind = 'media' as const;

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly routing: HiggsfieldRouting;
  private readonly costSink: CostSink | undefined;
  private readonly maxCostPerRequestUsd: number;

  constructor(config: HiggsfieldConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.HIGGSFIELD_API_KEY ?? '';
    this.apiSecret = config.apiSecret ?? process.env.HIGGSFIELD_API_SECRET ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.HIGGSFIELD_BASE_URL ?? 'https://platform.higgsfield.ai')
      .replace(/\/$/, '');
    this.routing = { ...DEFAULT_HIGGSFIELD_ROUTING, ...config.routing };
    this.costSink = config.costSink;
    this.maxCostPerRequestUsd = config.maxCostPerRequestUsd ?? 6;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        kind: 'media',
        healthy: false,
        checkedAt,
        message: 'HIGGSFIELD_API_KEY not configured.',
      };
    }
    const startedAt = Date.now();
    try {
      await httpRequest(this.name, `${this.baseUrl}/v1/models`, {
        headers: this.headers(),
        timeoutMs: 10_000,
        attempts: 1,
      });
      return {
        provider: this.name,
        kind: 'media',
        healthy: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'media',
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  estimateCost(request: ImageRequest | VideoRequest | EditRequest): number {
    if ('durationSeconds' in request) {
      return PRICING.videoPerSecond[request.tier] * Math.max(1, request.durationSeconds);
    }
    if ('instruction' in request) return PRICING.edit;
    return PRICING.image[request.tier];
  }

  async generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob> {
    const model = this.routing.image[request.tier];
    return this.submit(
      '/v1/image-generations',
      {
        model,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        aspect_ratio: request.aspect,
        reference_images: request.referenceUrls,
        seed: request.seed,
      },
      { model, operation: 'media.image', estimate: this.estimateCost(request) },
      context,
    );
  }

  async generateVideo(request: VideoRequest, context: CallContext): Promise<MediaJob> {
    const model = this.routing.video[request.tier];
    return this.submit(
      '/v1/video-generations',
      {
        model,
        prompt: request.prompt,
        aspect_ratio: request.aspect,
        duration: Math.round(request.durationSeconds),
        // Presence of an init image is what makes this image-to-video, which is
        // how we keep generated shots anchored to the brand's real palette.
        init_image: request.initImageUrl,
        reference_images: request.referenceUrls,
        motion_strength: request.motionStrength ?? 0.5,
        seed: request.seed,
      },
      { model, operation: 'media.video', estimate: this.estimateCost(request) },
      context,
    );
  }

  async editImage(request: EditRequest, context: CallContext): Promise<MediaJob> {
    return this.submit(
      '/v1/image-edits',
      {
        model: this.routing.edit,
        image: request.imageUrl,
        prompt: request.instruction,
        mask: request.maskUrl,
      },
      { model: this.routing.edit, operation: 'media.edit', estimate: PRICING.edit },
      context,
    );
  }

  async getJob(jobId: string, context: CallContext): Promise<MediaJob> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}/v1/jobs/${jobId}`, {
      headers: this.headers(),
      timeoutMs: 20_000,
      signal: context.signal,
    });
    return this.toJob(raw, '');
  }

  async waitForJob(
    jobId: string,
    context: CallContext,
    timeoutMs = 10 * 60_000,
  ): Promise<MediaJob> {
    const deadline = Date.now() + timeoutMs;
    let delay = 2500;
    let last: MediaJob | null = null;

    while (Date.now() < deadline) {
      if (context.signal?.aborted) {
        throw new ProviderError(this.name, 'Generation cancelled.', { retryable: false });
      }
      last = await this.getJob(jobId, context);
      if (last.status === 'succeeded' || last.status === 'failed' || last.status === 'canceled') {
        return last;
      }
      await sleep(delay);
      // Back off gently: video jobs run for minutes and polling every 2s is
      // both noisy and rate-limit bait.
      delay = Math.min(15_000, Math.round(delay * 1.35));
    }

    throw new ProviderError(this.name, `Generation timed out after ${timeoutMs}ms.`, {
      retryable: true,
    });
  }

  private async submit(
    path: string,
    body: Record<string, unknown>,
    meta: { model: string; operation: 'media.image' | 'media.video' | 'media.edit'; estimate: number },
    context: CallContext,
  ): Promise<MediaJob> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'Higgsfield is not configured.', { retryable: false });
    }
    if (meta.estimate > this.maxCostPerRequestUsd) {
      throw new ProviderError(
        this.name,
        `Refusing a $${meta.estimate.toFixed(2)} request above the $${this.maxCostPerRequestUsd} per-request ceiling.`,
        { retryable: false },
      );
    }

    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: stripUndefined(body),
      timeoutMs: 60_000,
      attempts: 2,
      signal: context.signal,
    });

    const job = this.toJob(raw, meta.model);

    await this.costSink?.record({
      provider: this.name,
      model: meta.model,
      operation: meta.operation,
      estimatedCostUsd: meta.estimate,
      // Charged on submission by the vendor; reconciled if the job later fails.
      actualCostUsd: meta.estimate,
      metadata: {
        jobId: job.id,
        projectId: context.projectId,
        sceneId: context.sceneId,
      },
    });

    return { ...job, costUsd: meta.estimate };
  }

  private toJob(raw: unknown, model: string): MediaJob {
    const parsed = JobResponse.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, 'Unexpected job payload.', { retryable: true });
    }
    const data = parsed.data;
    const urls = [
      ...(data.results ?? []).map((r) => r.url).filter((u): u is string => Boolean(u)),
      ...(data.output?.urls ?? []),
      ...(data.output?.url ? [data.output.url] : []),
    ];
    return {
      id: data.id,
      status: normalizeStatus(data.status),
      outputUrls: urls,
      contentType: urls[0]?.match(/\.(mp4|webm|mov)(\?|$)/i) ? 'video/mp4' : 'image/png',
      error:
        typeof data.error === 'string' ? data.error : data.error?.message ?? undefined,
      costUsd: 0,
      model,
      progress: data.progress,
    };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['hf-api-key'] = this.apiKey;
    if (this.apiSecret) headers['hf-secret'] = this.apiSecret;
    return headers;
  }
}

function normalizeStatus(status: string): MediaJobStatus {
  const s = status.toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(s)) return 'succeeded';
  if (['failed', 'error', 'nsfw', 'rejected'].includes(s)) return 'failed';
  if (['canceled', 'cancelled'].includes(s)) return 'canceled';
  if (['queued', 'pending', 'created'].includes(s)) return 'queued';
  return 'running';
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}
