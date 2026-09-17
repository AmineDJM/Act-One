'use client';

import { useActionState } from 'react';
import { signUpAction, type AuthState } from '../actions.ts';
import styles from '../auth.module.css';

export function SignUpForm({ website }: { website: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUpAction, { error: null });

  return (
    <form className={styles.card} action={action}>
      <h1>Create your account</h1>

      {website ? (
        <div className={styles.carry}>
          <span aria-hidden="true">→</span>
          <span>
            We will start reading <strong>{new URL(website).hostname}</strong> as soon as you are in.
          </span>
        </div>
      ) : null}
      <input type="hidden" name="website" value={website} />

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
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
        Free. No card. Nothing is charged until you render a film.
      </p>
    </form>
  );
}
