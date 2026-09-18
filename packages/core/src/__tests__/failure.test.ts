import { describe, it, expect } from 'vitest';
import { customerFacingFailure } from '../index.ts';

/** A customer reads sentences written for them; everything else stays in the console. */
describe('customerFacingFailure', () => {
  it('passes a sentence the pipeline wrote for the customer', () => {
    expect(customerFacingFailure('We could not read anything at that address.')).toBe('We could not read anything at that address.');
    expect(customerFacingFailure('The address does not answer')).toBe('The address does not answer.');
  });

  it('keeps infrastructure out of the product', () => {
    expect(customerFacingFailure('[ { "code": "custom", "message": "Not a usable URL: data:image/svg+xml" } ]')).toBeNull();
    expect(customerFacingFailure('Error: Error loading image with src https://x.example/a.png')).toBeNull();
    expect(customerFacingFailure('OpenAI returned 429')).toBeNull();
    expect(customerFacingFailure('ECONNRESET')).toBeNull();
    expect(customerFacingFailure('Browserbase session expired')).toBeNull();
    expect(customerFacingFailure('TypeError: cannot read properties of undefined')).toBeNull();
    expect(customerFacingFailure('')).toBeNull();
    expect(customerFacingFailure(null)).toBeNull();
    expect(customerFacingFailure('x'.repeat(300))).toBeNull();
  });
});
