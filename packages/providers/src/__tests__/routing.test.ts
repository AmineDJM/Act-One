import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUTING,
  IMAGE_RESOLUTION,
  MIN_VIDEO_RESOLUTION,
  VIDEO_RESOLUTION,
  priceFor,
  pricedModels,
  unpricedModels,
} from '../index.ts';

/**
 * What every agent in this platform talks to.
 *
 * The routing table is the highest-leverage constant in the codebase: the
 * director, the storyboard, the writer, the composer and the localiser all go
 * through it, and it had been left on a family that was two generations old
 * because nothing ever failed when it aged. Nothing will ever fail. So the
 * things that can be checked are checked here.
 */
describe('the model every agent is routed to', () => {
  it('gives each tier a model, and does not give three tiers the same one', () => {
    for (const tier of ['fast', 'balanced', 'deep'] as const) {
      expect(DEFAULT_ROUTING[tier], tier).toMatch(/^[a-z0-9.-]+$/);
    }
    // Three tiers exist so that a cheap question is asked cheaply. Pointing
    // them all at one model is the same as not having tiers, which is what
    // the previous default did with balanced and deep.
    expect(new Set(Object.values(DEFAULT_ROUTING)).size).toBeGreaterThan(1);
  });

  it('never silently charges an unpriced model at another model’s rate', () => {
    const cost = priceFor('some-model-nobody-priced', 1_000_000, 1_000_000);
    const dearest = Math.max(...pricedModels().map((model) => priceFor(model, 1_000_000, 1_000_000)));
    // Conservative rather than convenient: a ledger that overstates gets
    // checked, and one that understates gets acted on.
    expect(cost).toBeGreaterThanOrEqual(dearest);
    expect(unpricedModels()).toContain('some-model-nobody-priced');
  });

  it('prices a model it knows from its own table', () => {
    expect(priceFor('gpt-4.1', 1_000_000, 0)).toBeCloseTo(2, 5);
    expect(priceFor('gpt-4.1', 0, 1_000_000)).toBeCloseTo(8, 5);
  });
});

/**
 * The floor under a generated shot.
 *
 * A shot from the engine is cut into a master rendered at 1080p or 4K, where
 * it is already the softest thing on the screen. Below 720p it stops reading
 * as a choice and starts reading as a mistake, and the saving is a rounding
 * error against what the shot itself costs.
 */
describe('how small a generated shot is allowed to be', () => {
  it('never asks for a shot below 720p, on any tier', () => {
    for (const tier of ['authentic', 'studio', 'cinematic'] as const) {
      expect(VIDEO_RESOLUTION[tier], tier).toBe(MIN_VIDEO_RESOLUTION);
      expect(VIDEO_RESOLUTION[tier], tier).not.toBe('480p');
    }
  });

  it('never gives a still less than a moving shot gets', () => {
    const rank = { '480p': 0, '720p': 1, '1080p': 2 } as const;
    for (const tier of ['authentic', 'studio', 'cinematic'] as const) {
      expect(rank[IMAGE_RESOLUTION[tier]], tier).toBeGreaterThanOrEqual(rank[VIDEO_RESOLUTION[tier]]);
    }
  });
});
