import { z } from 'zod';

export const CostOperation = z.enum([
  'llm.completion',
  'llm.vision',
  'browser.session',
  'browser.page',
  'media.image',
  'media.video',
  'media.edit',
  'speech.tts',
  'render.motion',
  'render.threed',
  'render.composite',
  'storage.write',
]);
export type CostOperation = z.infer<typeof CostOperation>;

export const GenerationCost = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable().default(null),
  sceneId: z.string().nullable().default(null),
  renderId: z.string().nullable().default(null),
  provider: z.string(),
  model: z.string().nullable().default(null),
  operation: CostOperation,
  /** What we told the customer / budget gate before running. */
  estimatedCostUsd: z.number().min(0).default(0),
  /** What it actually cost us. Margin = credits charged - this. */
  actualCostUsd: z.number().min(0).default(0),
  creditsCharged: z.number().min(0).default(0),
  quantity: z.number().min(0).default(1),
  unit: z.string().default('call'),
  succeeded: z.boolean().default(true),
  isRetry: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type GenerationCost = z.infer<typeof GenerationCost>;

/**
 * Credits are the customer-facing unit. Users never see provider prices, and we
 * never see credits in the cost ledger — the two are reconciled here only.
 */
export const CREDIT_USD_VALUE = 0.02;

export function usdToCredits(usd: number, marginMultiplier = 3.2): number {
  return Math.max(1, Math.ceil((usd * marginMultiplier) / CREDIT_USD_VALUE));
}

export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD_VALUE;
}

export function grossMargin(costs: Pick<GenerationCost, 'actualCostUsd' | 'creditsCharged'>[]): {
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
} {
  const revenueUsd = costs.reduce((sum, c) => sum + creditsToUsd(c.creditsCharged), 0);
  const costUsd = costs.reduce((sum, c) => sum + c.actualCostUsd, 0);
  const marginUsd = revenueUsd - costUsd;
  return {
    revenueUsd,
    costUsd,
    marginUsd,
    marginPct: revenueUsd === 0 ? 0 : marginUsd / revenueUsd,
  };
}
