import { z } from 'zod';
import {
  APIError,
  AuthenticationError,
  BadInputError,
  NotEnoughCreditsError,
  TimeoutError,
  ValidationError,
  createHiggsfieldClient,
  type HiggsfieldClient,
} from '@higgsfield/client/v2';
import type { CostOperation } from '@act-one/core';
import { isPrivateAddress } from '../browser/policy.ts';
import { httpRequest, redact, sleep } from '../http.ts';
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
 * Higgsfield, through its official SDK.
 *
 * The SDK submits the generation request: that is the call that spends
 * money, and the vendor's own client is what signs it. Everything around it
 * follows the documented REST surface the SDK's v2 client does not wrap —
 * the request status, the cost estimate, the upload of a reference the
 * vendor cannot fetch on its own, and cancellation.
 *
 * Model names live here and nowhere else. Everything upstream speaks in
 * quality tiers; the routing table maps a tier to a model and is the only
 * thing that changes when a better model ships.
 */
export type HiggsfieldRouting = {
  /** A still from a prompt, by tier. */
  image: Record<MediaTier, string>;
  /** A shot from a prompt, by tier. */
  video: Record<MediaTier, string>;
  /** A shot driven from a still, by tier: how generated footage keeps the brand's palette. */
  imageToVideo: Record<MediaTier, string>;
};

const SEEDANCE_TEXT_TO_VIDEO = 'bytedance/seedance-2.5/text-to-video';
const SEEDANCE_IMAGE_TO_VIDEO = 'bytedance/seedance-2.5/image-to-video';
const SOUL = 'higgsfield-ai/soul/v2/standard';

export const DEFAULT_HIGGSFIELD_ROUTING: HiggsfieldRouting = {
  image: { authentic: SOUL, studio: SOUL, cinematic: SOUL },
  video: {
    authentic: SEEDANCE_TEXT_TO_VIDEO,
    studio: SEEDANCE_TEXT_TO_VIDEO,
    cinematic: SEEDANCE_TEXT_TO_VIDEO,
  },
  imageToVideo: {
    authentic: SEEDANCE_IMAGE_TO_VIDEO,
    studio: SEEDANCE_IMAGE_TO_VIDEO,
    cinematic: SEEDANCE_IMAGE_TO_VIDEO,
  },
};

/** Seedance 2.5 renders at 480p or 720p. Nothing cut into a 4K master wants 480p. */
const VIDEO_RESOLUTION: Record<MediaTier, '480p' | '720p'> = {
  authentic: '720p',
  studio: '720p',
  cinematic: '720p',
};

/** Soul 2 renders at 720p or 1080p. */
const IMAGE_RESOLUTION: Record<MediaTier, '720p' | '1080p'> = {
  authentic: '720p',
  studio: '720p',
  cinematic: '1080p',
};

/** Seconds. Seedance 2.5 accepts four to thirty. */
const MIN_VIDEO_SECONDS = 4;
const MAX_VIDEO_SECONDS = 30;

/**
 * Our aspects, in the vendor's spelling. 4:5 exists on neither model; 3:4 is
 * the nearest portrait frame, and the motion engine crops the rest.
 */
const ASPECTS: Record<MediaAspect, string> = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '3:4',
};

const BASE_URL = 'https://api.higgsfield.ai';

/** The request object, as every submission and the status endpoint return it. */
const RequestStatus = z.object({
  status: z.enum(['queued', 'in_progress', 'nsfw', 'failed', 'completed', 'canceled']),
  request_id: z.string(),
  status_url: z.string().optional(),
  cancel_url: z.string().optional(),
  error: z.string().nullish(),
  images: z.array(z.object({ url: z.string() })).optional(),
  video: z.object({ url: z.string() }).nullish(),
  audio: z.object({ url: z.string() }).nullish(),
  audios: z.array(z.object({ url: z.string() })).optional(),
});
type RequestStatus = z.infer<typeof RequestStatus>;

/**
 * `POST /estimate/{model}`: what the request would cost. The documentation
 * shows `{ credits, usd }` as strings; the answer is read leniently, because
 * the first live check found something the schema did not expect, and a
 * price is a number wherever the vendor puts it.
 */
const Estimate = z.record(z.string(), z.unknown());

/** Dollars, or credits at the vendor's documented rate: 1.500 credits for $0.094. */
const USD_PER_CREDIT = 0.094 / 1.5;

