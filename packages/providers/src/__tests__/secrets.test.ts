import { describe, it, expect } from 'vitest';
import { AesSecretVault, generateVaultKey, secretContext, redact } from '../index.ts';

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
    ];
    for (const [input, leaked] of samples) {
      expect(redact(input), input).not.toMatch(leaked);
    }
  });

  it('leaves ordinary error text readable', () => {
    expect(redact('HTTP 502 Bad Gateway from upstream')).toBe('HTTP 502 Bad Gateway from upstream');
  });
});
