import { describe, it, expect } from 'vitest';
import { customerFacingFailure, failureNotice } from '../index.ts';

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

/**
 * The failure system, which is mostly about not calling things failures.
 *
 * A production that is quietly remaking a shot must never be described as
 * broken, an account problem must never be described as a production problem,
 * and no notice may ever name a provider, a status code or a stack.
 */
describe('failureNotice', () => {
  it('treats work in progress as work, not as an error', () => {
    const rebuilding = failureNotice({ retryScheduled: true, code: 'timeout', rawError: 'ETIMEDOUT' });
    expect(rebuilding).toMatchObject({ kind: 'rebuilding', tone: 'working', title: 'Rebuilding this shot' });
    expect(rebuilding.action).toBeNull();

    const refining = failureNotice({ refining: true });
    expect(refining).toMatchObject({ kind: 'refining', tone: 'working', title: 'Refining this shot' });
    expect(refining.action).toBeNull();
  });

  it('puts work in progress ahead of every other reading', () => {
    // A shot being refined while a provider is also unhappy is still a shot
    // being refined. Saying "interrupted" over a production that is running
    // is the worst thing this page can do.
    const both = failureNotice({ refining: true, retryScheduled: true, code: 'provider_unavailable', phase: 'production' });
    expect(both.kind).toBe('refining');
  });

  it('names what stopped by the phase it interrupted', () => {
    expect(failureNotice({ phase: 'discovery' })).toMatchObject({ kind: 'discovery_paused', title: 'Discovery paused' });
    expect(failureNotice({ phase: 'direction' })).toMatchObject({ kind: 'production_interrupted' });
    expect(failureNotice({ phase: 'storyboard' })).toMatchObject({ kind: 'production_interrupted' });
    expect(failureNotice({ phase: 'production' })).toMatchObject({ kind: 'master_not_completed', title: 'Master not completed' });
    expect(failureNotice({ phase: 'mastering' })).toMatchObject({ kind: 'master_not_completed' });
    expect(failureNotice({ phase: null, hadRender: true })).toMatchObject({ kind: 'master_not_completed' });
  });

  it('separates somebody else being down from something being broken', () => {
    // Gentle words, but somebody still has to press something: by the time
    // this shows, the automatic attempts are spent.
    expect(failureNotice({ code: 'provider_unavailable', phase: 'production' })).toMatchObject({
      kind: 'production_paused',
      tone: 'attention',
      action: { action: 'resume', label: 'Resume production' },
    });
    expect(failureNotice({ code: 'rate_limited' }).kind).toBe('production_paused');
    expect(failureNotice({ code: 'validation_failed', phase: 'direction' }).kind).toBe('production_interrupted');
  });

  it('keeps the account out of the production', () => {
    const notice = failureNotice({ code: 'entitlement_required', phase: 'production', hadRender: true });
    expect(notice).toMatchObject({ kind: 'payment_attention', title: 'Payment requires attention' });
    expect(notice.action).toEqual({ action: 'billing', label: 'Review payment' });
  });

  it('promises the work is safe, and offers a way on', () => {
    for (const phase of ['discovery', 'direction', 'storyboard', 'production', 'mastering'] as const) {
      const notice = failureNotice({ phase });
      expect(notice.action).not.toBeNull();
      expect(notice.body.length).toBeGreaterThan(40);
    }
    expect(failureNotice({ phase: 'direction' }).body).toMatch(/your work is safe/i);
  });

  it('never names infrastructure, whatever it is handed', () => {
    const raws = [
      'OpenAI returned 429',
      'ECONNRESET',
      'TypeError: cannot read properties of undefined',
      '{"error":{"status":500}}',
    ];
    for (const rawError of raws) {
      for (const code of ['provider_unavailable', 'validation_failed', 'entitlement_required', null]) {
        const notice = failureNotice({ code, rawError, phase: 'production' });
        const text = `${notice.title} ${notice.body} ${notice.detail ?? ''} ${notice.action?.label ?? ''}`;
        expect(text).not.toMatch(/openai|browserbase|higgsfield|elevenlabs|stripe|econn|typeerror|\b\d{3}\b|json|api/i);
      }
    }
  });

  it('passes through the one sentence written for the customer', () => {
    const notice = failureNotice({ phase: 'discovery', rawError: 'We could not read anything at that address.' });
    expect(notice.detail).toBe('We could not read anything at that address.');
  });
});
