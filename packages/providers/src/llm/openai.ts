import { z } from 'zod';
import { httpRequest, httpStream } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import { toStrictJsonSchema } from './json-schema.ts';
import type {
  CompleteJsonOptions,
  CompleteOptions,
  LlmMessage,
  LlmProvider,
  LlmResult,
  LlmTier,
} from './types.ts';

export type OpenAiModelRouting = Record<LlmTier, string>;

export type OpenAiConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** Tier -> model. Super Admin editable; never referenced outside this package. */
  routing?: Partial<OpenAiModelRouting>;
  costSink?: CostSink;
  organization?: string;
};

/*
 * Chosen by measurement, not by version number.
 *
 * Every creative decision in this system goes through here, so the default
 * matters more than any other constant in the codebase. The three below were
 * picked by running the hardest real task this platform has — writing a film
 * into German, where a line has the seconds its shot runs and not one more —
 * and scoring the result with the system's own checks: how many lines came
 * back unfittable, and how far the worst one overran.
 *
 * The outcome was not the one the version numbers suggest. The newest and
 * largest models were slower by an order of magnitude and no better, and two
 * of them were worse: a constrained task with a hard budget is not what deep
 * reasoning buys you, and the extra thinking shows up as latency and tokens
 * on every single call. The family below scored clean and ran fastest.
 *
 * This is a default, not a verdict. It is editable per deployment from the
 * console, and should be re-measured when a new family ships rather than
 * assumed.
 */
const DEFAULT_ROUTING: OpenAiModelRouting = {
  fast: 'gpt-5.4-mini',
  balanced: 'gpt-5.4',
  deep: 'gpt-5.5',
};

/**
 * USD per 1M tokens, for the cost ledger.
 *
 * These are the rates we have been told; nothing here refreshes them, so an
 * operator should check them against their own billing page before quoting a
 * margin off this ledger. A model missing from the table is the case that
 * matters, and it used to be handled by quietly charging it at another model's
 * rate — which produces a dashboard that is confidently wrong. It is now
 * charged at the dearest rate we know and says so once, because a cost report
 * that overstates is a report somebody double-checks and one that understates
 * is one they act on.
 */
const BUILT_IN_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

/**
 * What a model costs, per million tokens, as something an operator can set.
 *
 * A price list compiled into a build goes stale the week after it ships, and
 * the models this product actually routes to are newer than any table anyone
 * remembered to update — so every call was billed at the dearest rate in the
 * table and the ledger was quietly wrong about what the business spends. It
 * still falls back to that rate, because guessing high is the safe direction,
 * but the operator can now put the real number in without a deploy and the
 * console says which models are still guesses.
 */
let PRICING: Record<string, { input: number; output: number }> = { ...BUILT_IN_PRICING };

export function setModelPrices(prices: Record<string, { input: number; output: number }>): void {
  PRICING = { ...BUILT_IN_PRICING, ...prices };
  // A model that has just been given a price is no longer a model we warned
  // about, and an operator who fixed it should stop being told off for it.
  for (const model of Object.keys(prices)) warned.delete(model);
}

/** The dearest rate on record, for a model nobody has priced. Guessing high is safe. */
function unpriced(): { input: number; output: number } {
  return Object.values(PRICING).reduce(
    (dearest, rate) => ({
      input: Math.max(dearest.input, rate.input),
      output: Math.max(dearest.output, rate.output),
    }),
    { input: 0, output: 0 },
  );
}

const warned = new Set<string>();

/** Models the ledger is guessing about, for a console that wants to say so. */
export function unpricedModels(): string[] {
  return [...warned].sort();
}

/**
 * Models that answered 400 to a temperature we chose.
 *
 * Learned rather than declared, and per process: a worker discovers it once on
 * its first call and never pays for it again.
 */
const FIXED_TEMPERATURE = new Set<string>();

