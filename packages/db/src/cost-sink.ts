import { newId, usdToCredits, type CostOperation } from '@act-one/core';
import type { Store } from './store.ts';

export type CostRecordInput = {
  provider: string;
  model?: string | null;
  operation: CostOperation;
  estimatedCostUsd: number;
  actualCostUsd: number;
  quantity?: number;
  unit?: string;
  succeeded?: boolean;
  isRetry?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Bridges the provider layer's CostSink to the ledger.
 *
 * Bound to one organisation and project at construction so a cost can never be
 * attributed to the wrong tenant, and so the provider layer never has to know
 * what a tenant is. Credits are computed here — the single place that converts
 * what a vendor charged us into what we charge the customer.
 */
export class DbCostSink {
  private readonly store: Store;
  private readonly scope: {
    organizationId: string;
    projectId?: string | null;
    renderId?: string | null;
    marginMultiplier?: number;
  };

  constructor(
    store: Store,
    scope: {
      organizationId: string;
      projectId?: string | null;
      renderId?: string | null;
      marginMultiplier?: number;
    },
  ) {
    this.store = store;
    this.scope = scope;
  }

  async record(cost: CostRecordInput): Promise<void> {
    const credits = usdToCredits(cost.actualCostUsd, this.scope.marginMultiplier ?? 3.2);
    const sceneId =
      typeof cost.metadata?.['sceneId'] === 'string' ? (cost.metadata['sceneId'] as string) : null;

    await this.store.costs.record({
      id: newId('cst'),
      organizationId: this.scope.organizationId,
      projectId: this.scope.projectId ?? null,
      sceneId,
      renderId: this.scope.renderId ?? null,
      provider: cost.provider,
      model: cost.model ?? null,
      operation: cost.operation,
      estimatedCostUsd: cost.estimatedCostUsd,
      actualCostUsd: cost.actualCostUsd,
      creditsCharged: credits,
      quantity: cost.quantity ?? 1,
      unit: cost.unit ?? 'call',
      succeeded: cost.succeeded ?? true,
      isRetry: cost.isRetry ?? false,
      metadata: cost.metadata ?? {},
      createdAt: new Date().toISOString(),
    });

    if (this.scope.projectId) {
      await this.store.projects.addCost(
        this.scope.organizationId,
        this.scope.projectId,
        cost.actualCostUsd,
        credits,
      );
    }
  }
}
