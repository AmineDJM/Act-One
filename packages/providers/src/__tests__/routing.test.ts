import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_ROUTING,
  IMAGE_RESOLUTION,
  MIN_VIDEO_RESOLUTION,
  VIDEO_RESOLUTION,
  priceFor,
  pricedModels,
  setModelPrices,
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

describe('what a model costs, set by whoever pays the bill', () => {
  afterEach(() => setModelPrices({}));

  it('bills a model the operator priced at that price', () => {
    setModelPrices({ 'gpt-5.4': { input: 1.25, output: 10 } });
    // A million in, a million out.
    expect(priceFor('gpt-5.4', 1_000_000, 1_000_000)).toBeCloseTo(11.25);
  });

  it('stops calling a model unpriced once it has a price', () => {
    priceFor('some-model-nobody-priced', 1000, 1000);
    expect(unpricedModels()).toContain('some-model-nobody-priced');
    setModelPrices({ 'some-model-nobody-priced': { input: 1, output: 2 } });
    expect(unpricedModels()).not.toContain('some-model-nobody-priced');
  });

  it('knows the price of every model the default routing sends work to', () => {
    /*
     * The models this product routes to by default were missing from the
     * table, so each call to them was billed at the dearest listed rate —
     * gpt-4o's, under half of gpt-5.5's. The ledger understated the deep
     * tier by two to three times while saying it was guessing high.
     */
    for (const [tier, model] of Object.entries(DEFAULT_ROUTING)) expect(pricedModels(), tier).toContain(model);
    // OpenAI's standard rates for gpt-5.5 under 272K tokens: $5 in, $30 out per million.
    expect(priceFor('gpt-5.5', 1_000_000, 1_000_000)).toBeCloseTo(35);
    expect(unpricedModels()).not.toContain('gpt-5.5');
  });

  it('bills input served from the prompt cache at the cached rate', () => {
    /*
     * A scene agent resends one long system prompt for every scene, so most of
     * its input comes back from the provider's cache at a tenth of the price.
     * Charged as fresh input, a film's scenes looked several times dearer than
     * the bill: $0.50 per million cached against $5 fresh for gpt-5.5.
     */
    expect(priceFor('gpt-5.5', 1_000_000, 0, 800_000)).toBeCloseTo(0.2 * 5 + 0.8 * 0.5);
    // Never more cached than was sent, and never a negative count.
    expect(priceFor('gpt-5.5', 1_000_000, 0, 5_000_000)).toBeCloseTo(0.5);
    expect(priceFor('gpt-5.5', 1_000_000, 0, -10)).toBeCloseTo(5);
  });

  it('bills cached input as input where no cached rate is known: over rather than under', () => {
    setModelPrices({ 'gpt-5.4': { input: 3, output: 10 } });
    expect(priceFor('gpt-5.4', 1_000_000, 0, 1_000_000)).toBeCloseTo(3);
    const dearestInput = Math.max(...pricedModels().map((model) => priceFor(model, 1_000_000, 0)));
    expect(priceFor('a-model-from-next-year', 1_000_000, 0, 1_000_000)).toBe(dearestInput);
  });

  it('keeps guessing high for a model nobody has priced', () => {
    /*
     * The safe direction. A price list compiled into a build goes stale the
     * week after it ships, and the models this product routes to by default
     * are newer than any table anyone remembered to update — so the fallback
     * over-bills rather than under-bills, and the console says which models
     * it is guessing about.
     */
    const dearest = Math.max(...pricedModels().map((model) => priceFor(model, 1_000_000, 1_000_000)));
    expect(priceFor('a-model-from-next-year', 1_000_000, 1_000_000)).toBe(dearest);
  });
});
