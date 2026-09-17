import { describe, it, expect } from 'vitest';
import { plainText } from '../domain/operations.ts';

describe('plainText', () => {
  it('strips the ANSI colour codes a library error carries', () => {
    // Playwright writes for a terminal. Unstripped, this rendered as "[2m" in
    // the middle of a sentence in the customer's audit trail.
    const raw = 'navigating to \u001b[2m"https://app.example.com"\u001b[22m until load';
    expect(plainText(raw)).toBe('navigating to "https://app.example.com" until load');
  });

  it('strips control characters that would break a layout', () => {
    expect(plainText('before\u0000\u0007after')).toBe('beforeafter');
  });

  it('keeps newlines, which carry meaning in a stack trace', () => {
    expect(plainText('line one\nline two')).toBe('line one\nline two');
  });

  it('collapses runs of spaces and tabs', () => {
    expect(plainText('a \t  b')).toBe('a b');
  });

  it('leaves ordinary text alone', () => {
    expect(plainText('Signed in at https://app.example.com/login')).toBe(
      'Signed in at https://app.example.com/login',
    );
  });
});
