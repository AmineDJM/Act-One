import { describe, it, expect } from 'vitest';
import {
  checkNavigation,
  checkInteraction,
  policyForPublicResearch,
  policyForAuthenticatedProduct,
  registrableDomain,
  isPrivateAddress,
} from '../index.ts';

describe('public research policy', () => {
  const policy = policyForPublicResearch(['https://acme.com']);

  it('allows the seed origin and related subdomains', () => {
    expect(checkNavigation(policy, 'https://acme.com/pricing').allowed).toBe(true);
    expect(checkNavigation(policy, 'https://docs.acme.com/getting-started').allowed).toBe(true);
    expect(checkNavigation(policy, 'https://blog.acme.com/launch').allowed).toBe(true);
  });

  it('refuses unrelated origins', () => {
    const verdict = checkNavigation(policy, 'https://competitor.io/pricing');
    expect(verdict.allowed).toBe(false);
  });

  it('blocks link-local and internal hosts regardless of the page that linked them', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/admin',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/',
      'https://vault.internal/secrets',
    ]) {
      const verdict = checkNavigation(policy, url);
      expect(verdict.allowed, url).toBe(false);
    }
  });

  it('blocks every spelling of this machine and this network', () => {
    // The guard blocked 127.0.0.1 by name and nothing else in 127/8. A URL
    // parser accepts far more than dotted decimal, and so does Chromium.
    for (const url of [
      'http://127.0.0.2/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://100.64.0.1/',
      'http://app.localhost/',
      'http://printer.home.arpa/',
    ]) {
      const verdict = checkNavigation(policy, url);
      expect(verdict.allowed, url).toBe(false);
    }
  });

  it('still allows the public internet', () => {
    // A guard that also refuses real customers is a different bug.
    for (const host of ['8.8.8.8', '104.18.2.1', '[2606:4700::6812:201]']) {
      expect(isPrivateAddress(host), host).toBe(false);
    }
  });

  it('refuses billing and admin paths even on an allowed origin', () => {
    expect(checkNavigation(policy, 'https://acme.com/billing').allowed).toBe(false);
    expect(checkNavigation(policy, 'https://acme.com/settings/security').allowed).toBe(false);
  });
});

describe('authenticated product policy', () => {
  const policy = policyForAuthenticatedProduct({
    loginUrl: 'https://app.acme.com/login',
    allowedPaths: ['/dashboard', '/agents', '/analytics'],
    deniedPaths: ['/workspace/destroy'],
  });

  it('confines the session to the authorised origin', () => {
    expect(checkNavigation(policy, 'https://app.acme.com/dashboard').allowed).toBe(true);
    // Related-domain leniency must NOT apply once we hold credentials.
    expect(checkNavigation(policy, 'https://acme.com/pricing').allowed).toBe(false);
    expect(checkNavigation(policy, 'https://evil.example/collect').allowed).toBe(false);
  });

  it('always admits the sign-in page, whatever paths were authorised', () => {
    // "/app" describes the product, not the door to it.
    const scoped = policyForAuthenticatedProduct({
      loginUrl: 'https://app.acme.com/login',
      allowedPaths: ['/app'],
      deniedPaths: [],
    });
    expect(checkNavigation(scoped, 'https://app.acme.com/login').allowed).toBe(true);
    expect(checkNavigation(scoped, 'https://app.acme.com/app/issues').allowed).toBe(true);
    expect(checkNavigation(scoped, 'https://app.acme.com/marketing').allowed).toBe(false);
  });

  it('confines the session to the authorised paths', () => {
    expect(checkNavigation(policy, 'https://app.acme.com/analytics/usage').allowed).toBe(true);
    expect(checkNavigation(policy, 'https://app.acme.com/team/members').allowed).toBe(false);
  });

  it('honours caller-supplied denials on top of the defaults', () => {
    expect(checkNavigation(policy, 'https://app.acme.com/workspace/destroy').allowed).toBe(false);
  });

  it('refuses destructive interactions inside a customer product', () => {
    const destructive = [
      { type: 'click' as const, selector: 'button', description: 'Delete workspace' },
      { type: 'click' as const, selector: '#cancel-subscription' },
      { type: 'click' as const, selector: '.btn', description: 'Invite teammate' },
      { type: 'click' as const, selector: '#upgrade-plan' },
      { type: 'click' as const, selector: 'a', description: 'Sign out' },
      { type: 'click' as const, selector: '[data-test=deploy]' },
    ];
    for (const step of destructive) {
      const verdict = checkInteraction(policy, step);
      expect(verdict.allowed, JSON.stringify(step)).toBe(false);
    }
  });

  it('permits the read-only exploration a film actually needs', () => {
    const safe = [
      { type: 'click' as const, selector: '[data-test=open-analytics]', description: 'Open analytics tab' },
      { type: 'hover' as const, selector: '.chart-bar' },
      { type: 'scroll' as const, y: 800 },
      { type: 'wait' as const, ms: 500 },
      { type: 'type' as const, selector: '#search', text: 'revenue' },
    ];
    for (const step of safe) {
      expect(checkInteraction(policy, step).allowed, JSON.stringify(step)).toBe(true);
    }
  });
});

describe('registrableDomain', () => {
  it('handles two-part public suffixes', () => {
    expect(registrableDomain('www.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('docs.acme.com')).toBe('acme.com');
    expect(registrableDomain('acme.com')).toBe('acme.com');
  });
});
