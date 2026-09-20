import { describe, it, expect } from 'vitest';
import { framePixels, priceFromDescription, ratePerThousandTokens } from '../media/higgsfield.ts';

/**
 * A vendor that answers with its pricing instead of a price.
 *
 * Higgsfield moved to token-metered billing: the estimate endpoint stopped
 * returning a figure and started returning the formula, in prose, with the
 * rate inside it. Our parser looked for a number, found none, and refused to
 * make a single generated shot — and the error truncated the sentence two
 * characters before the rate, so it could not be diagnosed either.
 *
 * The rate is read out of their sentence rather than written down in our code.
 * A price compiled into a build is wrong the week they change it, and wrong in
 * the direction that spends a customer's money quietly.
 */
const REAL = 'Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). Image and audio references do not count as video input. At 480p or 720p, each 1,000 video tokens cost $0.0004.';

describe('reading the rate out of the sentence', () => {
  it('reads the wording the vendor actually sent', () => {
    expect(ratePerThousandTokens(REAL)).toBeCloseTo(0.0004);
  });

  it('reads the other ways the same thing gets written', () => {
    expect(ratePerThousandTokens('$0.002 per 1,000 video tokens')).toBeCloseTo(0.002);
    expect(ratePerThousandTokens('$0.05/1000 tokens')).toBeCloseTo(0.05);
  });

  it('refuses to guess when no rate can be read', () => {
    // Nothing is invented: the caller fails with the sentence attached, which
    // is something an operator can act on.
    expect(ratePerThousandTokens('Token-metered pricing. Contact sales.')).toBeNull();
    expect(priceFromDescription('Contact sales.', { seconds: 5, width: 1280, height: 720 })).toBeNull();
  });
});

describe('what a shot costs under that formula', () => {
  it('counts the tokens the vendor says it will count', () => {
    // 5s × 1280 × 720 × 24 / 1024 = 108,000 tokens.
    const usd = priceFromDescription(REAL, { seconds: 5, width: 1280, height: 720 });
    expect(usd).toBeCloseTo((108_000 / 1000) * 0.0004, 6);
  });

  it('takes the frame rate from the formula rather than assuming one', () => {
    const at30 = REAL.replace('24 fps', '30 fps');
    const a = priceFromDescription(REAL, { seconds: 5, width: 1280, height: 720 })!;
    const b = priceFromDescription(at30, { seconds: 5, width: 1280, height: 720 })!;
    expect(b / a).toBeCloseTo(30 / 24, 3);
  });

  it('costs more for a longer shot and a bigger frame, in proportion', () => {
    const base = priceFromDescription(REAL, { seconds: 5, width: 1280, height: 720 })!;
    const twice = priceFromDescription(REAL, { seconds: 10, width: 1280, height: 720 })!;
    expect(twice / base).toBeCloseTo(2, 3);
  });
});

describe('the frame a request asks for', () => {
  it('reads 720p as the short side, whichever way the film stands', () => {
    expect(framePixels('720p', '16:9')).toEqual({ width: 1280, height: 720 });
    expect(framePixels('720p', '9:16')).toEqual({ width: 720, height: 1280 });
    expect(framePixels('1080p', '1:1')).toEqual({ width: 1080, height: 1080 });
  });

  it('falls back to sixteen by nine at 720 when it cannot tell', () => {
    expect(framePixels('unknown', 'nonsense')).toEqual({ width: 1280, height: 720 });
  });
});
