import Link from 'next/link';
import { site } from '@/lib/site.ts';
import styles from './marketing.module.css';

export function Nav() {
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={`shell ${styles.navInner}`}>
        <Link href="/" className={styles.brand} aria-label={`${site.name} home`}>
          <span className={styles.mark} aria-hidden="true" />
          {site.name}
        </Link>
        <div className={styles.navLinks}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/work">Work</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Link href="/auth/sign-in" className="btn btn--ghost">
            Sign in
          </Link>
          <Link href="/auth/sign-up" className="btn">
            Start free
          </Link>
        </div>
      </div>
    </nav>
  );
}
