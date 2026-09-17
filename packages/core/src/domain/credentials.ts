import { z } from 'zod';
import { urlString } from '../zod-helpers.ts';

/**
 * Customer-supplied product access.
 *
 * Handled as a vault secret: the plaintext never touches the database, never
 * leaves the worker, and is decrypted only inside an isolated browser session
 * scoped to one project. See @act-one/providers/security.
 */
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
  deniedPaths: z.array(z.string()).default([
    '/billing',
    '/settings/billing',
    '/admin',
    '/delete',
    '/danger',
  ]),
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
  action: z.enum(['session_open', 'navigate', 'capture', 'session_close', 'blocked']),
  detail: z.string().max(600),
  createdAt: z.string(),
});
export type CredentialAuditEvent = z.infer<typeof CredentialAuditEvent>;
