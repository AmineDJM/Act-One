'use client';

import { useActionState } from 'react';
import { signInAction, type AuthState } from '../actions.ts';
import styles from '../auth.module.css';

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signInAction, { error: null });

  return (
    <form className={styles.card} action={action}>
      <h1>Sign in</h1>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" className="input" type="email" autoComplete="email" required />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          className="input"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <button className="btn btn--lg" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
