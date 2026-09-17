import 'server-only';
import {
  AppError,
  DEFAULT_DENIED_PATHS,
  ProductCredentialKind,
  can,
  loginUrlBelongsToProduct,
  newId,
  type CredentialAuditEvent,
  type ProductCredential,
} from '@act-one/core';
import { secretContext } from '@act-one/providers';
import type { Session } from './auth.ts';
import { getStore } from './store.ts';
import { getVault } from './platform.ts';

export type AuthorizeInput = {
  projectId: string;
  kind: ProductCredentialKind;
  loginUrl: string;
  username: string;
  secret: string;
  allowedPaths: string[];
  deniedPaths: string[];
  /** The box they had to tick. Not a formality: it is the authorisation. */
  confirmed: boolean;
};

/**
 * Records a customer's authorisation to sign into their own product.
 *
 * This is the most dangerous thing the product does — it drives a real browser,
 * signed in as somebody, inside software they run their business on. Four rules
 * hold it in place, and none of them are configurable.
 *
 * The secret never lands in our database. It is sealed with the vault and bound
 * as AAD to this organisation and this project, so a row copied to another
 * tenant cannot be opened even by somebody holding the key. It is never sent
 * back to a browser, not even to the person who typed it.
 *
 * The login page must belong to the product. Otherwise this is an open proxy
 * for signing into anything with our IP address and our browser.
 *
 * Billing, admin and anything that reads as destructive are denied by default
 * and cannot be removed by widening the allowed list.
 *
 * And it is written down. Authorising, revoking, every page opened and every
 * frame captured lands in one audit trail the customer can read.
 */
export async function authorizeProductAccess(
  session: Session,
  input: AuthorizeInput,
): Promise<ProductCredential> {
  if (!can(session.actor, 'credentials:manage')) {
    throw new AppError('forbidden', 'Your role cannot connect a product.');
  }
  if (!input.confirmed) {
    throw new AppError('validation_failed', 'Confirm that you authorise us to sign in.');
  }

  const store = getStore();
  const project = await store.projects.get(session.organizationId, input.projectId);
  if (!project) throw new AppError('not_found', 'Project not found.');

  const loginUrl = input.loginUrl.trim();
  if (!loginUrlBelongsToProduct(loginUrl, project.websiteUrl)) {
    throw new AppError(
      'unsafe_operation',
      `That sign-in page is not part of ${safeHost(project.websiteUrl)}. We only sign into the product this project is about.`,
    );
  }
  if (!input.secret.trim()) {
    throw new AppError('validation_failed', 'We need the password or token to sign in with.');
  }

  // Anything already authorised for this project is replaced, not accumulated.
  const existing = await store.credentials.getForProject(session.organizationId, project.id);
  if (existing && !existing.revokedAt) {
    await store.credentials.revoke(session.organizationId, existing.id);
    await writeAudit(existing, 'revoked', 'Replaced by a new authorisation.');
  }

  const id = newId('sec');
  const sealed = getVault().encrypt(
    JSON.stringify({ username: input.username.trim(), secret: input.secret }),
    secretContext.productCredential(session.organizationId, project.id),
  );

  const credential: ProductCredential = {
    id,
    organizationId: session.organizationId,
    projectId: project.id,
    kind: input.kind,
    loginUrl,
    username: input.username.trim() || null,
    secretRef: id,
    authorizedByUserId: session.user.id,
    authorizedAt: new Date().toISOString(),
    allowedPaths: cleanPaths(input.allowedPaths),
    // The defaults are added back after whatever they typed, so widening the
    // denied list is possible and narrowing it is not.
    deniedPaths: [...new Set([...cleanPaths(input.deniedPaths), ...DEFAULT_DENIED_PATHS])],
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  const created = await store.credentials.create(credential, sealed);
  await store.projects.update(session.organizationId, project.id, { productCredentialId: created.id });
  await writeAudit(created, 'authorized', `${session.user.email} authorised sign-in at ${loginUrl}.`);

  return created;
}

/** Withdraws the authorisation. The stored envelope goes with it. */
export async function revokeProductAccess(session: Session, projectId: string): Promise<void> {
  if (!can(session.actor, 'credentials:manage')) {
    throw new AppError('forbidden', 'Your role cannot disconnect a product.');
  }

  const store = getStore();
  const credential = await store.credentials.getForProject(session.organizationId, projectId);
  if (!credential || credential.revokedAt) return;

  await store.credentials.revoke(session.organizationId, credential.id);
  await store.projects.update(session.organizationId, projectId, { productCredentialId: null });
  await writeAudit(credential, 'revoked', `${session.user.email} withdrew access.`);
}

/** What the customer is shown: the authorisation, never the secret. */
export async function loadProductAccess(
  session: Session,
  projectId: string,
): Promise<{ credential: ProductCredential | null; audit: CredentialAuditEvent[] }> {
  const store = getStore();
  const credential = await store.credentials.getForProject(session.organizationId, projectId);
  if (!credential || credential.revokedAt) return { credential: null, audit: [] };

  const audit = await store.credentials.listAudit(session.organizationId, credential.id);
  return { credential, audit };
}

async function writeAudit(
  credential: ProductCredential,
  action: CredentialAuditEvent['action'],
  detail: string,
): Promise<void> {
  await getStore().credentials.audit({
    id: newId('evt'),
    credentialId: credential.id,
    organizationId: credential.organizationId,
    projectId: credential.projectId,
    action,
    detail: detail.slice(0, 600),
    createdAt: new Date().toISOString(),
  });
}

/** Normalises a typed path list into leading-slash paths, dropping blanks. */
function cleanPaths(paths: string[]): string[] {
  return paths
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => (path.startsWith('/') ? path : `/${path}`))
    .slice(0, 40);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'your product';
  }
}