function priceFromEstimate(answer: unknown): { usd: number; approximate: boolean } | null {
  const numeric = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const search = (node: unknown, depth: number): { usd: number; approximate: boolean } | null => {
    if (!node || typeof node !== 'object' || depth > 3) return null;
    const record = node as Record<string, unknown>;
    for (const key of ['usd', 'price_usd', 'cost_usd', 'total_usd', 'amount_usd', 'priceUsd', 'costUsd']) {
      const usd = numeric(record[key]);
      if (usd !== null) return { usd, approximate: false };
    }
    for (const key of ['credits', 'price_credits', 'cost_credits', 'total_credits', 'priceCredits']) {
      const credits = numeric(record[key]);
      if (credits !== null) return { usd: credits * USD_PER_CREDIT, approximate: true };
    }
    for (const value of Object.values(record)) {
      const found = search(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return search(answer, 0);
}

/** `POST /files/generate-upload-url`: a presigned slot on the vendor's CDN. */
const UploadGrant = z.object({
  upload_url: z.string(),
  public_url: z.string(),
  upload_headers: z.record(z.string(), z.string()).optional(),
  content_type: z.string().optional(),
});

const STATUS: Record<RequestStatus['status'], MediaJobStatus> = {
  queued: 'queued',
  in_progress: 'running',
  completed: 'succeeded',
  failed: 'failed',
  nsfw: 'failed',
  canceled: 'canceled',
};

const CREDENTIAL_FORMAT = /^[^:\s]+:[^:\s]+$/;

export type HiggsfieldConfig = {
  /** `KEY_ID:KEY_SECRET`, as the console issues it. */
  credentials?: string;
  /** The same pair as two fields: how earlier console entries were stored. */
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  routing?: Partial<HiggsfieldRouting>;
  costSink?: CostSink;
  /** Hard ceiling; a request the vendor prices above this is refused before it is sent. */
  maxCostPerRequestUsd?: number;
  /** Polling cadence. The defaults are the vendor's guidance; tests shorten them. */
  polling?: { initialMs?: number; maxMs?: number };
};

type Plan = {
  endpoint: string;
  input: Record<string, unknown>;
  operation: CostOperation;
};

/** A shot submitted and not yet seen finish. */
type Pending = { estimate: number; operation: CostOperation; model: string; context: CallContext };

export class HiggsfieldProvider implements GenerativeMediaProvider {
  readonly name = 'higgsfield';
  readonly kind = 'media' as const;

  private readonly credentials: string;
  private readonly problem: string | null;
  private readonly baseUrl: string;
  private readonly routing: HiggsfieldRouting;
  private readonly costSink: CostSink | undefined;
  private readonly maxCostPerRequestUsd: number;
  private readonly polling: { initialMs: number; maxMs: number };
  private client: HiggsfieldClient | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly estimates = new Map<string, { usd: number; at: number }>();

  constructor(config: HiggsfieldConfig = {}) {
    const resolved = resolveCredentials(config);
    this.credentials = resolved.credentials;
    this.problem = resolved.problem;
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.routing = { ...DEFAULT_HIGGSFIELD_ROUTING, ...config.routing };
    this.costSink = config.costSink;
    this.maxCostPerRequestUsd = config.maxCostPerRequestUsd ?? 6;
    this.polling = {
      initialMs: config.polling?.initialMs ?? 2_000,
      maxMs: config.polling?.maxMs ?? 10_000,
    };
  }

  isConfigured(): boolean {
    return this.credentials.length > 0;
  }

  /**
   * Prices a four-second shot on the routed video model. That proves the
   * credentials, proves the model is enabled for the account, and shows what
   * a shot costs today — without generating anything or spending a credit.
   */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'media' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return {
        ...base,
        healthy: false,
        message:
          this.problem ??
          'Higgsfield credentials are not configured: KEY_ID:KEY_SECRET, from the console or HF_CREDENTIALS.',
      };
    }
    const startedAt = Date.now();
    const model = this.routing.video.studio;
    try {
      const usd = await this.estimateUsd(model, {
        prompt: 'Act One health check',
        duration: MIN_VIDEO_SECONDS,
        resolution: VIDEO_RESOLUTION.studio,
        aspect_ratio: ASPECTS['16:9'],
        output_format: 'mp4',
        generate_audio: false,
      });
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: `Credentials accepted. A ${MIN_VIDEO_SECONDS}-second shot on ${model} is priced at $${usd.toFixed(3)}.`,
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

  /** The vendor's own price for the request, in USD. */
  async estimateCost(request: ImageRequest | VideoRequest | EditRequest): Promise<number> {
    const plan = this.plan(request);
    return this.estimateUsd(plan.endpoint, plan.input);
  }

  async generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob> {
    return this.submit(this.plan(request), context);
  }

  async generateVideo(request: VideoRequest, context: CallContext): Promise<MediaJob> {
    const plan = this.plan(request);
    // Priced before anything is uploaded: a shot over the ceiling is refused
    // without moving a byte.
    const estimate = await this.estimateUsd(plan.endpoint, plan.input);
    if (request.initImageUrl) {
      plan.input['image_url'] = await this.publish(request.initImageUrl, context);
    }
    return this.submit(plan, context, estimate);
  }

  async editImage(_request: EditRequest, _context: CallContext): Promise<MediaJob> {
    throw new ProviderError(this.name, EDIT_UNAVAILABLE, { retryable: false });
  }

  async getJob(jobId: string, context: CallContext): Promise<MediaJob> {
    const status = await this.api(
      RequestStatus,
      'GET',
      `/requests/${encodeURIComponent(jobId)}/status`,
      undefined,
      { timeoutMs: 20_000, signal: context.signal },
    );
    return this.settle(status);
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
      // The vendor's guidance: two seconds, growing by half up to ten, with
      // jitter so a fleet of workers does not poll in step.
      await sleep(Math.round(delay * (0.8 + Math.random() * 0.4)));
      delay = Math.min(this.polling.maxMs, delay * 1.5);
    }

    throw new ProviderError(
      this.name,
      `Generation timed out after ${timeoutMs}ms; request ${jobId} may still finish on the vendor's side.`,
      { retryable: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Planning: a request in our vocabulary becomes a model and its input.
  // ---------------------------------------------------------------------------

  private plan(request: ImageRequest | VideoRequest | EditRequest): Plan {
    if ('instruction' in request) {
      throw new ProviderError(this.name, EDIT_UNAVAILABLE, { retryable: false });
    }

    if ('durationSeconds' in request) {
      const duration = Math.min(
        MAX_VIDEO_SECONDS,
        Math.max(MIN_VIDEO_SECONDS, Math.round(request.durationSeconds)),
      );
      // Silent on purpose: the film's sound is mixed here, and a shot that
      // arrives with its own audio would fight the score.
      const common = {
        prompt: request.prompt,
        duration,
        resolution: VIDEO_RESOLUTION[request.tier],
        output_format: 'mp4',
        generate_audio: false,
      };
      // Neither Seedance endpoint takes a seed, a negative prompt, a motion
      // strength or style references; those parts of the request are not
      // sent. Image-to-video takes its frame from the still, so no aspect.
      if (request.initImageUrl) {
        return {
          endpoint: this.routing.imageToVideo[request.tier],
          input: { image_url: request.initImageUrl, ...common },
          operation: 'media.video',
        };
      }
      return {
        endpoint: this.routing.video[request.tier],
        input: { ...common, aspect_ratio: ASPECTS[request.aspect] },
        operation: 'media.video',
      };
    }

    // One still, at the tier's resolution, from our prompt as written: the
    // vendor's prompt enhancement rewrites toward its house look, which is
    // the look every brand pays us not to have.
    return {
      endpoint: this.routing.image[request.tier],
      input: {
        prompt: request.prompt,
        aspect_ratio: ASPECTS[request.aspect],
        resolution: IMAGE_RESOLUTION[request.tier],
        batch_size: 1,
        enhance_prompt: false,
        ...(request.seed !== undefined
          ? { seed: Math.min(1_000_000, Math.max(1, Math.round(request.seed))) }
          : {}),
      },
      operation: 'media.image',
    };
  }

  // ---------------------------------------------------------------------------
  // Submission, through the SDK.
  // ---------------------------------------------------------------------------

  private async submit(plan: Plan, context: CallContext, priced?: number): Promise<MediaJob> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, this.problem ?? 'Higgsfield is not configured.', {
        retryable: false,
      });
    }
    const estimate = priced ?? (await this.estimateUsd(plan.endpoint, plan.input));
    if (estimate > this.maxCostPerRequestUsd) {
      throw new ProviderError(
        this.name,
        `Refusing a $${estimate.toFixed(2)} request above the $${this.maxCostPerRequestUsd} per-request ceiling.`,
        { retryable: false },
      );
    }

    let response: unknown;
    try {
      response = await this.sdk().subscribe(plan.endpoint, {
        input: plan.input,
        withPolling: false,
      });
    } catch (error) {
      throw this.fromSdk(error);
    }

    const parsed = RequestStatus.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError(
        this.name,
        'Higgsfield answered a submission with something other than a request.',
        { retryable: true },
      );
    }
    this.pending.set(parsed.data.request_id, {
      estimate,
      operation: plan.operation,
      model: plan.endpoint,
      context,
    });
    // Accepted is not finished. A moderated prompt can come back terminal
    // at once, so the answer goes through the same settlement as a poll.
    return this.settle(parsed.data, plan.endpoint, estimate);
  }

  private sdk(): HiggsfieldClient {
    if (!this.client) {
      // No automatic retry of a submission: the vendor has no idempotency
      // key, so a request that timed out ambiguously may well have been
      // accepted, and repeating it would buy the shot twice. A failure comes
      // back retryable and the caller decides.
      this.client = createHiggsfieldClient({
        credentials: this.credentials,
        baseURL: this.baseUrl,
        timeout: 60_000,
        maxRetries: 0,
      });
    }
    return this.client;
  }

  /**
   * Turns a request object into a job, and writes the ledger line the first
   * time a submitted request is seen finished. The vendor charges completed
   * requests only; failed, moderated and canceled ones are refunded, and the
   * ledger says the same.
   */
  private async settle(
    status: RequestStatus,
    model?: string,
    estimate?: number,
  ): Promise<MediaJob> {
    const pending = this.pending.get(status.request_id);
    const job = toJob(status, model ?? pending?.model ?? '', estimate ?? pending?.estimate ?? 0);
    if (pending && job.status !== 'queued' && job.status !== 'running') {
      this.pending.delete(status.request_id);
      await this.costSink?.record({
        provider: this.name,
        model: pending.model,
        operation: pending.operation,
        estimatedCostUsd: pending.estimate,
        actualCostUsd: job.status === 'succeeded' ? pending.estimate : 0,
        succeeded: job.status === 'succeeded',
        metadata: {
          requestId: status.request_id,
          status: status.status,
          projectId: pending.context.projectId,
          sceneId: pending.context.sceneId,
        },
      });
    }
    return job;
  }

  // ---------------------------------------------------------------------------
  // The REST surface around a request.
  // ---------------------------------------------------------------------------

  private async estimateUsd(endpoint: string, input: Record<string, unknown>): Promise<number> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, this.problem ?? 'Higgsfield is not configured.', {
        retryable: false,
      });
    }
    // The pipeline prices a shot for its budget and the provider prices it
    // again for the ceiling; the same request is not asked twice in a minute.
    const key = `${endpoint} ${JSON.stringify(input)}`;
    const cached = this.estimates.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.usd;

    const answer = await this.api(Estimate, 'POST', `/estimate/${endpoint}`, input, {
      timeoutMs: 20_000,
      attempts: 2,
    });
    const price = priceFromEstimate(answer);
    if (!price) {
      // The answer itself, so the console says what came back rather than
      // that something did. An estimate carries no secret.
      throw new ProviderError(
        this.name,
        `Higgsfield answered the estimate without a price: ${JSON.stringify(answer).slice(0, 300)}`,
        { retryable: false },
      );
    }
    this.estimates.set(key, { usd: price.usd, at: Date.now() });
    return price.usd;
  }

  /**
   * A reference the vendor can fetch. A public HTTPS URL is passed through.
   * Anything else — our own storage on this box, plain HTTP — is fetched here
   * and put on the vendor's CDN through its presigned upload, which is what
   * lets image-to-video work on a single machine with local storage.
   */
  private async publish(url: string, context: CallContext): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ProviderError(this.name, 'The reference image URL is not a URL.', {
        retryable: false,
      });
    }
    if (parsed.protocol === 'https:' && !isPrivateAddress(parsed.hostname)) return url;

    const bytes = await httpRequest<Uint8Array>(this.name, url, {
      expect: 'buffer',
      timeoutMs: 30_000,
      attempts: 2,
      signal: context.signal,
    });
    const contentType = imageType(bytes);
    if (!contentType) {
      throw new ProviderError(this.name, 'The reference image is not a JPEG, PNG, WebP or GIF.', {
        retryable: false,
      });
    }

    const grant = await this.api(
      UploadGrant,
      'POST',
      '/files/generate-upload-url',
      { content_type: contentType },
      { timeoutMs: 20_000, attempts: 2, signal: context.signal },
    );
    // The presigned URL gets the vendor's own headers and the bytes, and
    // never our credentials: the vendor is explicit about that.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(grant.upload_headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    headers['content-type'] ??= contentType;
    await httpRequest(this.name, grant.upload_url, {
      method: 'PUT',
      headers,
      body: bytes,
      expect: 'text',
      timeoutMs: 60_000,
      attempts: 2,
      signal: context.signal,
    });
    return grant.public_url;
  }

  /** Best effort. The vendor only cancels a request that has not started. */
  private async cancel(jobId: string): Promise<void> {
    const pending = this.pending.get(jobId);
    try {
      await httpRequest(this.name, `${this.baseUrl}/requests/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: this.headers(),
        expect: 'text',
        timeoutMs: 10_000,
        attempts: 1,
      });
    } catch {
      // Already in progress: it finishes, and is charged, whether or not
      // anyone is still waiting for it.
      return;
    }
    if (pending) {
      this.pending.delete(jobId);
      await this.costSink?.record({
        provider: this.name,
        model: pending.model,
        operation: pending.operation,
        estimatedCostUsd: pending.estimate,
        actualCostUsd: 0,
        succeeded: false,
        metadata: {
          requestId: jobId,
          status: 'canceled',
          projectId: pending.context.projectId,
          sceneId: pending.context.sceneId,
        },
      });
    }
  }

  private async api<T>(
    schema: z.ZodType<T>,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { timeoutMs?: number; attempts?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    let raw: unknown;
    try {
      raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${path}`, {
        method,
        body,
        headers: this.headers(),
        timeoutMs: options.timeoutMs ?? 30_000,
        attempts: options.attempts ?? 3,
        signal: options.signal,
      });
    } catch (error) {
      throw this.fromHttp(error);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, `Unexpected answer from ${path}.`, { retryable: true });
    }
    return parsed.data;
  }

  private headers(): Record<string, string> {
    return { authorization: `Key ${this.credentials}`, accept: 'application/json' };
  }

  /** The vendor's documented status codes, in words, with the retry decision made. */
  private fromHttp(error: unknown): ProviderError {
    if (!(error instanceof ProviderError)) {
      return new ProviderError(this.name, redact(String(error)), { retryable: true, cause: error });
    }
    switch (error.status) {
      case 400: {
        const detail = stripPrefix(error.message);
        return new ProviderError(this.name, detail, {
          retryable: /concurren/i.test(detail),
          status: 400,
        });
      }
      case 401:
        return new ProviderError(this.name, 'Higgsfield rejected the credentials.', {
          retryable: false,
          status: 401,
        });
      case 403:
        return new ProviderError(this.name, 'The Higgsfield account has no credits left.', {
          retryable: false,
          status: 403,
        });
      case 404:
        return new ProviderError(
          this.name,
          'Higgsfield has no such request or model for this account.',
          { retryable: false, status: 404 },
        );
      case 423:
      case 503:
        return new ProviderError(this.name, 'The Higgsfield model is temporarily unavailable.', {
          retryable: true,
          status: error.status,
        });
      default:
        return error;
    }
  }

  private fromSdk(error: unknown): ProviderError {
    if (error instanceof AuthenticationError) {
      return new ProviderError(this.name, 'Higgsfield rejected the credentials.', {
        retryable: false,
        status: 401,
        cause: error,
      });
    }
    if (error instanceof NotEnoughCreditsError) {
      return new ProviderError(this.name, 'The Higgsfield account has no credits left.', {
        retryable: false,
        status: 403,
        cause: error,
      });
    }
    if (error instanceof ValidationError || error instanceof BadInputError) {
      // A full queue is also a 400 here; that one clears on its own.
      const detail = redact(describeDetail(error));
      return new ProviderError(this.name, `Higgsfield rejected the request: ${detail}`, {
        retryable: /concurren/i.test(detail),
        status: error.statusCode,
        cause: error,
      });
    }
    if (error instanceof TimeoutError) {
      return new ProviderError(this.name, 'Higgsfield did not answer in time.', {
        retryable: true,
        cause: error,
      });
    }
    if (error instanceof APIError) {
      const status = error.statusCode;
      if (status === 404) {
        return new ProviderError(this.name, 'Higgsfield has no such model for this account.', {
          retryable: false,
          status,
          cause: error,
        });
      }
      return new ProviderError(
        this.name,
        `Higgsfield answered HTTP ${status ?? '?'}: ${redact(describeDetail(error))}`,
        {
          retryable: status === undefined || status === 423 || status >= 500,
          status,
          cause: error,
        },
      );
    }
    return new ProviderError(
      this.name,
      redact(error instanceof Error ? error.message : String(error)),
      {
        retryable: true,
        cause: error,
      },
    );
  }
}

