import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, AUTH_LIMITS, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { RedirectSignal, request, resetRequest } from './request-scope.ts';
import { requireSession, requireSuperAdmin, signIn, signUp, type Session } from '../auth.ts';
import { createProject, getProjectOr404 } from '../projects.ts';
import { inviteMember } from '../team.ts';
import { signInAction, signUpAction } from '../../app/auth/actions.ts';
import { testProviderAction } from '../../app/admin/actions.ts';
import { GET as getAsset } from '../../app/api/assets/[id]/route.ts';

/**
 * Authorisation, at the layer that enforces it.
 *
 * The store proves that another tenant's id reads as not-found; these prove
 * the web app never hands the store anything but the caller's own
 * organisation, that a role is checked before every mutation, that the
 * console is invisible to customers, and that the doors close after too
 * many tries. Each test signs real people up and in, through the same
 * functions the forms call, against a fresh in-memory store.
 */
let store: MemoryStore;
const jars = new Map<string, Map<string, string>>();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Signs somebody up in their own browser, and remembers that browser. */
async function founder(name: string, email = `${name}-${newId('usr').slice(-6)}@example.com`) {
  resetRequest();
  request().headers.set('x-forwarded-for', `203.0.113.${jars.size + 1}`);
  const session = await signUp({ email, password: 'a-very-long-password', name });
  jars.set(name, new Map(request().cookies));
  return { session, email };
}

/** Continues in that person's browser. */
function become(name: string): void {
  const jar = jars.get(name);
  if (!jar) throw new Error(`no browser for ${name}`);
  request().cookies = new Map(jar);
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
  jars.clear();
  resetRequest();
});

describe('sessions', () => {
  it('grants nothing without a cookie that proves who is asking', async () => {
    expect((await failure(requireSession())).code).toBe('unauthorized');
    request().cookies.set('act_one_session', 'not-a-token-anyone-issued');
    expect((await failure(requireSession())).code).toBe('unauthorized');
  });

  it('resolves the person and workspace the cookie was issued for', async () => {
    const { session, email } = await founder('ada');
    const resolved = await requireSession();
    expect(resolved.user.email).toBe(email);
    expect(resolved.organizationId).toBe(session.organizationId);
    expect(resolved.role).toBe('owner');
  });

  it('reads a wrong password and an unknown email the same way', async () => {
    const { email } = await founder('ada');
    const wrong = await failure(signIn(email, 'not-the-password'));
    const unknown = await failure(signIn('nobody@example.com', 'not-the-password'));
    expect(wrong.publicMessage).toBe(unknown.publicMessage);
    expect(wrong.status).toBe(unknown.status);
  });
});

