import Link from 'next/link';
import type { SignUpPolicy } from '@act-one/core';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import styles from './marketing.module.css';

/**
 * The public navigation.
 *
 * Its one strong button says what the product offers right now — an
 * invitation to request, a beta to join, an account to start — and is
 * told so by the page, which read the phase; nothing here decides it.
 */
export function Nav({ policy }: { policy?: SignUpPolicy }) {
  const primary = policy && !policy.open && policy.applications ? { href: '/request-access', label: policy.ctaLabel } : { href: '/auth/sign-up', label: policy?.ctaLabel ?? 'Start free' };
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={`shell ${styles.navInner}`}>
        <Wordmark tag={policy?.tag ?? undefined} />
        <div className={styles.navLinks}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/collections">Collections</Link>
          <Link href="/work">Work</Link>
          <Link href="/blog">Journal</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Link href="/auth/sign-in" className="btn btn--ghost">
            Sign in
          </Link>
          <Link href={primary.href} className="btn">
            {primary.label}
          </Link>
        </div>
      </div>
    </nav>
  );
}