const EDIT_UNAVAILABLE =
  'Image editing is not available: Higgsfield publishes no edit endpoint this integration has verified, and Act One does not guess at one. Generate a new still instead.';

/**
 * One credential, `KEY_ID:KEY_SECRET`. The console entry wins over the
 * environment, and a malformed console entry is a reported problem rather
 * than a silent fall through to whatever the environment holds.
 */
function resolveCredentials(config: HiggsfieldConfig): {
  credentials: string;
  problem: string | null;
} {
  const explicit = config.credentials?.trim() || pair(config.apiKey, config.apiSecret);
  if (explicit !== undefined || config.apiKey?.trim() || config.apiSecret?.trim()) {
    if (explicit && CREDENTIAL_FORMAT.test(explicit))
      return { credentials: explicit, problem: null };
    return {
      credentials: '',
      problem: 'Higgsfield credentials must be KEY_ID:KEY_SECRET, as the console issues them.',
    };
  }
  for (const candidate of [
    process.env.HF_CREDENTIALS,
    process.env.HF_KEY,
    pair(process.env.HF_API_KEY, process.env.HF_API_SECRET),
  ]) {
    const value = candidate?.trim();
    if (value && CREDENTIAL_FORMAT.test(value)) return { credentials: value, problem: null };
  }
  return { credentials: '', problem: null };
}

