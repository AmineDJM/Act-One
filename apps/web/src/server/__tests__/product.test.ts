import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp } from '../auth.ts';
import { applyForAccess, createInvites, decideApplication, getSignUpPolicy, saveProductConfig, signUpGate } from '../product.ts';
import { signUpAction } from '../../app/auth/actions.ts';
import { RedirectSignal } from './request-scope.ts';

/**
 * The door, at the layer that holds it: a private beta refuses an account
 * without a usable invitation and takes one use when it lets somebody in;
 * a public beta and production need nothing; a request for access becomes
 * an invitation only when a person says so.
 */
let store: MemoryStore;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
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

async function staff() {
  resetRequest();
  request().headers.set('x-forwarded-for', '203.0.113.250');
  // The first account on a fresh install is staff.
  return signUp({ email: `staff-${newId('usr').slice(-6)}@actone.example`, password: 'a-very-long-password', name: 'Staff' });
}

function visitor(address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`) {
  resetRequest();
  request().headers.set('x-forwarded-for', address);
}

async function attempt(fields: Record<string, string>): Promise<{ error: string | null } | 'redirected'> {
  try {
    return await signUpAction({ error: null }, form(fields));
  } catch (error) {
    if (error instanceof RedirectSignal) return 'redirected';
    throw error;
  }
}

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('the door', () => {
  it('is by invitation by default, and says so', async () => {
    const policy = await getSignUpPolicy();
    expect(policy).toMatchObject({ phase: 'private_beta', open: false, requiresCode: true, ctaLabel: 'Request access' });
    expect((await failure(signUpGate(''))).publicMessage).toContain('invitation');
    expect((await failure(signUpGate('ACT-NOPE-NOPE'))).publicMessage).toContain('not one we know');
    visitor();
    const refused = await attempt({ email: `ada-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Ada' });
    expect(refused).not.toBe('redirected');
    expect((refused as { error: string | null }).error).toContain('invitation');
  });

  it('lets an invitation in once, and takes the use', async () => {
    const admin = await staff();
    const [code] = await createInvites({ count: 1, maxUses: 1, expiresInDays: 30, note: 'Ada', createdByUserId: admin.user.id });
    visitor('203.0.113.11');
    const first = await attempt({ email: `ada-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Ada', code: code!.code.toLowerCase() });
    expect(first).toBe('redirected');
    expect((await store.invites.get(code!.id))?.uses).toBe(1);
    visitor('203.0.113.12');
    const second = await attempt({ email: `bob-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Bob', code: code!.code });
    expect((second as { error: string | null }).error).toContain('already been used');
  });

  it('opens in a public beta and in production, and remembers a code that was used anyway', async () => {
    const admin = await staff();
    await saveProductConfig({ phase: 'public_beta' }, admin.user.id);
    expect((await getSignUpPolicy())).toMatchObject({ open: true, tag: 'beta', ctaLabel: 'Join the beta' });
    visitor('203.0.113.21');
    expect(await attempt({ email: `carol-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Carol' })).toBe('redirected');
    await saveProductConfig({ phase: 'production' }, admin.user.id);
    expect(await getSignUpPolicy()).toMatchObject({ open: true, tag: null, ctaLabel: 'Start free', phaseLine: null });
    const [code] = await createInvites({ count: 1, maxUses: 5, expiresInDays: null, note: '', createdByUserId: admin.user.id });
    visitor('203.0.113.22');
    expect(await attempt({ email: `dan-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name: 'Dan', code: code!.code })).toBe('redirected');
    expect((await store.invites.get(code!.id))?.uses).toBe(1);
  });

  it('turns a request into an invitation only when a person approves it', async () => {
    visitor('203.0.113.31');
    const asked = await applyForAccess({ email: 'Founder@Acme.example', name: 'Ada', company: 'Acme', website: 'https://acme.example', message: 'October.' });
    expect(asked).toMatchObject({ email: 'founder@acme.example', status: 'pending' });
    // Asking twice is one request.
    const again = await applyForAccess({ email: 'founder@acme.example', name: 'Ada', company: '', website: '', message: '' });
    expect(again.id).toBe(asked.id);
    expect((await failure(applyForAccess({ email: 'not-an-email', name: '', company: '', website: '', message: '' }))).code).toBe('validation_failed');

    const admin = await staff();
    const { application, code } = await decideApplication(asked.id, 'approved', admin.user.id);
    expect(application.status).toBe('approved');
    expect(code).not.toBeNull();
    expect(code!.maxUses).toBe(1);
    // Deciding again changes nothing and returns the same invitation.
    expect((await decideApplication(asked.id, 'rejected', admin.user.id)).code?.id).toBe(code!.id);
    const declined = await applyForAccess({ email: 'other@acme.example', name: 'Bob', company: '', website: '', message: '' });
    expect((await decideApplication(declined.id, 'rejected', admin.user.id)).application.status).toBe('rejected');
    // In production nobody needs to ask.
    await saveProductConfig({ phase: 'production' }, admin.user.id);
    expect((await failure(applyForAccess({ email: 'x@acme.example', name: '', company: '', website: '', message: '' }))).code).toBe('forbidden');
  });
});
