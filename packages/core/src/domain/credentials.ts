import { z } from 'zod';
import { urlString } from '../zod-helpers.ts';

/**
 * Customer-supplied product access.
 *
 * Handled as a vault secret: the plaintext never touches the database, never
 * leaves the worker, and is decrypted only inside an isolated browser session
 * scoped to one project. See @act-one/providers/security.
 */
/**
 * Never visited, whatever a customer types in the allowed list.
 *
 * Somebody authorising us to film their product is authorising a tour, not a
 * session on their billing page. These are re-added after whatever they
 * configure, so the list can be widened and not narrowed.
 */
export const DEFAULT_DENIED_PATHS: readonly string[] = [
  '/billing',
  '/settings/billing',
  '/admin',
  '/delete',
  '/danger',
];

export const ProductCredentialKind = z.enum([
  'password',
  'magic_link',
  'shared_demo_url',
  'api_token',
]);
export type ProductCredentialKind = z.infer<typeof ProductCredentialKind>;

export const ProductCredential = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  kind: ProductCredentialKind,
  loginUrl: urlString,
  username: z.string().max(320).nullable().default(null),
  /** Ciphertext reference only. Never the secret itself. */
  secretRef: z.string(),
  /** The customer's explicit, recorded authorisation to sign in. */
  authorizedByUserId: z.string(),
  authorizedAt: z.string(),
  /** Paths the agent is allowed to visit. Empty = whole app, read-only posture. */
  allowedPaths: z.array(z.string()).default([]),
  /** Paths the agent must never visit (billing, admin, destructive actions). */
  deniedPaths: z.array(z.string()).default([...DEFAULT_DENIED_PATHS]),
  revokedAt: z.string().nullable().default(null),
  lastUsedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type ProductCredential = z.infer<typeof ProductCredential>;

export function credentialIsUsable(credential: ProductCredential): boolean {
  return credential.revokedAt === null;
}

/** Audit entry for every authenticated action the agent takes. */
export const CredentialAuditEvent = z.object({
  id: z.string(),
  credentialId: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  /*
   * `authorized` and `revoked` are the customer's own acts; the rest are ours.
   * Keeping both in one trail means the answer to "who let us in, and what did
   * we do with it" is a single query rather than a join across two stories.
   */
  action: z.enum([
    'authorized',
    'revoked',
    'session_open',
    'navigate',
    'capture',
    'session_close',
    'blocked',
  ]),
  detail: z.string().max(600),
  createdAt: z.string(),
});
export type CredentialAuditEvent = z.infer<typeof CredentialAuditEvent>;

/**
 * Whether a login page belongs to the product we were asked to film.
 *
 * Act One drives a real browser with credentials somebody typed in. Without
 * this, that browser is an open proxy for signing into anything: a customer
 * could point it at a bank, or at a competitor, and have us hold the session.
 * The login page must be the product's own host or a subdomain of it, which
 * covers the ordinary `app.` and `login.` cases without opening it up.
 *
 * Deliberately not a blocklist. Enumerating every site nobody may sign into is
 * a game you lose; naming the one site this project is about is not.
 */
export function loginUrlBelongsToProduct(loginUrl: string, productUrl: string): boolean {
  let login: URL;
  let product: URL;
  try {
    login = new URL(loginUrl);
    product = new URL(productUrl);
  } catch {
    return false;
  }

  // Credentials only ever travel over TLS, whatever the product's own site does.
  if (login.protocol !== 'https:') return false;

  const site = bareHost(product.hostname);
  const target = bareHost(login.hostname);
  if (site.length === 0 || target.length === 0) return false;

  // The same host, or a subdomain of it. The leading dot is what stops
  // `notexample.com` passing as a subdomain of `example.com`.
  return target === site || target.endsWith(`.${site}`);
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}