describe('tenancy at the edge', () => {
  it('reads another workspace’s project as not found, never as forbidden', async () => {
    const ada = await founder('ada');
    const project = await createProject(ada.session, { websiteUrl: 'https://acme.example' });
    const bob = await founder('bob');

    await expect(getProjectOr404(ada.session, project.id)).resolves.toMatchObject({ id: project.id });
    const refused = await failure(getProjectOr404(bob.session, project.id));
    expect(refused.code).toBe('not_found');
    expect(refused.status).toBe(404);
  });

  it('serves an asset only to the workspace that owns it', async () => {
    const ada = await founder('ada');
    const project = await createProject(ada.session, { websiteUrl: 'https://acme.example' });
    const asset = await store.assets.create({
      id: newId('ast'),
      organizationId: ada.session.organizationId,
      projectId: project.id,
      conceptId: null,
      sceneId: null,
      kind: 'master_video',
      origin: 'rendered',
      rights: 'customer_owned',
      storageKey: 'nowhere/master.mp4',
      contentType: 'video/mp4',
      bytes: 1,
      width: null,
      height: null,
      durationSeconds: null,
      provider: null,
      model: null,
      sourceUrl: null,
      checksum: null,
      costUsd: 0,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    const call = () =>
      getAsset(new Request(`http://localhost/api/assets/${asset.id}`), { params: Promise.resolve({ id: asset.id }) });

    await founder('bob');
    expect((await call()).status).toBe(404);

    resetRequest();
    expect((await call()).status).toBe(401);
  });
});

describe('roles', () => {
  it('checks the role before a mutation, whatever the caller claims', async () => {
    // The operator opens the install, and their own workspace is not held to a
    // plan. The person under test here is a customer, so she signs up second.
    await founder('operator');
    const ada = await founder('ada');
    const reviewer: Session = {
      ...ada.session,
      role: 'reviewer',
      actor: { ...ada.session.actor, role: 'reviewer' },
    };
    expect((await failure(createProject(reviewer, { websiteUrl: 'https://acme.example' }))).code).toBe('forbidden');
    expect((await failure(inviteMember(reviewer, { email: 'x@example.com', role: 'editor' }))).code).toBe('forbidden');

    // The owner can — on a plan with a seat to give. Free has one, and the
    // refusal it gets is an entitlement, not a permission: a different door.
    expect((await failure(inviteMember(ada.session, { email: 'colleague@example.com', role: 'editor' }))).code).toBe(
      'entitlement_required',
    );
    await store.organizations.update(ada.session.organizationId, { planId: 'pro' });
    const invited = await inviteMember(ada.session, { email: 'colleague@example.com', role: 'editor' });
    expect(invited.token.length).toBeGreaterThan(20);
    expect((await failure(inviteMember(ada.session, { email: 'y@example.com', role: 'owner' }))).code).toBe(
      'validation_failed',
    );
  });
});

describe('the console', () => {
  it('does not exist for a customer, and every console action checks again', async () => {
    // The first account on a fresh install is staff; the second is a customer.
    await founder('ada');
    await founder('bob');
    const refused = await failure(requireSuperAdmin());
    expect(refused.code).toBe('not_found');
    expect(refused.status).toBe(404);
    await expect(testProviderAction(null, form({ provider: 'openai' }))).rejects.toMatchObject({ code: 'not_found' });

    become('ada');
    await expect(requireSuperAdmin()).resolves.toMatchObject({ isSuperAdmin: true });
  });

  it('refuses the console to nobody at all', async () => {
    expect((await failure(requireSuperAdmin())).code).toBe('unauthorized');
  });
});

describe('the doors', () => {
  it('closes an account after too many wrong passwords, even to the right one', async () => {
    const { email } = await founder('ada');
    resetRequest();
    request().headers.set('x-forwarded-for', '198.51.100.7');

    for (let i = 0; i < AUTH_LIMITS.signIn.perAccount.limit; i += 1) {
      expect((await failure(signIn(email, 'wrong-password-again'))).code).toBe('unauthorized');
    }
    const shut = await failure(signIn(email, 'a-very-long-password'));
    expect(shut.code).toBe('rate_limited');
    expect(shut.status).toBe(429);
    expect(shut.publicMessage).toMatch(/Try again in \d+ minutes?\./);

    // Somebody else at the same address is not locked out with them.
    const other = await founder('bob');
    request().headers.set('x-forwarded-for', '198.51.100.7');
    await expect(signIn(other.email, 'a-very-long-password')).resolves.toMatchObject({ role: 'owner' });
  });

  it('closes sign-up to an address that opens too many accounts', async () => {
    resetRequest();
    request().headers.set('x-forwarded-for', '198.51.100.9');
    for (let i = 0; i < AUTH_LIMITS.signUp.perAddress.limit; i += 1) {
      await signUp({ email: `mill-${i}@example.com`, password: 'a-very-long-password' });
    }
    const shut = await failure(signUp({ email: 'mill-more@example.com', password: 'a-very-long-password' }));
    expect(shut.code).toBe('rate_limited');

    request().headers.set('x-forwarded-for', '198.51.100.10');
    await expect(signUp({ email: 'elsewhere@example.com', password: 'a-very-long-password' })).resolves.toBeTruthy();
  });

  it('is what the forms report, in words, not internals', async () => {
    // The forms are read with the door open: the phase gate has its own suite.
    await store.platform.updateSettings({ product: { phase: 'production' } }, 'test');
    const { email } = await founder('ada');
    resetRequest();
    const failed = await signInAction({ error: null }, form({ email, password: 'nope-nope-nope' }));
    // The same sentence the function throws — the one that does not say which
    // half was wrong — and nothing from inside.
    expect(failed.error).toBe((await failure(signIn(email, 'nope-nope-nope'))).publicMessage);
    expect(failed.error).not.toMatch(/Error|stack|scrypt/);

    await expect(signInAction({ error: null }, form({ email, password: 'a-very-long-password', next: '/app' })))
      .rejects.toBeInstanceOf(RedirectSignal);

    // An open redirect on the sign-in form is a phishing primitive.
    const away = await signInAction({ error: null }, form({ email, password: 'a-very-long-password', next: '//evil.example' })).catch((e) => e);
    expect(away).toBeInstanceOf(RedirectSignal);
    expect((away as RedirectSignal).to).toBe('/app');

    const signedUp = await signUpAction({ error: null }, form({ email: 'new-person@example.com', password: 'a-very-long-password' })).catch((e) => e);
    expect(signedUp).toBeInstanceOf(RedirectSignal);
  });
});
