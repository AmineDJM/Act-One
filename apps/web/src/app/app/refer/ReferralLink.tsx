'use client';

import { useState } from 'react';
import styles from '../app.module.css';

/**
 * The link itself, large enough to read out loud.
 *
 * Copy is the only action: a referral is a thing a person sends in their own
 * words, not a campaign we run for them.
 */
export function ReferralLink({ code, link }: { code: string; link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The link is on the page; a person can select it.
    }
  };

  return (
    <section className={`${styles.panel} ${styles.referPanel}`}>
      <div className={styles.referLink}>
        <code>{link}</code>
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p className="hint">
        Your code is <strong className="mono">{code}</strong>. Anyone who signs up through this link is counted as yours.
      </p>
    </section>
  );
}
