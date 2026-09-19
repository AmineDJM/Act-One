import { z } from 'zod';
import { httpRequest } from '../http.ts';
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
    if (mode?.strict) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: mode.strict.name, schema: mode.strict.schema, strict: true },
      };
    } else if (mode?.json) {
      body['response_format'] = { type: 'json_object' };
    }

    const send = () =>
      httpRequest<unknown>(this.name, `${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body,
        timeoutMs: 180_000,
        attempts: 3,
        signal: context.signal,
      });

    let response: unknown;
    try {
      response = await send();
    } catch (error) {
      if (!refusedTemperature(error) || FIXED_TEMPERATURE.has(model)) throw error;
      FIXED_TEMPERATURE.add(model);
      delete body['temperature'];
      response = await send();
    }

    const parsed = ChatResponse.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError(this.name, 'Unexpected chat completion payload.', {
        retryable: true,
      });
    }

    const content = parsed.data.choices[0]?.message?.content ?? '';
    const inputTokens = parsed.data.usage?.prompt_tokens ?? estimateTokens(messages);
    const outputTokens = parsed.data.usage?.completion_tokens ?? Math.ceil(content.length / 4);
    const costUsd = priceFor(model, inputTokens, outputTokens);

    await this.costSink?.record({
      provider: this.name,
      model,
      operation: options.images?.length ? 'llm.vision' : 'llm.completion',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: inputTokens + outputTokens,
      unit: 'token',
      metadata: { tier, projectId: context.projectId, sceneId: context.sceneId },
    });

    return {
      value: content,
      usage: { inputTokens, outputTokens, costUsd, model: parsed.data.model ?? model },
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

export function priceFor(model: string, inputTokens: number, outputTokens: number): number {
  const known = PRICING[model];
  if (!known && !warned.has(model)) {
    warned.add(model);
    console.warn(`[openai] no price on record for ${model}; the ledger is charging it at the dearest rate we know.`);
  }
  const pricing = known ?? unpriced();
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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
