import { z } from 'zod';
import type { CallContext, Provider } from '../types.ts';

/**
 * Quality tiers, never model names. Routing between actual models happens in
 * the registry and is configurable by Super Admin at runtime.
 */
export type LlmTier = 'fast' | 'balanced' | 'deep';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ImageInput = {
  /** Data URL or https URL the provider can read. */
  url: string;
  detail?: 'low' | 'high';
};

export type CompleteOptions = {
  tier?: LlmTier;
  temperature?: number;
  maxOutputTokens?: number;
  /** Images for vision calls (QA, brand reading, screenshot understanding). */
  images?: ImageInput[];
};

export type CompleteJsonOptions<T> = CompleteOptions & {
  schema: z.ZodType<T>;
  schemaName: string;
  /**
   * Repairs are cheap compared to a failed pipeline stage: when the model
   * returns something that does not validate, we hand the validation errors
   * back and ask once more before giving up.
   */
  repairAttempts?: number;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  /** The part of the input the provider served from its prompt cache, billed at its cached rate. */
  cachedInputTokens?: number;
  costUsd: number;
  model: string;
  /**
   * How hard the model was allowed to think, when it was asked for less than
   * the tier's own setting.
   *
   * Set only when a hop between here and the model killed the request before
   * a single byte arrived and we asked again for something that would start
   * sooner. A reasoning model emits nothing while it thinks, so streaming
   * does not save a call from a time-to-first-byte limit \u2014 asking for less
   * deliberation does, and it is a worse answer, so it is recorded rather
   * than swallowed.
   */
  reducedEffort?: 'low' | 'medium';
};

export type LlmResult<T> = {
  value: T;
  usage: LlmUsage;
};

export interface LlmProvider extends Provider {
  readonly kind: 'llm';
  complete(
    messages: LlmMessage[],
    options: CompleteOptions,
    context: CallContext,
  ): Promise<LlmResult<string>>;
  completeJson<T>(
    messages: LlmMessage[],
    options: CompleteJsonOptions<T>,
    context: CallContext,
  ): Promise<LlmResult<T>>;
}
