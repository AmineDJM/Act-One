import { describe, it, expect } from 'vitest';
import { rememberAddress } from '../domain/addresses.ts';

/**
 * A page that moves takes its old addresses with it, because the links people
 * made to it are not ours to break.
 */
describe('remembering an address', () => {
  it('keeps the address being left behind, most recent first', () => {
    expect(rememberAddress([], 'first-title', 'second-title')).toEqual(['first-title']);
    expect(rememberAddress(['first-title'], 'second-title', 'third-title')).toEqual(['second-title', 'first-title']);
  });

  it('never remembers the address the page now holds', () => {
    // Moving back to an address it used to have: that one is current again.
    expect(rememberAddress(['first-title'], 'second-title', 'first-title')).toEqual(['second-title']);
    expect(rememberAddress(['a', 'b'], 'b', 'b')).toEqual(['a']);
  });

  it('records nothing when the address has not changed', () => {
    expect(rememberAddress(['a'], 'same', 'same')).toEqual(['a']);
  });

  it('holds no duplicates', () => {
    expect(rememberAddress(['a', 'b'], 'a', 'c')).toEqual(['a', 'b']);
  });

  it('forgets the oldest once the history is full', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `old-${index}`);
    const next = rememberAddress(twenty, 'the-latest', 'brand-new');
    expect(next).toHaveLength(20);
    expect(next[0]).toBe('the-latest');
    expect(next).not.toContain('old-19');
    expect(next).toContain('old-18');
  });
});
