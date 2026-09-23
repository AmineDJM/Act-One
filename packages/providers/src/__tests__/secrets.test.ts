import { describe, it, expect } from 'vitest';
import { AesSecretVault, keyMaterialFrom, generateVaultKey, secretContext, redact } from '../index.ts';

const keyA = generateVaultKey();
const keyB = generateVaultKey();

describe('AesSecretVault', () => {
  const vault = new AesSecretVault({ k1: keyA }, 'k1');

  it('round-trips a secret within its context', () => {
    const context = secretContext.productCredential('org_1', 'prj_1');
    const sealed = vault.encrypt('hunter2', context);
    expect(sealed.ciphertext).not.toContain('hunter2');
    expect(vault.decrypt(sealed, context)).toBe('hunter2');
  });

  it('refuses to decrypt a credential moved to another tenant', () => {
    const sealed = vault.encrypt('hunter2', secretContext.productCredential('org_1', 'prj_1'));
    expect(() =>
      vault.decrypt(sealed, secretContext.productCredential('org_2', 'prj_1')),
    ).toThrowError(/could not be decrypted/i);
  });

  it('refuses to decrypt a credential moved to another project', () => {
    const sealed = vault.encrypt('hunter2', secretContext.productCredential('org_1', 'prj_1'));
    expect(() =>
      vault.decrypt(sealed, secretContext.productCredential('org_1', 'prj_2')),
    ).toThrowError(/could not be decrypted/i);
  });

  it('detects tampering with the ciphertext', () => {
    const context = secretContext.providerKey('higgsfield');
    const sealed = vault.encrypt('sk-live-abc', context);
    const tampered = { ...sealed, ciphertext: Buffer.from('forged').toString('base64') };
    expect(() => vault.decrypt(tampered, context)).toThrow();
  });

  it('keeps decrypting old rows after a key rotation', () => {
    const context = secretContext.providerKey('openai');
    const sealedWithOldKey = new AesSecretVault({ k1: keyA }, 'k1').encrypt('old-secret', context);
    const rotated = new AesSecretVault({ k1: keyA, k2: keyB }, 'k2');

    expect(rotated.decrypt(sealedWithOldKey, context)).toBe('old-secret');
    const fresh = rotated.encrypt('new-secret', context);
    expect(fresh.keyId).toBe('k2');
    expect(rotated.decrypt(fresh, context)).toBe('new-secret');
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new AesSecretVault({ bad: Buffer.from('short').toString('base64') }, 'bad')).toThrow(
      /32 bytes/,
    );
  });

  it('accepts one bare key, the way a deploy platform generates it', () => {
    // Render, Fly and friends can generate a random value for a variable; none
    // can generate JSON in our shape. The bare form must round-trip, and the
    // same string must give the web service and the worker the same key.
    const generated = 'p8Yx2mKq7LwZ4nRt9vBc1dFg6hJk3sAe5uWyEiOl0TzX';
    const web = AesSecretVault.fromEnv({ ACT_ONE_SECRET_KEYS: generated });
    const worker = AesSecretVault.fromEnv({ ACT_ONE_SECRET_KEYS: generated, ACT_ONE_SECRET_ACTIVE_KEY: 'k1' });
    const sealed = web.encrypt('sk-live-abcdef', 'org:org_1:provider');
    expect(sealed.keyId).toBe('k1');
    expect(worker.decrypt(sealed, 'org:org_1:provider')).toBe('sk-live-abcdef');
  });

  it('uses 32 bytes of base64 as they are, and hashes anything else to 32 bytes', () => {
    const exact = Buffer.alloc(32, 7).toString('base64');
    expect(keyMaterialFrom(exact)).toBe(exact);
    const hex = 'deadbeef'.repeat(8);
    expect(Buffer.from(keyMaterialFrom(hex), 'base64')).toHaveLength(32);
    expect(keyMaterialFrom(hex)).not.toBe(hex);
    expect(keyMaterialFrom(hex)).toBe(keyMaterialFrom(hex));
  });

  it('still reads a keyring, and still refuses a short key inside one', () => {
    const ring = JSON.stringify({ k1: Buffer.alloc(32, 1).toString('base64'), k2: Buffer.alloc(32, 2).toString('base64') });
    const vault = AesSecretVault.fromEnv({ ACT_ONE_SECRET_KEYS: ring, ACT_ONE_SECRET_ACTIVE_KEY: 'k2' });
    expect(vault.encrypt('x', 'ctx').keyId).toBe('k2');
    expect(() =>
      AesSecretVault.fromEnv({ ACT_ONE_SECRET_KEYS: JSON.stringify({ k1: Buffer.from('short').toString('base64') }) }),
    ).toThrow(/32 bytes/);
  });

  it('fingerprints without revealing the secret', () => {
    const fp = vault.fingerprint('sk-live-abcdef');
    expect(fp).toHaveLength(12);
    expect(fp).not.toContain('sk-live');
    expect(vault.fingerprint('sk-live-abcdef')).toBe(fp);
  });
});

describe('redact', () => {
  it('scrubs credentials that would otherwise reach a job log', () => {
    const samples: [string, RegExp][] = [
      ['{"api_key":"abcd1234efgh"}', /abcd1234efgh/],
      ['Authorization: Bearer abcdefghijklmnop', /abcdefghijklmnop/],
      ['failed with sk-proj-ABCDEFGHIJKLMNOP', /ABCDEFGHIJKLMNOP/],
      ['token=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', /SflKxwRJSMeKKF2QT4/],
      ['"password": "correct-horse"', /correct-horse/],
      ['wss://connect.browserbase.com?signingKey=sk9f8e7d6c5b4a&sessionId=s1', /sk9f8e7d6c5b4a/],
      ['wss://connect.browserbase.com?apiKey=bb_live_0123456789ab&sessionId=s1', /0123456789ab/],
    ];
    for (const [input, leaked] of samples) {
      expect(redact(input), input).not.toMatch(leaked);
    }
  });

  it('stops at the end of a query value, so the rest of an address stays readable', () => {
    expect(redact('wss://connect.browserbase.com?signingKey=abcdef123456&sessionId=sess_42')).toContain(
      'sessionId=sess_42',
    );
  });

  it('leaves ordinary error text readable', () => {
    expect(redact('HTTP 502 Bad Gateway from upstream')).toBe('HTTP 502 Bad Gateway from upstream');
  });
});
