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

const DEFAULT_ROUTING: OpenAiModelRouting = {
  fast: 'gpt-4.1-mini',
  balanced: 'gpt-4.1',
  deep: 'gpt-4.1',
};

/** USD per 1M tokens. Used for the cost ledger; refreshed from Super Admin config. */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

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
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxOutputTokens ?? 4096,
    };
    if (mode?.strict) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: mode.strict.name, schema: mode.strict.schema, strict: true },
      };
    } else if (mode?.json) {
      body['response_format'] = { type: 'json_object' };
    }

    const response = await httpRequest<unknown>(this.name, `${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body,
      timeoutMs: 180_000,
      attempts: 3,
      signal: context.signal,
    });

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
  const pricing = PRICING[model] ?? PRICING['gpt-4.1']!;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

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
