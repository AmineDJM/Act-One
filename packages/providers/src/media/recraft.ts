import { z } from 'zod';
import { httpRequest } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import type { EditRequest, ImageRequest, MediaAspect, MediaJob, MediaTier } from './types.ts';
import type { StillImageProvider, StillCapability, VectorRequest } from './still-types.ts';

/**
 * Recraft: the one that draws rather than photographs.
 *
 * Every other image provider here makes a picture. This one makes artwork with
 * structure in it — real SVG with named paths, an icon set that shares a
 * weight, a background that can be removed because it was never merged. For a
 * film whose typography, layout and brand colour are rendered by a
 * deterministic engine, that is a different and more useful thing than another
 * photographic generator: a vector asset can be recoloured to the brand, laid
 * out on the grid and animated per path, and a PNG of the same drawing can do
 * none of those.
 *
 * It is registered and NOT automatically selected. Nothing in the creative
 * path reaches for it on its own; the art direction has to ask. Adding a
 * capability that quietly inserts itself into films is how a house style
 * becomes whatever the newest vendor is good at.
 */

const BASE_URL = 'https://external.api.recraft.ai';

/** The vendor's own frame sizes. Anything else is refused at the API. */
const SIZE: Record<MediaAspect, string> = {
  '16:9': '1820x1024',
  '9:16': '1024x1820',
  '1:1': '1024x1024',
  '4:5': '1024x1280',
};

/**
 * Which engine a tier gets.
 *
 * Two generations are live and they are genuinely different tools rather than
 * a quality ladder — so the mapping is by intent, and a caller that wants the
 * other one asks for it by capability instead.
 */
const MODEL: Record<MediaTier, string> = {
  cinematic: 'recraftv3',
  studio: 'recraftv3',
  authentic: 'recraftv2',
};

const User = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  credits: z.number().optional(),
});

const Generation = z.object({
  created: z.number().optional(),
  data: z
    .array(z.object({ url: z.string().optional(), image_id: z.string().optional() }))
    .default([]),
});

export type RecraftConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
};

export class RecraftProvider implements StillImageProvider {
  readonly name = 'recraft';
  readonly kind = 'media' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: RecraftConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env['RECRAFT_API_KEY'] ?? '').trim();
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.costSink = config.costSink;
  }

  isConfigured(): boolean {
    return canAuthenticate('recraft', this.apiKey);
  }

  /**
   * What this provider is for, so a planner can ask rather than assume.
   *
   * `vector` is the one that matters and the one no other provider here has.
   */
  capabilities(): StillCapability[] {
    return ['raster', 'vector', 'background_removal', 'upscale', 'style_reference'];
  }

  /** Reads the account. Free, and it reports the credit balance a planner needs. */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'media' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No Recraft credential is configured.' };
    }
    const startedAt = Date.now();
    try {
      const user = await this.api(User, 'GET', '/v1/users/me');
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: `Account reachable${user.credits === undefined ? '' : `; ${user.credits} credits`}. Raster, vector, background removal and upscaling.`,
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

  /** A still, synchronously: this vendor answers with the image rather than a job. */
  async generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob> {
    const model = MODEL[request.tier];
    const answer = await this.api(
      Generation,
      'POST',
      '/v1/images/generations',
      {
        prompt: request.prompt.slice(0, 1000),
        model,
        size: SIZE[request.aspect],
        n: 1,
        ...(request.negativePrompt
          ? { negative_prompt: request.negativePrompt.slice(0, 1000) }
          : {}),
      },
      { timeoutMs: 180_000, signal: context.signal },
    );
    return this.settle(answer, model, 'image/png', 'media.image', context);
  }

  /**
   * A drawing with paths in it.
   *
   * The whole reason this provider is here. The output is real SVG, so the
   * renderer can recolour it to the brand, lay it on the grid and animate a
   * path at a time — none of which is possible with a picture of a drawing.
   */
  async generateVector(request: VectorRequest, context: CallContext): Promise<MediaJob> {
    const model = MODEL[request.tier];
    const answer = await this.api(
      Generation,
      'POST',
      '/v1/images/generations',
      {
        prompt: request.prompt.slice(0, 1000),
        model,
        style: 'vector_illustration',
        ...(request.substyle ? { substyle: request.substyle } : {}),
        size: SIZE[request.aspect],
        n: 1,
      },
      { timeoutMs: 180_000, signal: context.signal },
    );
    return this.settle(answer, model, 'image/svg+xml', 'media.image', context);
  }

  async editImage(_request: EditRequest, _context: CallContext): Promise<MediaJob> {
    throw new ProviderError(
      this.name,
      'Recraft is registered here for generation, background removal and upscaling rather than instruction edits.',
      { retryable: false },
    );
  }

  private async settle(
    answer: z.infer<typeof Generation>,
    model: string,
    contentType: string,
    operation: 'media.image',
    context: CallContext,
  ): Promise<MediaJob> {
    const urls = answer.data.map((entry) => entry.url).filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      throw new ProviderError(this.name, 'The generation returned no image.', { retryable: true });
    }
    await this.costSink?.record({
      provider: this.name,
      model,
      operation,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      quantity: urls.length,
      unit: 'image',
      succeeded: true,
      metadata: {
        organizationId: context.organizationId,
        projectId: context.projectId ?? null,
        sceneId: context.sceneId ?? null,
      },
    });
    return {
      id: answer.data[0]?.image_id ?? `recraft_${Date.now()}`,
      status: 'succeeded',
      outputUrls: urls,
      contentType,
      costUsd: 0,
      model,
    };
  }

  private headers(): Record<string, string> {
    const common = { accept: 'application/json' };
    if (!this.apiKey && credentialIsManaged('recraft')) return common;
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
      timeoutMs: options.timeoutMs ?? 60_000,
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
