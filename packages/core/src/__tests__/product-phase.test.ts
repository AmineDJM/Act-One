import { describe, it, expect } from 'vitest';
import { DEFAULT_PRODUCT_CONFIG, ProductConfig, generateInviteCode, inviteCodeRefusal, normalizeInviteCode, productName, signUpPolicy, type InviteCode } from '../index.ts';

/** The phase decides the door; the mark is earned, never assumed. */
describe('signUpPolicy', () => {
  it('is by invitation in a private beta, open and honest in a public one, commercial in production', () => {
    const closed = signUpPolicy(DEFAULT_PRODUCT_CONFIG);
    expect(closed).toMatchObject({ phase: 'private_beta', open: false, requiresCode: true, applications: true, ctaLabel: 'Request access', tag: 'beta' });
    expect(closed.phaseLine).toContain('by invitation');
    const noApplications = signUpPolicy(ProductConfig.parse({ invites: { applicationsEnabled: false } }));
    expect(noApplications).toMatchObject({ applications: false, ctaLabel: 'Get invited' });
    const beta = signUpPolicy(ProductConfig.parse({ phase: 'public_beta' }));
    expect(beta).toMatchObject({ open: true, requiresCode: false, ctaLabel: 'Join the beta', tag: 'beta' });
    expect(beta.phaseLine).toContain('public beta');
    const live = signUpPolicy(ProductConfig.parse({ phase: 'production' }));
    expect(live).toMatchObject({ open: true, requiresCode: false, ctaLabel: 'Start free', phaseLine: null, tag: null });
  });
});

describe('productName', () => {
  it('shows ® only once registered, ™ while pending, nothing otherwise', () => {
    expect(productName('Act One', 'none')).toBe('Act One');
    expect(productName('Act One', 'pending')).toBe('Act One™');
    expect(productName('Act One', 'registered')).toBe('Act One®');
  });
});

describe('invitation codes', () => {
  const base: InviteCode = { id: 'inv_1', code: 'ACT-ABCD-EFGH', kind: 'invite', note: '', maxUses: 1, uses: 0, expiresAt: null, createdByUserId: null, ownerUserId: null, createdAt: '2026-01-01T00:00:00.000Z', revokedAt: null };

  it('are typed however a person types them', () => {
    expect(normalizeInviteCode('  act-abcd-efgh ')).toBe('ACT-ABCD-EFGH');
    expect(normalizeInviteCode('act abcd efgh!')).toBe('ACTABCDEFGH');
  });

  it('are made of characters nobody misreads', () => {
    let seed = 0.123;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const made = generateInviteCode(random);
    expect(made).toMatch(/^ACT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(generateInviteCode(random, 'REF')).toMatch(/^REF-/);
  });

  it('say why they cannot be used', () => {
    expect(inviteCodeRefusal(null)).toContain('not one we know');
    expect(inviteCodeRefusal({ ...base, revokedAt: '2026-02-01T00:00:00.000Z' })).toContain('withdrawn');
    expect(inviteCodeRefusal({ ...base, expiresAt: '2020-01-01T00:00:00.000Z' })).toContain('expired');
    expect(inviteCodeRefusal({ ...base, uses: 1 })).toContain('already been used');
    expect(inviteCodeRefusal({ ...base, maxUses: null, uses: 900 })).toBeNull();
    expect(inviteCodeRefusal(base)).toBeNull();
  });
});

describe('search settings', () => {
  it('start as nothing chosen, so the code decides', () => {
    const config = ProductConfig.parse({});
    expect(config.seo).toEqual({ description: '', discourageIndexing: false, googleVerification: '', bingVerification: '' });
  });

  it('survive a configuration written before they existed', () => {
    // A record stored by an earlier version has no seo block at all; reading it
    // must not throw and must not silently turn indexing off.
    const stored = { phase: 'production', landing: { headline: 'Your product. Directed.' } };
    const config = ProductConfig.parse(stored);
    expect(config.seo.discourageIndexing).toBe(false);
    expect(config.seo.description).toBe('');
    expect(config.landing.headline).toBe('Your product. Directed.');
  });

  it('keep the door itself out of it', () => {
    // Holding the site back from search says nothing about who may sign up.
    const held = ProductConfig.parse({ phase: 'production', seo: { discourageIndexing: true } });
    expect(signUpPolicy(held).open).toBe(true);
  });
});
