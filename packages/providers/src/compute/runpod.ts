import { z } from 'zod';
import { httpRequest, sleep } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';

/**
 * RunPod: the GPU we rent rather than the model we buy.
 *
 * Everything else in this package is a vendor with an opinion — a video model,
 * an image model, a voice. This is the opposite: machines with GPUs in them
 * and nothing installed that we did not install. It exists for the work that
 * is ours rather than somebody's product:
 *
 *   BLENDER, when a shot genuinely needs geometry. The geometry executor is
 *   declared not production-ready precisely because no worker here has
 *   Blender; a GPU pod that does is what changes that answer, and it is the
 *   reason a director should never be quietly handed 2.5D when they asked for
 *   3D.
 *
 *   OPEN MODELS, where a hosted API has no equivalent or the licence matters.
 *
 *   ANALYSIS AND VISUAL QA at a scale that is silly to run on a render worker
 *   — optical flow over a ninety-second master is a minute of CPU we are
 *   currently spending inside the job that is trying to finish a film.
 *
 * THE ONE GENERAL-PURPOSE GPU. Deliberately singular. Two ways to rent a
 * machine is two sets of credentials, two failure modes and two things to
 * reason about when a render does not come back, in exchange for nothing a
 * customer can see.
 *
 * WHAT THIS IS NOT. It is not a route around the product rule, the provider
 * abstraction or the cost ledger. A pod that renders a shot bills through the
 * same sink as a shot bought from a vendor, because a GPU-hour we paid for is
 * as real as an API call we paid for and a ledger that only sees one of them
 * is wrong about what a film costs.
 */

const REST_URL = 'https://rest.runpod.io/v1';
const GRAPHQL_URL = 'https://api.runpod.io/graphql';

/** What a pod is for, which decides what it is worth waiting for. */
export type ComputeKind = 'geometry' | 'analysis' | 'open_model' | 'visual_qa';

