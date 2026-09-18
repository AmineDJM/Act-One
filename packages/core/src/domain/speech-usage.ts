import type { GenerationCost } from './cost.ts';

/**
 * What the voice cost, read back from the ledger.
 *
 * Every spoken passage, every listen-back and every clone reports through the
 * cost sink as it happens, so this is a view over the ledger rather than a
 * second set of books that could disagree with it. Grouped by provider and
 * by model because that is the comparison an operator makes when deciding
 * which engine reads finals.
 */
export type SpeechUsage = {
  characters: number;
  /** Seconds of audio synthesised, where the vendor's answer said. */
  secondsSynthesised: number;
  /** Seconds of audio listened back to for QA. */
  secondsTranscribed: number;
  costUsd: number;
  calls: number;
  failed: number;
  clones: number;
  byProvider: { provider: string; model: string | null; operation: string; characters: number; costUsd: number; calls: number }[];
};

const SPEECH_OPERATIONS = new Set(['speech.tts', 'speech.stt', 'speech.clone']);

export function speechUsageFrom(costs: Pick<GenerationCost, 'provider' | 'model' | 'operation' | 'actualCostUsd' | 'quantity' | 'unit' | 'succeeded' | 'metadata'>[]): SpeechUsage {
  const usage: SpeechUsage = {
    characters: 0,
    secondsSynthesised: 0,
    secondsTranscribed: 0,
    costUsd: 0,
    calls: 0,
    failed: 0,
    clones: 0,
    byProvider: [],
  };
  const groups = new Map<string, SpeechUsage['byProvider'][number]>();
  for (const cost of costs) {
    if (!SPEECH_OPERATIONS.has(cost.operation)) continue;
    usage.calls += 1;
    usage.costUsd += cost.actualCostUsd;
    if (cost.succeeded === false) usage.failed += 1;
    if (cost.operation === 'speech.clone') usage.clones += 1;
    const characters = cost.operation === 'speech.tts' && cost.unit === 'character' ? cost.quantity : 0;
    usage.characters += characters;
    if (cost.operation === 'speech.tts') {
      const seconds = cost.metadata?.['durationSeconds'];
      if (typeof seconds === 'number' && Number.isFinite(seconds)) usage.secondsSynthesised += seconds;
    }
    if (cost.operation === 'speech.stt' && cost.unit === 'second') usage.secondsTranscribed += cost.quantity;

    const key = `${cost.provider}|${cost.model ?? ''}|${cost.operation}`;
    const group = groups.get(key) ?? {
      provider: cost.provider,
      model: cost.model ?? null,
      operation: cost.operation,
      characters: 0,
      costUsd: 0,
      calls: 0,
    };
    group.characters += characters;
    group.costUsd += cost.actualCostUsd;
    group.calls += 1;
    groups.set(key, group);
  }
  usage.byProvider = [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
  return usage;
}