/**
 * Models whose full deliberation cannot get a byte past this host.
 *
 * Learned the same way and for the same reason as the temperature above: the
 * limit belongs to whatever sits between this process and the model, it is
 * not written anywhere, and it differs between a laptop, this sandbox, Render
 * and a customer's corporate egress. Discovering it costs one cut request;
 * rediscovering it on every deep call of every stage costs two minutes each
 * time, on a pipeline that makes several per film.
 */
const SLOW_TO_START = new Map<string, 'low' | 'medium'>();

/**
 * A chat completion, reassembled from its stream.
 *
 * `usage` arrives in a final chunk of its own when `stream_options` asks for
 * it, and does not arrive at all from every gateway — so both token counts are
 * optional and the caller estimates when they are missing, exactly as it did
 * when the response came back whole.
 */
export type StreamedCompletion = {
  content: string;
  model: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

export type Collector = {
  /** Text not yet ending in a newline: an SSE event split across two chunks. */
  pending: string;
  parts: string[];
  model: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  /** Set when the model stopped for a reason the caller should know about. */
  finish: string | null;
};

export function newCollector(): Collector {
  return { pending: '', parts: [], model: undefined, inputTokens: undefined, outputTokens: undefined, finish: null };
}

/**
 * Server-sent events, one chunk at a time.
 *
 * Chunks do not respect event boundaries — a `data:` line routinely arrives in
 * two pieces — so whatever follows the last newline is held back until the
 * next chunk completes it. Getting this wrong produces a JSON parse error on
 * perfectly good output, occasionally, under load, which is the worst kind of
 * bug to own.
 */
export function consumeSse(text: string, into: Collector): void {
  const buffered = into.pending + text;
  const lines = buffered.split('\n');
  into.pending = lines.pop() ?? '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;

    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      // A malformed event is dropped rather than failing the generation: the
      // content that did arrive is still the model's answer.
      continue;
    }
    const parsed = StreamEvent.safeParse(event);
    if (!parsed.success) continue;

    if (parsed.data.model) into.model = parsed.data.model;
    if (parsed.data.usage) {
      into.inputTokens = parsed.data.usage.prompt_tokens ?? into.inputTokens;
      into.outputTokens = parsed.data.usage.completion_tokens ?? into.outputTokens;
    }
    for (const choice of parsed.data.choices ?? []) {
      const delta = choice.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) into.parts.push(delta);
      if (choice.finish_reason) into.finish = choice.finish_reason;
    }
  }
}

export function finishCollector(collector: Collector): StreamedCompletion {
  return {
    content: collector.parts.join(''),
    model: collector.model,
    inputTokens: collector.inputTokens,
    outputTokens: collector.outputTokens,
  };
}

const StreamEvent = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .nullable()
    .optional(),
});

