import { ProviderError, type CallContext, type ProviderHealth } from '../types.ts';
import type {
  CompleteJsonOptions,
  CompleteOptions,
  LlmMessage,
  LlmProvider,
  LlmResult,
} from './types.ts';

export type ScriptedResponse = {
  /** Matched against the concatenated prompt; first match wins. */
  when?: RegExp | ((messages: LlmMessage[]) => boolean);
  respond: unknown | ((messages: LlmMessage[]) => unknown);
};

/**
 * Deterministic LLM stand-in.
 *
 * The creative engines are the parts of this system most worth testing and the
 * least testable against a live model. This provider lets those tests assert on
 * real engine behaviour — schema repair, diversity rejection, revision routing —
 * without a network call or a flaky assertion about model prose.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly kind = 'llm' as const;
  readonly calls: { messages: LlmMessage[]; options: CompleteOptions }[] = [];

  private readonly responses: ScriptedResponse[];
  private cursor = 0;

  constructor(responses: ScriptedResponse[]) {
    this.responses = responses;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: 'llm',
      healthy: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async complete(
    messages: LlmMessage[],
    options: CompleteOptions,
    _context: CallContext,
  ): Promise<LlmResult<string>> {
    const value = this.resolve(messages, options);
    return {
      value: typeof value === 'string' ? value : JSON.stringify(value),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'scripted' },
    };
  }

  async completeJson<T>(
    messages: LlmMessage[],
    options: CompleteJsonOptions<T>,
    _context: CallContext,
  ): Promise<LlmResult<T>> {
    const raw = this.resolve(messages, options);
    const candidate = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const parsed = options.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new ProviderError(
        this.name,
        `Scripted response failed ${options.schemaName}: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    return {
      value: parsed.data,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'scripted' },
    };
  }

  private resolve(messages: LlmMessage[], options: CompleteOptions): unknown {
    this.calls.push({ messages, options });
    const prompt = messages.map((m) => m.content).join('\n');

    for (const response of this.responses) {
      if (!response.when) continue;
      const matches =
        typeof response.when === 'function' ? response.when(messages) : response.when.test(prompt);
      if (matches) {
        return typeof response.respond === 'function'
          ? (response.respond as (m: LlmMessage[]) => unknown)(messages)
          : response.respond;
      }
    }

    const unconditional = this.responses.filter((r) => !r.when);
    const next = unconditional[Math.min(this.cursor, unconditional.length - 1)];
    if (!next) {
      throw new ProviderError(this.name, `No scripted response for prompt: ${prompt.slice(0, 200)}`);
    }
    this.cursor += 1;
    return typeof next.respond === 'function'
      ? (next.respond as (m: LlmMessage[]) => unknown)(messages)
      : next.respond;
  }
}
