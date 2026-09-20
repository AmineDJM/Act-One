import { z } from 'zod';
import { httpRequest } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import type { EditRequest, ImageRequest, MediaAspect, MediaJob, MediaTier } from './types.ts';
import type { StillCapability, StillImageProvider, StyleFrameRequest } from './still-types.ts';

/**
 * Ideogram: the one that can set type inside a picture.
 *
 * Generative image models are famously bad at words, which is exactly why Act
 * One renders every line of type itself and will go on doing so — the brand's
 * typeface, at the brand's weight, on the grid, is not something to hand to a
 * model. Nothing here changes that rule.
 *
 * What this is for is the step before: a STYLE FRAME. One composed frame that
 * says what the film looks like — the field, the light, the density, where the
 * words would sit — made in seconds and thrown away, so an art direction can
 * be looked at and argued with instead of described. That is a different job
 * from making a shot, and it is the job this vendor is unusually good at
 * because it is the one that can put plausible words in the composition while
 * it explores the layout.
 *
 * Registered, never automatically selected. A style frame that leaked into a
 * finished film would be exactly the "generated screen" the product refuses.
 */

const BASE_URL = 'https://api.ideogram.ai';

/** The engine's own aspect names. */
const ASPECT: Record<MediaAspect, string> = {
  '16:9': '16x9',
  '9:16': '9x16',
  '1:1': '1x1',
  '4:5': '4x5',
};

/**
 * How hard the engine works, by tier.
 *
 * Read off the API's own validation rather than the documentation: the live
 * enum is FLASH, TURBO, BALANCED, DEFAULT, QUALITY. Exploration wants speed
 * and a lot of options; a frame somebody is going to stare at wants quality.
 */
const RENDERING_SPEED: Record<MediaTier, string> = {
  authentic: 'TURBO',
  studio: 'BALANCED',
  cinematic: 'QUALITY',
};

const Generation = z.object({
  created: z.string().optional(),
  data: z
    .array(
      z.object({
        url: z.string().optional(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        is_image_safe: z.boolean().optional(),
        style_type: z.string().optional(),
      }),
    )
    .default([]),
});

export type IdeogramConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
};

export class IdeogramProvider implements StillImageProvider {
  readonly name = 'ideogram';
  readonly kind = 'media' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: IdeogramConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env['IDEOGRAM_API_KEY'] ?? '').trim();
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.costSink = config.costSink;
  }

  isConfigured(): boolean {
    return canAuthenticate('ideogram', this.apiKey);
  }

  capabilities(): StillCapability[] {
    return ['raster', 'typography', 'style_frame', 'layout', 'style_reference'];
  }

  /**
   * Whether the engine will answer.
   *
   * This vendor publishes no free account endpoint — no models list, no
   * balance, nothing that authenticates without generating. So health is
   * reported from the shape of the API's refusal: a deliberately incomplete
   * request comes back as a validation error from the application, which
   * proves the request was routed and parsed, and an authentication failure
   * comes back as one. Nothing is generated and nothing is spent.
   *
   * Said plainly rather than dressed up: this is a weaker check than the other
   * providers here get, and it is the strongest one available that does not
   * cost money.
   */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'media' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No Ideogram credential is configured.' };
    }
    const startedAt = Date.now();
    try {
      await httpRequest(this.name, `${this.baseUrl}/v1/ideogram-v3/generate`, {
        method: 'POST',
        headers: this.headers(),
        // No prompt: the engine refuses it before doing any work.
        body: {},
        attempts: 1,
        timeoutMs: 20_000,
      });
      // A bare request that SUCCEEDS would mean the contract moved under us.
      return {
        ...base,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: 'The engine accepted a request with no prompt; the API contract has changed.',
      };
    } catch (error) {
      const status = error instanceof ProviderError ? error.status : undefined;
      if (status === 400 || status === 422) {
        return {
          ...base,
          healthy: true,
          latencyMs: Date.now() - startedAt,
          message:
            'Reachable and authenticated (checked by validation refusal; this vendor has no free account endpoint). ' +
            'Style frames, typographic composition and layout exploration.',
        };
      }
      if (status === 401 || status === 403) {
        return {
          ...base,
          healthy: false,
          latencyMs: Date.now() - startedAt,
          message: 'Ideogram rejected the credential.',
        };
      }
      return {
        ...base,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob> {
    return this.compose(
      {
        prompt: request.prompt,
        aspect: request.aspect,
        tier: request.tier,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.referenceUrls?.length ? { styleReferenceUrls: request.referenceUrls } : {}),
      },
      context,
    );
  }

  /**
   * A frame that says what the film looks like.
   *
   * `magicPrompt` defaults OFF. The engine will happily rewrite a prompt into
   * something more photogenic, which is useful when exploring and actively
   * harmful when the prompt is an art direction somebody wrote on purpose —
   * the frame that comes back is then a picture of a different idea.
   */
  async generateStyleFrame(request: StyleFrameRequest, context: CallContext): Promise<MediaJob> {
    return this.compose(request, context);
  }

  async editImage(_request: EditRequest, _context: CallContext): Promise<MediaJob> {
    throw new ProviderError(
      this.name,
      'Ideogram is registered here for style frames and layout exploration rather than instruction edits.',
      { retryable: false },
    );
  }

  private async compose(request: StyleFrameRequest, context: CallContext): Promise<MediaJob> {
    if (!request.prompt.trim()) {
      throw new ProviderError(this.name, 'Refusing to compose a frame from an empty prompt.', {
        retryable: false,
      });
    }
    const body: Record<string, unknown> = {
      prompt: request.prompt.slice(0, 2000),
      aspect_ratio: ASPECT[request.aspect],
      rendering_speed: RENDERING_SPEED[request.tier],
      num_images: 1,
      magic_prompt: request.magicPrompt ? 'ON' : 'OFF',
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    };
    if (request.styleReferenceUrls?.length) {
      body['style_reference_urls'] = request.styleReferenceUrls.slice(0, 3);
    }

    const answer = await this.api(Generation, '/v1/ideogram-v3/generate', body, context.signal);
    const urls = answer.data.map((entry) => entry.url).filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      throw new ProviderError(this.name, 'The engine returned no frame.', { retryable: true });
    }

    const model = `ideogram-v3/${RENDERING_SPEED[request.tier].toLowerCase()}`;
    await this.costSink?.record({
      provider: this.name,
      model,
      operation: 'media.image',
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
      id: `ideogram_${answer.data[0]?.seed ?? Date.now()}`,
      status: 'succeeded',
      outputUrls: urls,
      contentType: 'image/png',
      costUsd: 0,
      model,
    };
  }

  private headers(): Record<string, string> {
    const common = { accept: 'application/json' };
    if (!this.apiKey && credentialIsManaged('ideogram')) return common;
    return { ...common, 'Api-Key': this.apiKey };
  }

  private async api<T>(
    schema: z.ZodType<T>,
    pathname: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${pathname}`, {
      method: 'POST',
      body,
      headers: this.headers(),
      timeoutMs: 180_000,
      // Never replayed: a composition that timed out ambiguously may have been
      // made and charged for.
      attempts: 1,
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
