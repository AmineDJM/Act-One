'use server';

import { redirect } from 'next/navigation';
import { normalizeUrl } from '@act-one/core';
import { signIn, signUp } from '@/server/auth.ts';
import { createProject } from '@/server/projects.ts';
import { reportError } from '@/server/report.ts';
import { applyForAccess, redeemInvite, signUpGate } from '@/server/product.ts';
import { recordReferral } from '@/server/referrals.ts';

export type AuthState = { error: string | null };

/**
 * Sign-up carries the website through from the landing page.
 *
 * The first thing after an account exists should be the product working on
 * their product — not an empty dashboard asking them to start over.
 */
export async function signUpAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  // Somebody who arrived from an invitation has somewhere specific to be, and
  // creating an account must not lose it — that link is the whole reason they
  // signed up.
  let destination = safeRedirect(String(formData.get('next') ?? ''));

  try {
    // The phase decides whether the door is open, and on which invitation.
    const gate = await signUpGate(String(formData.get('code') ?? ''));

    const session = await signUp({
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      name: String(formData.get('name') ?? '') || undefined,
    });
    await redeemInvite(gate.code, session.user.id);
    // Who brought them, recorded once. Nothing is paid until they produce.
    await recordReferral(gate.code, session);

    const website = normalizeUrl(String(formData.get('website') ?? ''));
    if (website) {
      const project = await createProject(session, { websiteUrl: website });
      destination = `/app/projects/${project.id}`;
    }
  } catch (error) {
    return { error: reportError('signUpAction', error).publicMessage };
  }

  // redirect() throws, so it must sit outside the try or it is caught as a
  // failure and the user is told sign-up did not work when it did.
  redirect(destination);
}

export async function signInAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const next = String(formData.get('next') ?? '/app');

  try {
    await signIn(String(formData.get('email') ?? ''), String(formData.get('password') ?? ''));
  } catch (error) {
    return { error: reportError('signInAction', error).publicMessage };
  }

  redirect(safeRedirect(next));
}

/**
 * Where to send somebody after they authenticate.
 *
 * Only ever within this app: an open redirect on a login form is a phishing
 * primitive, and `//evil.example` is a protocol-relative URL that leaves the
 * site while looking like a path.
 */
function safeRedirect(target: string): string {
  return target.startsWith('/') && !target.startsWith('//') ? target : '/app';
}

export type AccessState = { error: string | null; done?: boolean };

/** A request for access while the product is by invitation. */
export async function requestAccessAction(_previous: AccessState, formData: FormData): Promise<AccessState> {
  try {
    await applyForAccess({
      email: String(formData.get('email') ?? ''),
      name: String(formData.get('name') ?? ''),
      company: String(formData.get('company') ?? ''),
      website: String(formData.get('website') ?? ''),
      message: String(formData.get('message') ?? ''),
    });
    return { error: null, done: true };
  } catch (error) {
    return { error: reportError('requestAccessAction', error).publicMessage };
  }
}
