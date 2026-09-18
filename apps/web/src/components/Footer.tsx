import Link from 'next/link';
import { site } from '@/lib/site.ts';
import styles from './marketing.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.footerInner}`}>
        <div>
          © {new Date().getFullYear()} {site.legalName}
        </div>
        <div className={styles.footerLinks}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/work">Work</Link>
          <Link href="/pricing">Pricing</Link>
          {site.supportEmail ? <a href={`mailto:${site.supportEmail}`}>Contact</a> : null}
        </div>
      </div>
    </footer>
  );
}
