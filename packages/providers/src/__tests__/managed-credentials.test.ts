import { afterEach, describe, expect, it } from 'vitest';
import { canAuthenticate, credentialIsManaged, managedProviders } from '../managed-credentials.ts';
import { HiggsfieldProvider } from '../media/higgsfield.ts';
import { BrowserbaseProvider } from '../browser/browserbase.ts';

/**
 * The bridge exists so a process that holds no secrets can still make
 * authenticated calls. The thing worth protecting with tests is not that it
 * works — that is proved against the live vendors — but that it stays OFF,
 * because a provider that decides it is configured when it is not would send
 * an unauthenticated request to a vendor and report the refusal as an outage.
 */
describe('managed credentials', () => {
  const original = process.env['ACT_ONE_MANAGED_CREDENTIALS'];

  afterEach(() => {
    if (original === undefined) delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    else process.env['ACT_ONE_MANAGED_CREDENTIALS'] = original;
  });

  const set = (value: string | undefined) => {
    if (value === undefined) delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    else process.env['ACT_ONE_MANAGED_CREDENTIALS'] = value;
  };

  it('is inert when unset, which is every normal deployment', () => {
    set(undefined);
    expect(managedProviders().size).toBe(0);
    expect(credentialIsManaged('higgsfield')).toBe(false);
    expect(canAuthenticate('higgsfield', '')).toBe(false);
    expect(canAuthenticate('higgsfield', undefined)).toBe(false);
  });

  it('names one provider without speaking for the others', () => {
    set('higgsfield');
    expect(credentialIsManaged('higgsfield')).toBe(true);
    expect(credentialIsManaged('browserbase')).toBe(false);
    expect(credentialIsManaged('elevenlabs')).toBe(false);
  });

  it('accepts a list, and ignores a name this build does not know', () => {
    set('higgsfield, browserbase ,nonesuch');
    expect(credentialIsManaged('higgsfield')).toBe(true);
    expect(credentialIsManaged('browserbase')).toBe(true);
    expect(managedProviders().size).toBe(2);
  });

  it('"all" covers everything', () => {
    set('all');
    expect(credentialIsManaged('gemini')).toBe(true);
    expect(credentialIsManaged('ideogram')).toBe(true);
  });

  it('a held secret authenticates whether or not a gateway is there', () => {
    set(undefined);
    expect(canAuthenticate('runway', 'a-real-key')).toBe(true);
    set('runway');
    expect(canAuthenticate('runway', 'a-real-key')).toBe(true);
  });
});

describe('providers behind the bridge', () => {
  const original = process.env['ACT_ONE_MANAGED_CREDENTIALS'];
  afterEach(() => {
    if (original === undefined) delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    else process.env['ACT_ONE_MANAGED_CREDENTIALS'] = original;
    delete process.env['HF_CREDENTIALS'];
    delete process.env['BROWSERBASE_API_KEY'];
  });

  it('Higgsfield refuses to call with no key and no gateway', () => {
    delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    expect(new HiggsfieldProvider({}).isConfigured()).toBe(false);
  });

  it('Higgsfield will call when a gateway holds the credential', () => {
    process.env['ACT_ONE_MANAGED_CREDENTIALS'] = 'higgsfield';
    expect(new HiggsfieldProvider({}).isConfigured()).toBe(true);
  });

  it('Browserbase refuses to call with no key and no gateway', () => {
    delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    expect(new BrowserbaseProvider({}).isConfigured()).toBe(false);
  });

  it('Browserbase will call when a gateway holds the credential', () => {
    process.env['ACT_ONE_MANAGED_CREDENTIALS'] = 'browserbase';
    expect(new BrowserbaseProvider({}).isConfigured()).toBe(true);
  });

  it('a malformed local credential does not become a bad header behind a gateway', () => {
    // Higgsfield credentials are KEY_ID:KEY_SECRET. A value that is neither
    // that nor absent is a mistake somebody made. Behind a gateway the
    // provider will still call — because the gateway, not this process, is
    // writing the header — and what it must NOT do is send the malformed
    // value. The resolver drops it, so the header is omitted and the gateway
    // supplies a working one.
    process.env['ACT_ONE_MANAGED_CREDENTIALS'] = 'higgsfield';
    expect(new HiggsfieldProvider({ credentials: 'not-a-pair' }).isConfigured()).toBe(true);
    expect(new HiggsfieldProvider({ credentials: 'id:secret' }).isConfigured()).toBe(true);
  });

  it('a malformed local credential is still refused with no gateway', () => {
    delete process.env['ACT_ONE_MANAGED_CREDENTIALS'];
    expect(new HiggsfieldProvider({ credentials: 'not-a-pair' }).isConfigured()).toBe(false);
  });
});
