import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { AppError } from '@act-one/core';

/**
 * Envelope encryption for anything we must be able to read back: provider API
 * keys configured in Super Admin, and customer product credentials.
 *
 * Design notes:
 *  - AES-256-GCM. The auth tag means a tampered ciphertext fails loudly rather
 *    than decrypting to garbage.
 *  - The key id is stored alongside the ciphertext so keys can be rotated
 *    without a migration: old rows keep decrypting with the old key.
 *  - Each ciphertext is bound to a context string (e.g. "org:org_x:product")
 *    as AAD, so a credential row copied between tenants will not decrypt.
 *    That last property is what makes cross-tenant credential reuse a hard
 *    failure rather than a policy we hope holds.
 */
export type EncryptedSecret = {
  v: 1;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export interface SecretVault {
  encrypt(plaintext: string, context: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, context: string): string;
  /** Stable, non-reversible fingerprint, safe to show in an admin UI. */
  fingerprint(plaintext: string): string;
}

export class AesSecretVault implements SecretVault {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;

  constructor(keys: Record<string, string>, activeKeyId: string) {
    if (!keys[activeKeyId]) {
      throw new AppError('internal', `Active secret key "${activeKeyId}" is not configured.`);
    }
    this.keys = new Map(
      Object.entries(keys).map(([id, value]) => [id, normalizeKey(id, value)]),
    );
    this.activeKeyId = activeKeyId;
  }

  /**
   * Reads keys from the environment. Two forms:
   *
   *   ACT_ONE_SECRET_KEYS='{"k1":"<base64-32-bytes>"}'   a keyring, for rotation
   *   ACT_ONE_SECRET_KEYS='<any secret string>'          one key, as a host generates it
   *   ACT_ONE_SECRET_ACTIVE_KEY=k1
   *
   * The second form is what lets a deploy be automatic: a platform that can
   * generate a random value for a variable cannot be asked to generate JSON
   * in our shape. A bare value becomes key "k1" (or the active id). Material
   * that is not 32 bytes of base64 is stretched to 32 bytes with SHA-256, so
   * whatever the host produced is a usable AES-256 key — and the same string
   * on the web service and the worker yields the same key, which is the one
   * thing that has to hold.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): AesSecretVault {
    const raw = env.ACT_ONE_SECRET_KEYS?.trim();
    if (!raw) {
      throw new AppError(
        'internal',
        'ACT_ONE_SECRET_KEYS is not set. Refusing to handle secrets without a vault key.',
      );
    }
    if (!raw.startsWith('{')) {
      const active = env.ACT_ONE_SECRET_ACTIVE_KEY?.trim() || 'k1';
      return new AesSecretVault({ [active]: keyMaterialFrom(raw) }, active);
    }
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new AppError('internal', 'ACT_ONE_SECRET_KEYS is not valid JSON.');
    }
    const active = env.ACT_ONE_SECRET_ACTIVE_KEY ?? Object.keys(parsed)[0];
    if (!active) throw new AppError('internal', 'ACT_ONE_SECRET_KEYS is empty.');
    return new AesSecretVault(parsed, active);
  }

  encrypt(plaintext: string, context: string): EncryptedSecret {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      v: 1,
      keyId: this.activeKeyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret, context: string): string {
    const key = this.keys.get(secret.keyId);
    if (!key) {
      throw new AppError('internal', `Secret was encrypted with unknown key "${secret.keyId}".`);
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.iv, 'base64'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(secret.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (cause) {
      // Wrong context (i.e. wrong tenant) lands here, and must not be
      // distinguishable from corruption.
      throw new AppError('forbidden', 'Secret could not be decrypted in this context.', { cause });
    }
  }

  fingerprint(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex').slice(0, 12);
  }
}

function normalizeKey(id: string, value: string): Buffer {
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== 32) {
    throw new AppError(
      'internal',
      `Secret key "${id}" must be 32 bytes base64-encoded (got ${buf.length}).`,
    );
  }
  return buf;
}

/** Context strings. Centralised so a typo cannot silently widen access. */
export const secretContext = {
  productCredential: (organizationId: string, projectId: string) =>
    `org:${organizationId}:project:${projectId}:product-credential`,
  providerKey: (provider: string) => `platform:provider:${provider}`,
};

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generates a fresh vault key for operators bootstrapping an environment. */
export function generateVaultKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * 32 bytes of key, base64, from whatever a host handed us.
 *
 * Exactly 32 bytes of base64 is used as it is. Anything else — a hex string,
 * a UUID, a longer random token — is hashed to 32 bytes. Hashing is not
 * key stretching against a weak input; the input is expected to be random
 * already. It is shape conversion, so that "generate a random value" on a
 * deploy platform is enough.
 */
export function keyMaterialFrom(value: string): string {
  const decoded = Buffer.from(value, 'base64');
  // Canonical base64 of exactly 32 bytes round-trips to itself.
  if (decoded.length === 32 && decoded.toString('base64') === value) return value;
  return createHash('sha256').update(value, 'utf8').digest('base64');
}
