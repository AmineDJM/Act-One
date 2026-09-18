import { describe, it, expect } from 'vitest';
import { newId } from '@act-one/core';
import { storeCases } from './stores.ts';

const rule = { limit: 3, windowSeconds: 60 };

describe.each(storeCases())('rate limits ($name)', ({ open, close }) => {
  it('counts attempts in a window and refuses the one past the limit', async () => {
    const store = await open();
    try {
      const key = `test:${newId('usr')}`;
      const now = Date.parse('2026-01-01T00:00:30.000Z');
      expect((await store.rateLimits.hit(key, rule, now)).remaining).toBe(2);
      expect((await store.rateLimits.hit(key, rule, now)).remaining).toBe(1);
      expect((await store.rateLimits.hit(key, rule, now)).allowed).toBe(true);
      const refused = await store.rateLimits.hit(key, rule, now);
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBe(30);
    } finally {
      await close(store);
    }
  });

  it('starts fresh in the next window, and keeps keys apart', async () => {
    const store = await open();
    try {
      const key = `test:${newId('usr')}`;
      const other = `test:${newId('usr')}`;
      const now = Date.parse('2026-01-01T00:00:30.000Z');
      for (let i = 0; i < 4; i += 1) await store.rateLimits.hit(key, rule, now);
      expect((await store.rateLimits.hit(key, rule, now)).allowed).toBe(false);
      expect((await store.rateLimits.hit(other, rule, now)).allowed).toBe(true);
      expect((await store.rateLimits.hit(key, rule, now + 60_000)).allowed).toBe(true);
    } finally {
      await close(store);
    }
  });

  it('prunes windows that have ended', async () => {
    const store = await open();
    try {
      const key = `test:${newId('usr')}`;
      const past = Date.parse('2020-01-01T00:00:00.000Z');
      await store.rateLimits.hit(key, rule, past);
      expect(await store.rateLimits.prune(past + 120_000)).toBeGreaterThanOrEqual(1);
      // A pruned window counts from zero again.
      expect((await store.rateLimits.hit(key, rule, past)).remaining).toBe(2);
    } finally {
      await close(store);
    }
  });
});
