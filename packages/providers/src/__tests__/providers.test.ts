import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  tryParseJson,
  estimateNarrationSeconds,
  LocalFsStorageProvider,
  ScriptedLlmProvider,
  ProviderRegistry,
  withFallback,
  ProviderError,
  NullCostSink,
  backoffMs,
  DEFAULT_PROVIDER_CONFIG,
  HiggsfieldProvider,
} from '../index.ts';

describe('tryParseJson', () => {
  it('recovers JSON the model wrapped in prose or fences', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(tryParseJson('Here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
    expect(tryParseJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns undefined rather than throwing on junk', () => {
    expect(tryParseJson('not json at all')).toBeUndefined();
  });
});

describe('estimateNarrationSeconds', () => {
  it('accounts for sentence pauses, not just word count', () => {
    const flat = estimateNarrationSeconds('one two three four five six seven eight nine ten');
    const punctuated = estimateNarrationSeconds('One two three. Four five six. Seven eight nine ten.');
    expect(punctuated).toBeGreaterThan(flat);
  });

  it('scales with rate', () => {
    const normal = estimateNarrationSeconds('a b c d e f g h i j', 1);
    const fast = estimateNarrationSeconds('a b c d e f g h i j', 1.5);
    expect(fast).toBeLessThan(normal);
  });
});

describe('LocalFsStorageProvider', () => {
  it('stores and reads bytes back', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-store-'));
    const storage = new LocalFsStorageProvider({ root });
    const data = new TextEncoder().encode('film bytes');

    const stored = await storage.put('org/org_1/project/prj_1/asset.png', data, {
      contentType: 'image/png',
    });
    expect(stored.bytes).toBe(data.byteLength);
    expect(stored.checksum).toHaveLength(64);
    expect(await storage.exists('org/org_1/project/prj_1/asset.png')).toBe(true);
    expect(new TextDecoder().decode(await storage.get('org/org_1/project/prj_1/asset.png'))).toBe(
      'film bytes',
    );
  });

  it('refuses keys that escape the storage root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-store-'));
    const storage = new LocalFsStorageProvider({ root });
    await expect(storage.put('../../etc/passwd', new Uint8Array([1]))).rejects.toThrow(
      /escapes the storage root/,
    );
    await expect(storage.get('org/../../../etc/passwd')).rejects.toThrow(
      /escapes the storage root/,
    );
  });
});

describe('ScriptedLlmProvider', () => {
  const context = { organizationId: 'org_1' };

  it('validates scripted responses against the caller schema', async () => {
    const provider = new ScriptedLlmProvider([{ respond: { name: 'Acme' } }]);
    const result = await provider.completeJson(
      [{ role: 'user', content: 'go' }],
      { schema: z.object({ name: z.string() }), schemaName: 'Thing' },
      context,
    );
    expect(result.value.name).toBe('Acme');
  });

  it('matches responses by prompt content', async () => {
    const provider = new ScriptedLlmProvider([
      { when: /concepts/i, respond: { kind: 'concepts' } },
      { when: /storyboard/i, respond: { kind: 'storyboard' } },
    ]);
    const schema = z.object({ kind: z.string() });
    const a = await provider.completeJson(
      [{ role: 'user', content: 'generate storyboard now' }],
      { schema, schemaName: 'X' },
      context,
    );
    expect(a.value.kind).toBe('storyboard');
  });
});

describe('withFallback', () => {
  it('falls back on a retryable failure', async () => {
    const result = await withFallback(
      'primary',
      'fallback',
      async (p) => {
        if (p === 'primary') throw new ProviderError('p', 'flaky', { retryable: true });
        return p;
      },
    );
    expect(result).toBe('fallback');
  });

  it('never falls back on a non-retryable failure', async () => {
    await expect(
      withFallback(
        'primary',
        'fallback',
        async (p) => {
          if (p === 'primary') throw new ProviderError('p', 'bad request', { retryable: false });
          return p;
        },
      ),
    ).rejects.toThrow(/bad request/);
  });

  it('propagates when there is no fallback configured', async () => {
    await expect(
      withFallback('primary', null, async () => {
        throw new ProviderError('p', 'down', { retryable: true });
      }),
    ).rejects.toThrow(/down/);
  });
});

describe('ProviderRegistry', () => {
  it('honours overrides so the pipeline can be tested without vendors', () => {
    const llm = new ScriptedLlmProvider([{ respond: {} }]);
    const registry = new ProviderRegistry({ overrides: { llm } });
    expect(registry.llm()).toBe(llm);
  });

  it('refuses disabled capabilities instead of silently degrading', () => {
    const registry = new ProviderRegistry({
      config: {
        ...DEFAULT_PROVIDER_CONFIG,
        media: { ...DEFAULT_PROVIDER_CONFIG.media, enabled: false },
      },
    });
    expect(() => registry.media()).toThrow(/disabled/);
    expect(registry.mediaOrNull()).toBeNull();
  });

  it('memoises provider instances', () => {
    const registry = new ProviderRegistry();
    expect(registry.storage()).toBe(registry.storage());
  });
});

describe('cost accounting', () => {
  it('records every media submission to the sink', async () => {
    const sink = new NullCostSink();
    const provider = new HiggsfieldProvider({ apiKey: 'test', costSink: sink });
    // Cost estimation is pure and testable without touching the network.
    expect(
      provider.estimateCost({
        prompt: 'x',
        aspect: '16:9',
        tier: 'cinematic',
        durationSeconds: 5,
      }),
    ).toBeCloseTo(2.1);
    expect(provider.estimateCost({ prompt: 'x', aspect: '16:9', tier: 'studio' })).toBeCloseTo(0.05);
  });

  it('refuses a request above the per-request ceiling before spending anything', async () => {
    const provider = new HiggsfieldProvider({ apiKey: 'test', maxCostPerRequestUsd: 1 });
    await expect(
      provider.generateVideo(
        { prompt: 'x', aspect: '16:9', tier: 'cinematic', durationSeconds: 10 },
        { organizationId: 'org_1' },
      ),
    ).rejects.toThrow(/ceiling/);
  });
});

describe('backoffMs', () => {
  it('respects a Retry-After header', () => {
    expect(backoffMs(1, '5')).toBe(5000);
    expect(backoffMs(1, '9999')).toBe(30_000);
  });

  it('grows exponentially with jitter inside a bounded window', () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const value = backoffMs(attempt, null);
      const base = Math.min(20_000, 500 * 2 ** (attempt - 1));
      expect(value).toBeGreaterThanOrEqual(base * 0.7);
      expect(value).toBeLessThanOrEqual(base * 1.3);
    }
  });
});
