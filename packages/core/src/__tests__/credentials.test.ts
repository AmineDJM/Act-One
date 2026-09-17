import { describe, it, expect } from 'vitest';
import { loginUrlBelongsToProduct } from '../domain/credentials.ts';

describe('loginUrlBelongsToProduct', () => {
  const product = 'https://example.com/';

  it('accepts the product site itself', () => {
    expect(loginUrlBelongsToProduct('https://example.com/login', product)).toBe(true);
  });

  it('accepts the ordinary app and login subdomains', () => {
    expect(loginUrlBelongsToProduct('https://app.example.com/signin', product)).toBe(true);
    expect(loginUrlBelongsToProduct('https://login.example.com/', product)).toBe(true);
    expect(loginUrlBelongsToProduct('https://eu.app.example.com/', product)).toBe(true);
  });

  it('ignores www on either side', () => {
    expect(loginUrlBelongsToProduct('https://app.example.com/', 'https://www.example.com/')).toBe(true);
    expect(loginUrlBelongsToProduct('https://www.example.com/login', product)).toBe(true);
  });

  it('refuses a different site', () => {
    // Without this the product is an open proxy for signing into anything: a
    // customer could point it at a bank and have us hold the session.
    expect(loginUrlBelongsToProduct('https://mybank.example.org/login', product)).toBe(false);
  });

  it('refuses a lookalike that merely ends with the product name', () => {
    expect(loginUrlBelongsToProduct('https://notexample.com/login', product)).toBe(false);
    expect(loginUrlBelongsToProduct('https://example.com.evil.test/login', product)).toBe(false);
  });

  it('refuses plaintext http even on the right host', () => {
    expect(loginUrlBelongsToProduct('http://app.example.com/login', product)).toBe(false);
  });

  it('refuses anything that is not a URL', () => {
    expect(loginUrlBelongsToProduct('app.example.com', product)).toBe(false);
    expect(loginUrlBelongsToProduct('', product)).toBe(false);
    expect(loginUrlBelongsToProduct('https://app.example.com/', 'not a url')).toBe(false);
  });

  it('refuses a javascript: or data: URL that happens to mention the host', () => {
    expect(loginUrlBelongsToProduct('javascript:fetch("//example.com")', product)).toBe(false);
    expect(loginUrlBelongsToProduct('data:text/html,example.com', product)).toBe(false);
  });
});
