import 'server-only';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AppError,
  newId,
  slugify,
  unauthorized,
  type ActorContext,
  type MemberRole,
  type User,
} from '@act-one/core';
import { getStore } from './store.ts';
import { clientAddress, enforceAttempt } from './rate-limit.ts';

/**
 * promisify() picks scrypt's no-options overload, which silently drops the cost
 * parameters — so the hash would be computed at Node's defaults rather than the
 * ones below. Wrapped by hand to keep them.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const SESSION_COOKIE = 'act_one_session';
const SESSION_TTL_DAYS = 30;

/**
 * Password hashing.
 *
 * scrypt from Node's own crypto rather than a native bcrypt/argon2 binding:
 * one less compiled dependency to break on a deploy, and scrypt is memory-hard,
 * which is the property that matters against GPU cracking. Parameters are the
 * Node defaults raised to a cost that takes ~100ms on server hardware.
 */
const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  /**
   * Node's scrypt defaults maxmem to 32 MiB, and N=32768 with r=8 needs
   * 128 * N * r = exactly 32 MiB plus overhead — so it throws, and nobody can
   * create an account. The failure is a generic internal error, which is why
   * it survived a typecheck and a test suite and only appeared when a browser
   * actually submitted the form.
   */
  maxmem: 96 * 1024 * 1024,
} as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Still do the work. Returning early for a non-existent account turns login
    // timing into a user-enumeration oracle.
    await scrypt(password, randomBytes(16), SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return false;
  }

  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

  const derived = await scrypt(
    password,
    Buffer.from(saltB64, 'base64'),
    Buffer.from(hashB64, 'base64').length,
    // Cost parameters come from the stored hash, so an old hash keeps
    // verifying after the active parameters change.
    { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_PARAMS.maxmem },
  );

  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/**
 * Sessions and invitations are stored as a hash, so a leaked database does not
 * grant access. Exported because an invitation is the same kind of bearer
 * credential, valid for days rather than the length of a visit.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A bearer token with 256 bits of entropy, safe in a URL. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();

  await getStore().sessions.create({
    id: newId('sec'),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getStore().sessions.delete(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const store = getStore();
  const session = await store.sessions.findByTokenHash(hashToken(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await store.sessions.delete(hashToken(token));
    return null;
  }

  return store.users.get(session.userId);
}

export type Session = {
  user: User;
  actor: ActorContext;
  organizationId: string;
  role: MemberRole;
};

/**
 * Resolves the caller and the organisation they are acting in.
 *
 * Everything downstream takes organizationId from here and never from a request
 * parameter — an org id supplied by the client is a tenant-escape waiting to
 * happen.
 */
export async function getSession(): Promise<Session | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const store = getStore();
  const memberships = await store.memberships.listForUser(user.id);
  if (memberships.length === 0) return null;

  /*
   * The session names the workspace it is in, and that name is only ever
   * honoured if it still matches a live membership — so a session pointing at a
   * workspace somebody has been removed from falls back rather than granting
   * access to it.
   *
   * Falling back to the first membership is what this used to do
   * unconditionally, which meant accepting an invitation put somebody in a
   * workspace they could then never see.
   */
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const chosen = token
    ? (await store.sessions.findByTokenHash(hashToken(token)))?.organizationId ?? null
    : null;

  const membership =
    memberships.find((candidate) => candidate.organizationId === chosen) ?? memberships[0]!;

  return {
    user,
    organizationId: membership.organizationId,
    role: membership.role,
    actor: { user, organizationId: membership.organizationId, role: membership.role },
  };
}

/**
 * Moves the current session into another workspace.
 *
 * Refuses a workspace the caller does not belong to: this is the one place an
 * organisation id arrives from outside, so it is the one place that has to
 * check.
 */
export async function switchWorkspace(organizationId: string): Promise<boolean> {
  const user = await getCurrentUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!user || !token) return false;

  const store = getStore();
  const memberships = await store.memberships.listForUser(user.id);
  if (!memberships.some((membership) => membership.organizationId === organizationId)) return false;

  await store.sessions.setOrganization(hashToken(token), organizationId);
  return true;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session;
}

/**
 * The session, for a page.
 *
 * A layout's redirect does not protect the page beneath it: Next renders both
 * at once, so a signed-out visitor to /app/settings had the page throw a 401
 * before the layout could send them anywhere, and saw an error screen instead
 * of a sign-in form. Pages redirect; actions and route handlers throw, which is
 * the right answer for a caller that is not a browser following a link.
 */
export async function requireSessionForPage(returnTo: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent(returnTo)}`);
  return session;
}

/** Staff-only. Checked against the database flag, never against a cookie. */
export async function requireSuperAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (!user.isSuperAdmin) {
    // Deliberately not-found rather than forbidden: the console's existence is
    // not something an ordinary customer needs confirmed.
    throw new AppError('not_found', 'Not found.');
  }
  return user;
}

export type SignUpInput = {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
};

export async function signUp(input: SignUpInput): Promise<Session> {
  const store = getStore();
  const email = input.email.trim().toLowerCase();

  // Before the password is hashed: hashing is the expensive step, and a
  // limit that runs after it is a limit on nothing.
  await enforceAttempt('sign_up', { address: await clientAddress() });

  if (input.password.length < 10) {
    throw new AppError('validation_failed', 'Use at least 10 characters.');
  }
  if (await store.users.getByEmail(email)) {
    throw new AppError('conflict', 'An account with that email already exists.');
  }

  const now = new Date().toISOString();
  const user = await store.users.create({
    id: newId('usr'),
    email,
    name: input.name?.trim() || email.split('@')[0] || 'There',
    avatarUrl: null,
    // The first account on a fresh install becomes staff, so a self-hosted
    // deployment has a way in. Never granted otherwise.
    isSuperAdmin: (await store.users.count()) === 0,
    createdAt: now,
    passwordHash: await hashPassword(input.password),
  });

  const baseName = input.organizationName?.trim() || `${user.name}'s workspace`;
  const organization = await store.organizations.create({
    id: newId('org'),
    name: baseName,
    slug: await uniqueSlug(baseName),
    planId: 'free',
    stripeCustomerId: null,
    creditBalance: 0,
    maxProjectCostUsd: 120,
    isSuspended: false,
    createdAt: now,
  });

  await store.memberships.create({
    id: newId('mem'),
    organizationId: organization.id,
    userId: user.id,
    role: 'owner',
    createdAt: now,
  });

  await createSession(user.id);
  return {
    user,
    organizationId: organization.id,
    role: 'owner',
    actor: { user, organizationId: organization.id, role: 'owner' },
  };
}

export async function signIn(email: string, password: string): Promise<Session> {
  const store = getStore();
  // Counted before the lookup and the hash, so a refused attempt costs the
  // server nothing and tells the caller nothing about whether the account
  // exists — the refusal reads the same for every email.
  await enforceAttempt('sign_in', { address: await clientAddress(), account: email });
  const record = await store.users.getByEmail(email.trim().toLowerCase());
  const valid = await verifyPassword(password, record?.passwordHash ?? null);

  // One message for both failures: distinguishing them tells an attacker which
  // emails have accounts.
  if (!record || !valid) {
    throw new AppError('unauthorized', 'That email and password do not match.');
  }

  await createSession(record.id);
  const session = await getSession();
  if (!session) throw new AppError('internal', 'Could not establish a session.');
  return session;
}

async function uniqueSlug(name: string): Promise<string> {
  const store = getStore();
  const base = slugify(name, 40) || 'workspace';
  if (!(await store.organizations.getBySlug(base))) return base;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await store.organizations.getBySlug(candidate))) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}