function pair(id: string | undefined, secret: string | undefined): string | undefined {
  const key = id?.trim();
  const value = secret?.trim();
  return key && value ? `${key}:${value}` : undefined;
}

function toJob(status: RequestStatus, model: string, estimate: number): MediaJob {
  const urls = [
    status.video?.url,
    ...(status.images ?? []).map((image) => image.url),
    status.audio?.url,
    ...(status.audios ?? []).map((audio) => audio.url),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0);
  const mapped = STATUS[status.status];
  const failure = describeFailure(status);
  return {
    id: status.request_id,
    status: mapped,
    outputUrls: urls,
    contentType: status.video
      ? 'video/mp4'
      : status.images?.length
        ? imageTypeFromUrl(urls[0] ?? '')
        : status.audio || status.audios?.length
          ? 'audio/wav'
          : 'application/octet-stream',
    ...(failure ? { error: failure } : {}),
    costUsd: mapped === 'succeeded' ? estimate : 0,
    model,
  };
}

function describeFailure(status: RequestStatus): string | undefined {
  switch (status.status) {
    case 'nsfw':
      return 'Rejected by Higgsfield content moderation: the prompt, the reference or the output. Nothing is charged.';
    case 'failed':
      return status.error ? `Generation failed: ${status.error}` : 'Generation failed.';
    case 'canceled':
      return 'Canceled before it started.';
    default:
      return undefined;
  }
}

function describeDetail(error: APIError & { details?: { loc?: string[]; msg: string }[] }): string {
  if (Array.isArray(error.details) && error.details.length > 0) {
    return error.details
      .map((item) => (item.loc?.length ? `${item.loc.join('.')}: ${item.msg}` : item.msg))
      .join('; ');
  }
  const detail = (error.responseData as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === 'string') return detail;
  return error.message;
}

function stripPrefix(message: string): string {
  return message.replace(/^\[higgsfield\] /, '');
}

function imageType(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ascii(0, 4) === 'GIF8') return 'image/gif';
  return null;
}

function imageTypeFromUrl(url: string): string {
  const match = url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
  const extension = match?.[1]?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}
