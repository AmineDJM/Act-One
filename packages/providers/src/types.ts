import type { CostOperation } from '@act-one/core';

/**
 * Providers are replaceable infrastructure. The rules that keep them that way:
 *
 *  1. Nothing outside this package may import a vendor SDK or mention a vendor
 *     model name. Callers ask for a capability and a quality tier.
 *  2. Every call that costs money reports through a CostSink, so the ledger is
 *     complete by construction rather than by remembering to log.
 *  3. Every provider declares health, so routing can fall back without the
 *     pipeline knowing which vendor it is talking to.
 */
export type ProviderKind = 'llm' | 'browser' | 'media' | 'speech' | 'storage' | 'analysis';

export type CostRecord = {
  provider: string;
  model?: string | null;
  operation: CostOperation;
  estimatedCostUsd: number;
  actualCostUsd: number;
  quantity?: number;
  unit?: string;
  succeeded?: boolean;
  isRetry?: boolean;
  /** Whether `actualCostUsd` is a rate somebody set or the ledger's own guess. */
  costBasis?: 'listed' | 'unknown_price';
  metadata?: Record<string, unknown>;
};

/** Where spend is recorded. The DB-backed implementation lives in @act-one/db. */
export interface CostSink {
  record(cost: CostRecord): Promise<void>;
}

export class NullCostSink implements CostSink {
  readonly records: CostRecord[] = [];
  async record(cost: CostRecord): Promise<void> {
    this.records.push(cost);
  }
}

export type ProviderHealth = {
  provider: string;
  kind: ProviderKind;
  healthy: boolean;
  checkedAt: string;
  latencyMs?: number;
  message?: string;
};

export interface Provider {
  readonly name: string;
  readonly kind: ProviderKind;
  health(): Promise<ProviderHealth>;
  /**
   * Whether this provider has what it needs to make a real call.
   *
   * Constructing a vendor client costs nothing and needs no key, so a registry
   * will happily hand back a provider for a vendor nobody has given credentials
   * to; it fails at the call, minutes later, somewhere else. That let "is video
   * available?" be answered yes on a deployment that had no video — the same
   * mistake as reading an absence as a decision. A provider that can tell the
   * difference says so here, and the registry asks before promising anything.
   */
  isConfigured?(): boolean;
}

/** Context threaded into every provider call so costs attribute correctly. */
export type CallContext = {
  organizationId: string;
  projectId?: string | null;
  sceneId?: string | null;
  renderId?: string | null;
  /** Aborts in-flight provider work when a render is cancelled. */
  signal?: AbortSignal;
};

export class ProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    provider: string,
    message: string,
    opts: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(`[${provider}] ${message}`, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'ProviderError';
    this.provider = provider;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}
