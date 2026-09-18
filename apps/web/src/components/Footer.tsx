import Link from 'next/link';
import { site } from '@/lib/site.ts';
import { publicProductName } from '@/server/product.ts';
import styles from './marketing.module.css';

/**
 * The line at the bottom, and the only place the mark is claimed.
 *
 * A ™ or ® on every appearance of the name is how a young company looks
 * anxious. Convention puts it once, on the legal line, and the console
 * decides which one it is: nothing until there is something to claim, ™ where
 * the claim is being made, ® only once a registration is real. Never written
 * into a page by hand.
 */
export async function Footer() {
  /*
   * The mark belongs to the brand, not to whatever company owns it. When a
   * separate legal entity is configured, the copyright names the entity and
   * claims nothing on its behalf.
   */
  const marked = await publicProductName().catch(() => site.name);
  const name = site.legalName === site.name ? marked : site.legalName;

  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.footerInner}`}>
        <div>
          © {new Date().getFullYear()} {name}
        </div>
        <div className={styles.footerLinks}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/collections">Collections</Link>
          <Link href="/work">Work</Link>
          <Link href="/blog">Journal</Link>
          <Link href="/pricing">Pricing</Link>
          {site.supportEmail ? <a href={`mailto:${site.supportEmail}`}>Contact</a> : null}
        </div>
      </div>
    </footer>
  );
}