function refusedTemperature(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /temperature/i.test(message) && /unsupported|does not support|not supported/i.test(message);
}

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';
  readonly kind = 'llm' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly routing: OpenAiModelRouting;
  private readonly costSink: CostSink | undefined;
  private readonly organization: string | undefined;

  constructor(config: OpenAiConfig = {}) {
    // An empty key is legitimate when an egress proxy injects credentials, which
    // is how this runs in our hosted environment.
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
      .replace(/\/$/, '');
    this.routing = { ...DEFAULT_ROUTING, ...config.routing };
    this.costSink = config.costSink;
    this.organization = config.organization;
  }

  modelFor(tier: LlmTier = 'balanced'): string {
    return this.routing[tier];
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      await httpRequest(this.name, `${this.baseUrl}/models`, {
        headers: this.headers(),
        timeoutMs: 10_000,
        attempts: 1,
      });
      return {
        provider: this.name,
        kind: 'llm',
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.name,
        kind: 'llm',
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async complete(
    messages: LlmMessage[],
    options: CompleteOptions,
    context: CallContext,
  ): Promise<LlmResult<string>> {
    return this.call(messages, options, context, undefined);
  }

  async completeJson<T>(
    messages: LlmMessage[],
    options: CompleteJsonOptions<T>,
    context: CallContext,
  ): Promise<LlmResult<T>> {
    const repairAttempts = options.repairAttempts ?? 1;
    let conversation = [...messages];
    let lastIssues = '';
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;

    // Structured outputs where the schema can express them: the model is then
    // constrained by the API rather than asked nicely, and the repair loop
    // below becomes a fallback instead of the primary mechanism.
    const strict = toStrictJsonSchema(options.schema, options.schemaName);

    for (let attempt = 0; attempt <= repairAttempts; attempt += 1) {
      const result = await this.call(conversation, options, context, {
        json: true,
        ...(strict ? { strict } : {}),
      });
      totalCost += result.usage.costUsd;
      totalIn += result.usage.inputTokens;
      totalOut += result.usage.outputTokens;

      const parsedJson = tryParseJson(result.value);
      if (parsedJson !== undefined) {
        const validated = options.schema.safeParse(parsedJson);
        if (validated.success) {
          return {
            value: validated.data,
            usage: {
              inputTokens: totalIn,
              outputTokens: totalOut,
              costUsd: totalCost,
              model: result.usage.model,
            },
          };
        }
        lastIssues = formatIssues(validated.error);
      } else {
        lastIssues = 'Response was not parseable JSON.';
      }

      if (attempt === repairAttempts) break;
      conversation = [
        ...messages,
        { role: 'assistant', content: result.value.slice(0, 6000) },
        {
          role: 'user',
          content:
            `That response did not satisfy the ${options.schemaName} schema.\n` +
            `Problems:\n${lastIssues}\n\n` +
            'Return corrected JSON only. No prose, no code fences.',
        },
      ];
    }

    throw new ProviderError(
      this.name,
      `Model could not produce valid ${options.schemaName}: ${lastIssues}`,
      { retryable: true },
    );
  }

  private async call(
    messages: LlmMessage[],
    options: CompleteOptions,
    context: CallContext,
    mode: { json: boolean; strict?: { name: string; schema: Record<string, unknown> } } | undefined,
  ): Promise<LlmResult<string>> {
    const tier = options.tier ?? 'balanced';
    const model = this.modelFor(tier);
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(messages, options),
      max_completion_tokens: options.maxOutputTokens ?? 4096,
    };
    /*
     * Temperature, where the model still has one.
     *
     * Newer models refuse any value but their default and answer 400. A table
     * of which ones would be wrong within a month — this is exactly the kind of
     * fact that changes under you — so the first refusal is remembered for the
     * process and the request is sent again without it. One wasted call per
     * model per worker, and nothing to keep up to date.
     */
    if (!FIXED_TEMPERATURE.has(model)) body['temperature'] = options.temperature ?? 0.7;
    /*
     * Already known to be too slow off the mark on this host, so it is asked
     * for less deliberation from the start rather than after another cut.
     */
    const remembered = SLOW_TO_START.get(model);
    if (remembered) body['reasoning_effort'] = remembered;
    if (mode?.strict) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: mode.strict.name, schema: mode.strict.schema, strict: true },
      };
    } else if (mode?.json) {
      body['response_format'] = { type: 'json_object' };
    }

    /*
     * Streamed, always.
     *
     * Not for the user interface — nothing here shows a model typing. For
     * survival: a deep-tier answer takes ninety seconds or more, and a silent
     * ninety-second request is killed by every intermediary between this
     * process and the model. Measured at 92.2s in one sandbox; Render's
     * router, Cloudflare and any corporate egress each have their own number
     * and none of them is written anywhere the person debugging it will look.
     * The symptom is an HTTP 502 that survives all three retries, because a
     * deterministic timeout is not a transient failure.
     *
     * With bytes arriving continuously there is nothing for an intermediary
     * to act on, and the timeout becomes what it should always have been:
     * how long nothing at all may happen, rather than how long a good answer
     * is allowed to take.
     */
    body['stream'] = true;
    body['stream_options'] = { include_usage: true };

    const send = async (): Promise<StreamedCompletion> => {
      const collector = newCollector();
      await httpStream(this.name, `${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body,
        // Four, because the gateway in front of the model is the thing that
        // fails, and a stage that has already paid for a crawl is not thrown
        // away over a hop that would have come back in ten seconds.
        attempts: 4,
        idleTimeoutMs: 60_000,
        signal: context.signal,
        onChunk: (text) => consumeSse(text, collector),
      });
      return finishCollector(collector);
    };

    let streamed: StreamedCompletion;
    let reducedEffort: 'low' | 'medium' | undefined = remembered;
    try {
      streamed = await send();
    } catch (error) {
      /*
       * What was actually sent, when asked for it.
       *
       * A provider error names a status and a sentence of the body, and for a
       * gateway failure that sentence is "upstream request failed", which
       * says nothing about which of a dozen calls a stage makes is the one
       * that cannot get through. Set ACT_ONE_LLM_DUMP_DIR and the request
       * that failed is written out whole, so the next question is answerable
       * from evidence rather than from a second ten-minute run.
       *
       * Off unless asked for: the body is the customer's own material.
       */
      await dumpFailedRequest(body, error);

      /*
       * Killed before the model said anything.
       *
       * Streaming was supposed to end this: bytes arriving continuously give
       * no intermediary a reason to intervene. It does not help when there
       * are no bytes to send \u2014 a reasoning model emits nothing at all while
       * it thinks, and on a long prompt that silence can run past whatever
       * time-to-first-byte limit the hop in front of it enforces. Measured
       * here: the same storyboard request, same bytes, answered by the
       * balanced model in 9.2s and cut at exactly 30.09s on the deep one,
       * four attempts running, twice.
       *
       * Retrying is useless \u2014 it is deterministic, not transient \u2014 and the
       * stage has already paid for a crawl and a director's arbitration. So
       * the model is asked for less deliberation, which is what actually
       * moves the first byte: 7.9s at `low` on the request that could not get
       * a byte out in thirty seconds at the default.
       *
       * It is a worse answer, and it is recorded as one. A silent downgrade
       * presented as a success is the failure this whole codebase keeps
       * finding in itself.
       */
      if (isGatewayCut(error)) {
        let answered: StreamedCompletion | null = null;
        for (const effort of effortLadder(remembered)) {
          body['reasoning_effort'] = effort;
          try {
            answered = await send();
            reducedEffort = effort;
            SLOW_TO_START.set(model, effort);
            console.warn(
              `[openai] ${model} could not get a byte past the gateway at ` +
                `${remembered ? `reasoning_effort=${remembered}` : 'full deliberation'}; answered at ` +
                `reasoning_effort=${effort}. The answer is less considered than the tier asks for.`,
            );
            break;
          } catch (retryError) {
            if (!isGatewayCut(retryError)) {
              delete body['reasoning_effort'];
              throw retryError;
            }
          }
        }
        if (answered === null) throw error;
        streamed = answered;
      } else {
        /*
         * Retried whenever THIS request carried a temperature, not only when
         * the model was unknown. Calls sent together all go out with one
         * before the first refusal is learned, and the ones that heard back
         * second used to see the model already in the set and give up on a
         * request that would have succeeded — five scenes of six, measured,
         * when a film's scenes were written in parallel. Without the field
         * the retry cannot be refused for it again, so this cannot loop.
         */
        if (!refusedTemperature(error) || !('temperature' in body)) throw error;
        FIXED_TEMPERATURE.add(model);
        delete body['temperature'];
        streamed = await send();
      }
    }

    const content = streamed.content;
    const inputTokens = streamed.inputTokens ?? estimateTokens(messages);
    const outputTokens = streamed.outputTokens ?? Math.ceil(content.length / 4);
    const priced = priceCall(model, inputTokens, outputTokens);
    const costUsd = priced.costUsd;

    await this.costSink?.record({
      provider: this.name,
      model,
      operation: options.images?.length ? 'llm.vision' : 'llm.completion',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: inputTokens + outputTokens,
      unit: 'token',
      // Carried so the console can separate what was measured from what was
      // guessed, rather than presenting one total that is partly fiction.
      costBasis: priced.basis,
      metadata: { tier, projectId: context.projectId, sceneId: context.sceneId },
    });

    return {
      value: content,
      usage: {
        inputTokens,
        outputTokens,
        costUsd,
        model: streamed.model ?? model,
        ...(reducedEffort ? { reducedEffort } : {}),
      },
    };
  }

  private buildMessages(messages: LlmMessage[], options: CompleteOptions): unknown[] {
    const images = options.images ?? [];
    return messages.map((message, index) => {
      const isLastUser =
        images.length > 0 && message.role === 'user' && index === lastUserIndex(messages);
      if (!isLastUser) return { role: message.role, content: message.content };
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: image.url, detail: image.detail ?? 'high' },
          })),
        ],
      };
    });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    if (this.organization) headers['openai-organization'] = this.organization;
    return headers;
  }
}

function lastUserIndex(messages: LlmMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') return i;
  }
  return messages.length - 1;
}

/**
 * What a call cost, and whether that number is a price or a guess.
 *
 * Both are returned because only one of them used to be, and the missing one
 * is the one that matters: a model absent from the table was billed at the
 * dearest rate on record and entered the ledger looking exactly like a
 * measured cost. Every report built on it was confidently wrong and nobody
 * reading it could tell.
 *
 * Still the dearest rate — guessing high is the safe direction, and a film
 * must not stop because a price list is out of date — but it arrives labelled.
 */
export function priceCall(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; basis: 'listed' | 'unknown_price' } {
  const known = PRICING[model];
  if (!known && !warned.has(model)) {
    warned.add(model);
    console.warn(
      `[openai] no price on record for ${model}; the ledger is charging it at the dearest rate ` +
        'we know and marking it UNKNOWN_PRICE. Set the real rate in the Super Admin console.',
    );
  }
  const pricing = known ?? unpriced();
  return {
    costUsd: (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output,
    basis: known ? 'listed' : 'unknown_price',
  };
}

/** The cost alone, for callers that only need the number. */
export function priceFor(model: string, inputTokens: number, outputTokens: number): number {
  return priceCall(model, inputTokens, outputTokens).costUsd;
}

/** What the table holds, for a test and for the console. */
export function pricedModels(): string[] {
  return Object.keys(PRICING).sort();
}

export { DEFAULT_ROUTING };

function estimateTokens(messages: LlmMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
}

/** Models occasionally wrap JSON in prose or fences despite being told not to. */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * What to try next, given what was already asked for.
 *
 * Only downward, and never repeating a setting that has just been cut: a
 * remembered `medium` that fails leaves only `low`, and a remembered `low`
 * that fails leaves nothing at all, which is the honest answer \u2014 this host
 * cannot carry this model, and saying so beats another minute of trying.
 */
export function effortLadder(remembered: 'low' | 'medium' | undefined): readonly ('low' | 'medium')[] {
  if (remembered === 'low') return [];
  if (remembered === 'medium') return ['low'];
  return ['medium', 'low'];
}

/**
 * A hop in front of the model killed the request before a byte arrived.
 *
 * `httpStream` only retries before the first byte, so any provider error
 * carrying a gateway status is one of these by construction: once the stream
 * has started, a failure surfaces as an abort rather than a status.
 */
export function isGatewayCut(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 502 || status === 503 || status === 504;
}

/** Writes a failed request out, when ACT_ONE_LLM_DUMP_DIR says to. */
async function dumpFailedRequest(body: Record<string, unknown>, error: unknown): Promise<void> {
  const dir = process.env['ACT_ONE_LLM_DUMP_DIR'];
  if (!dir) return;
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const serialized = JSON.stringify(body);
    const name = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(
      `${dir}/${name}`,
      JSON.stringify(
        {
          error: (error as Error).message.slice(0, 2000),
          model: body['model'],
          bytes: serialized.length,
          schemaName:
            (body['response_format'] as { json_schema?: { name?: string } } | undefined)?.json_schema?.name ?? null,
          body: JSON.parse(serialized) as unknown,
        },
        null,
        2,
      ),
    );
    console.error(`[openai] the failed request was written to ${dir}/${name} (${serialized.length} bytes).`);
  } catch {
    // Diagnostics never fail the call they are diagnosing.
  }
}
