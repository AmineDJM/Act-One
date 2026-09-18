'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { normalizeUrl } from '@act-one/core';
import styles from './marketing.module.css';

/**
 * The entire onboarding, on the landing page.
 *
 * One field. The brief is explicit that the user should not be marched through
 * a thirty-field creative brief, and the fastest way to honour that is to make
 * the first screen indistinguishable from the product's first screen.
 *
 * Validation happens here so a typo is caught before an account is created —
 * asking somebody to sign up and only then telling them their URL was wrong is
 * how a funnel leaks.
 */
export function StartProject({ cta = 'Understand my product' }: { cta?: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeUrl(value);
    if (!normalized) {
      setError('That does not look like a website address. Try acme.com.');
      return;
    }
    setError(null);
    setPending(true);
    // Carry the URL through sign-up so the first thing after an account exists
    // is the product working, not an empty dashboard.
    router.push(`/auth/sign-up?website=${encodeURIComponent(normalized)}`);
  }

  return (
    <form className={styles.starter} onSubmit={submit} noValidate>
      <div className={styles.starterRow}>
        <label htmlFor="website" className="sr-only">
          Your product website
        </label>
        <input
          id="website"
          // Named as well as identified: without it the browser's autofill
          // heuristics never see this as a URL field, and a password manager
          // has nothing to key on. React's value binding works either way,
          // which is why it went unnoticed.
          name="website"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://yourproduct.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'website-error' : 'website-hint'}
          required
        />
        <button className="btn btn--lg" type="submit" disabled={pending}>
          {pending ? 'Opening…' : cta}
        </button>
      </div>
      {error ? (
        <p id="website-error" className={styles.starterNote} style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </p>
      ) : (
        <p id="website-hint" className={styles.starterNote}>
          Free. No card. You will see the product understanding, your brand and three concepts before
          anything is charged.
        </p>
      )}
    </form>
  );
}