const Myself = z.object({
  data: z
    .object({
      myself: z
        .object({
          id: z.string().nullish(),
          clientBalance: z.number().nullish(),
          currentSpendPerHr: z.number().nullish(),
        })
        .nullable(),
    })
    .nullable(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const RunJob = z.object({
  id: z.string(),
  status: z.string().optional(),
});

const JobStatus = z.object({
  id: z.string().optional(),
  status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT']),
  output: z.unknown().optional(),
  error: z.string().nullish(),
  executionTime: z.number().nullish(),
  delayTime: z.number().nullish(),
});
export type JobStatus = z.infer<typeof JobStatus>;

export type RunPodConfig = {
  apiKey?: string;
  baseUrl?: string;
  graphqlUrl?: string;
  costSink?: CostSink;
  /**
   * Serverless endpoint ids by the work they do.
   *
   * Empty by default and deliberately not guessed. An endpoint id is something
   * an operator deployed; inventing one produces a 404 that reads like an
   * outage rather than like a deployment nobody has done yet.
   */
  endpoints?: Partial<Record<ComputeKind, string>>;
  polling?: { initialMs?: number; maxMs?: number };
};

export class RunPodProvider {
  readonly name = 'runpod';
  readonly kind = 'compute' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly graphqlUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly endpoints: Partial<Record<ComputeKind, string>>;
  private readonly polling: { initialMs: number; maxMs: number };

  constructor(config: RunPodConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env['RUNPOD_API_KEY'] ?? '').trim();
    this.baseUrl = (config.baseUrl ?? REST_URL).replace(/\/$/, '');
    this.graphqlUrl = config.graphqlUrl ?? GRAPHQL_URL;
    this.costSink = config.costSink;
    this.endpoints = config.endpoints ?? endpointsFromEnv();
    this.polling = {
      initialMs: config.polling?.initialMs ?? 2_000,
      maxMs: config.polling?.maxMs ?? 15_000,
    };
  }

  isConfigured(): boolean {
    return canAuthenticate('runpod', this.apiKey);
  }

  /** Whether a particular kind of work has somewhere to run. */
  canRun(kind: ComputeKind): boolean {
    return this.isConfigured() && Boolean(this.endpoints[kind]);
  }

  /**
   * Reads the account.
   *
   * Reports the balance as well as reachability, because a GPU account is the
   * one provider here that stops working for a reason nobody gets an error
   * about until a pod refuses to start.
   */
  async health(): Promise<ProviderHealth> {
    const base = { provider: this.name, kind: 'compute' as unknown as 'media', checkedAt: new Date().toISOString() };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No RunPod credential is configured (RUNPOD_API_KEY).' };
    }
    const startedAt = Date.now();
    try {
      const answer = await httpRequest<unknown>(this.name, this.graphqlUrl, {
        method: 'POST',
        headers: this.headers(),
        body: { query: 'query { myself { id clientBalance currentSpendPerHr } }' },
        timeoutMs: 20_000,
        attempts: 2,
      });
      const parsed = Myself.safeParse(answer);
      const me = parsed.success ? parsed.data.data?.myself : null;

      if (!me?.id) {
        /*
         * A 200 with a null account is what an unauthenticated GraphQL call
         * looks like here — the endpoint answers happily and tells you
         * nothing. Reported as a credential failure rather than as reachable,
         * because "the API is up" is not the question anybody is asking.
         */
        return {
          ...base,
          healthy: false,
          latencyMs: Date.now() - startedAt,
          message: 'RunPod answered but returned no account: the credential is missing or rejected.',
        };
      }

      const deployed = (Object.keys(this.endpoints) as ComputeKind[]).filter((kind) => this.endpoints[kind]);
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message:
          `Account reachable${me.clientBalance === null || me.clientBalance === undefined ? '' : `, $${me.clientBalance.toFixed(2)} balance`}. ` +
          (deployed.length
            ? `Endpoints deployed for: ${deployed.join(', ')}.`
            : 'No serverless endpoints are configured, so no work can be sent yet.'),
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

  /**
   * Runs a job on a serverless endpoint and waits for it.
   *
   * Asynchronous rather than the synchronous `runsync` route, because the work
   * this exists for — a Blender frame, a pass of optical flow over a master —
   * routinely outlives any request timeout worth having, and a synchronous
   * call that dies at ninety seconds reports a failure for a job that is
   * still running and still being billed.
   */
  async run(
    kind: ComputeKind,
    input: Record<string, unknown>,
    context: CallContext,
    options: { timeoutMs?: number } = {},
  ): Promise<JobStatus> {
    const endpoint = this.endpoints[kind];
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'No RunPod credential is configured.', { retryable: false });
    }
    if (!endpoint) {
      throw new ProviderError(
        this.name,
        `No RunPod endpoint is deployed for ${kind}. Set ACT_ONE_RUNPOD_${kind.toUpperCase()}_ENDPOINT.`,
        { retryable: false },
      );
    }

    const started = Date.now();
    const created = await this.api(RunJob, 'POST', `/${endpoint}/run`, { input }, context.signal);
    const finished = await this.wait(endpoint, created.id, options.timeoutMs ?? 20 * 60_000, context);

    /*
     * Billed on the time the platform says it used, not on wall clock.
     *
     * A job that queued for four minutes and ran for twenty seconds cost
     * twenty seconds, and charging a customer's film for the queue would be
     * inventing a cost. Zero rate until an operator sets one: a GPU price
     * guessed in code is wrong the week the market moves.
     */
    const seconds = ((finished.executionTime ?? 0) || (Date.now() - started)) / 1000;
    await this.costSink?.record({
      provider: this.name,
      model: `${kind}:${endpoint}`,
      operation: kind === 'geometry' ? 'render.threed' : 'llm.vision',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      quantity: Math.round(seconds * 100) / 100,
      unit: 'second',
      succeeded: finished.status === 'COMPLETED',
      metadata: {
        organizationId: context.organizationId,
        projectId: context.projectId ?? null,
        delaySeconds: (finished.delayTime ?? 0) / 1000,
      },
    });

    if (finished.status !== 'COMPLETED') {
      throw new ProviderError(
        this.name,
        `The ${kind} job ${finished.status.toLowerCase().replace(/_/g, ' ')}${finished.error ? `: ${finished.error}` : '.'}`,
        { retryable: finished.status === 'TIMED_OUT' },
      );
    }
    return finished;
  }

  private async wait(
    endpoint: string,
    jobId: string,
    timeoutMs: number,
    context: CallContext,
  ): Promise<JobStatus> {
    const deadline = Date.now() + timeoutMs;
    let delay = this.polling.initialMs;

    while (Date.now() < deadline) {
      if (context.signal?.aborted) {
        await this.cancel(endpoint, jobId);
        throw new ProviderError(this.name, 'Cancelled.', { retryable: false });
      }
      const status = await this.api(JobStatus, 'GET', `/${endpoint}/status/${encodeURIComponent(jobId)}`, undefined, context.signal);
      if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') return status;
      await sleep(delay);
      delay = Math.min(this.polling.maxMs, Math.round(delay * 1.5));
    }

    // A job that outlived its budget is cancelled rather than abandoned: an
    // abandoned pod keeps billing.
    await this.cancel(endpoint, jobId);
    throw new ProviderError(this.name, `The job did not finish within ${Math.round(timeoutMs / 1000)}s.`, {
      retryable: true,
    });
  }

  async cancel(endpoint: string, jobId: string): Promise<void> {
    await httpRequest(this.name, `${this.baseUrl}/${endpoint}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: this.headers(),
      attempts: 1,
      timeoutMs: 15_000,
    }).catch(() => undefined);
  }

  private headers(): Record<string, string> {
    const common = { accept: 'application/json' };
    if (!this.apiKey && credentialIsManaged('runpod')) return common;
    return { ...common, authorization: `Bearer ${this.apiKey}` };
  }

  private async api<T>(
    schema: z.ZodType<T>,
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${pathname}`, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: this.headers(),
      timeoutMs: 60_000,
      attempts: method === 'GET' ? 3 : 1,
      ...(signal ? { signal } : {}),
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, `Unexpected answer from ${pathname}.`, { retryable: true });
    }
    return parsed.data;
  }
}

/**
 * Endpoint ids from the environment, one per kind of work.
 *
 * Separate variables rather than one blob because they are deployed
 * separately and usually by different people at different times: a host with
 * a Blender endpoint and no analysis endpoint is an ordinary state, and it
 * should be expressible without editing a JSON string.
 */
function endpointsFromEnv(): Partial<Record<ComputeKind, string>> {
  const read = (name: string) => process.env[name]?.trim() || undefined;
  const found: Partial<Record<ComputeKind, string>> = {};
  const geometry = read('ACT_ONE_RUNPOD_GEOMETRY_ENDPOINT');
  const analysis = read('ACT_ONE_RUNPOD_ANALYSIS_ENDPOINT');
  const openModel = read('ACT_ONE_RUNPOD_OPEN_MODEL_ENDPOINT');
  const visualQa = read('ACT_ONE_RUNPOD_VISUAL_QA_ENDPOINT');
  if (geometry) found.geometry = geometry;
  if (analysis) found.analysis = analysis;
  if (openModel) found.open_model = openModel;
  if (visualQa) found.visual_qa = visualQa;
  return found;
}
