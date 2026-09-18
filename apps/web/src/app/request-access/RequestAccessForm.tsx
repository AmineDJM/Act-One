'use client';

import { useActionState } from 'react';
import { requestAccessAction, type AccessState } from '../auth/actions.ts';
import styles from '../auth/auth.module.css';

export function RequestAccessForm({ website, prompt, phaseLine }: { website: string; prompt: string; phaseLine: string | null }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(requestAccessAction, { error: null });

  if (state.done) {
    return (
      <div className={styles.card}>
        <h1>Thank you.</h1>
        <p className="secondary">
          A person will read this, not a queue. When there is a place for you, your invitation arrives by email.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.card} action={action}>
      <h1>Request access</h1>
      {phaseLine ? <p className={styles.phaseLine}>{phaseLine}</p> : null}
      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className={styles.grid2}>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" autoComplete="name" required placeholder="Alex Roy" />
        </div>
        <div className="field">
          <label htmlFor="company">Company</label>
          <input id="company" name="company" className="input" autoComplete="organization" placeholder="Acme" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" className="input" type="email" autoComplete="email" required placeholder="alex@yourproduct.com" />
      </div>
      <div className="field">
        <label htmlFor="website">Your product</label>
        <input id="website" name="website" className="input" type="url" inputMode="url" defaultValue={website} placeholder="https://yourproduct.com" />
      </div>
      <div className="field">
        <label htmlFor="message">{prompt}</label>
        <textarea id="message" name="message" className="input" rows={4} maxLength={2000} placeholder="What it is, who it is for, when it launches." />
      </div>
      <button className="btn btn--lg" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Request access'}
      </button>
      <p className="hint" style={{ textAlign: 'center' }}>
        We read every request. No newsletter, no drip.
      </p>
    </form>
  );
}
