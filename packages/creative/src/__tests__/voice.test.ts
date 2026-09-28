import { describe, expect, it } from 'vitest';
import { settleVoice } from '../creative-director.ts';

/**
 * Every film speaks unless the customer asked it not to.
 *
 * The customer's choice outranks the director's, silence included; short of
 * one, the director chooses whose voice, and never none.
 */
describe('who speaks in the film', () => {
  it('is the customer’s choice when they made one, silence included', () => {
    expect(settleVoice('none', 'narrator')).toBe('none');
    expect(settleVoice('founder', 'narrator')).toBe('founder');
    expect(settleVoice('brand_voice', 'none')).toBe('brand_voice');
  });

  it('is the director’s voice otherwise, and the narrator when the director chose none', () => {
    expect(settleVoice(null, 'founder')).toBe('founder');
    expect(settleVoice(undefined, 'brand_voice')).toBe('brand_voice');
    expect(settleVoice(null, 'none')).toBe('narrator');
  });
});
