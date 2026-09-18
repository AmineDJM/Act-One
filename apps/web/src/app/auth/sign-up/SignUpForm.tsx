'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { SignUpPolicy } from '@act-one/core';
import { signUpAction, type AuthState } from '../actions.ts';
import styles from '../auth.module.css';

export function SignUpForm({ website, next, policy, code }: { website: string; next: string; policy: SignUpPolicy; code: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUpAction, { error: null });
  const invited = policy.requiresCode && code.length > 0;

  return (
    <form className={styles.card} action={action}>
      <h1>{policy.phase === 'private_beta' ? (invited ? 'You are invited.' : 'By invitation.') : 'Create your account'}</h1>
      {policy.phaseLine ? <p className={styles.phaseLine}>{policy.phaseLine}</p> : null}

      {website ? (
        <div className={styles.carry}>
          <span aria-hidden="true">→</span>
          <span>
            We will start reading <strong>{new URL(website).hostname}</strong> as soon as you are in.
          </span>
        </div>
      ) : null}
      <input type="hidden" name="website" value={website} />
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      {policy.requiresCode ? (
        <div className="field">
          <label htmlFor="code">Invitation code</label>
          <input
            id="code"
            name="code"
            className="input"
            defaultValue={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            placeholder="ACT-XXXX-XXXX"
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
          />
          {!invited && policy.applications ? (
            <span className="hint">
              No invitation yet? <Link href={website ? `/request-access?website=${encodeURIComponent(website)}` : '/request-access'}>Request access</Link>.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" className="input" autoComplete="name" placeholder="Alex Roy" />
      </div>

      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          className="input"
          type="email"
          autoComplete="email"
          required
          placeholder="alex@yourproduct.com"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="At least 10 characters"
        />
        <span className="hint">At least 10 characters.</span>
      </div>

      <button className="btn btn--lg" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>

      <p className="hint" style={{ textAlign: 'center' }}>
        {policy.phase === 'production' ? 'Free. No card. Nothing is charged until you render a film.' : 'No card. Nothing is charged until you render a film.'}
      </p>
    </form>
  );
}
