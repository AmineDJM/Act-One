import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { site } from '@/lib/site.ts';
import styles from '@/components/marketing.module.css';

export const metadata: Metadata = {
  title: 'Not found',
  // A 404 that gets indexed competes with the pages that should be.
  robots: { index: false, follow: true },
};

/**
 * The page that is not there.
 *
 * A dead end is where most sites lose somebody; this one is a way back in.
 * It looks like the rest of the site because a plain error page after three
 * beautiful ones reads as a different, worse product.
 */
export default async function NotFound() {
  const [policy, config] = await Promise.all([getSignUpPolicy().catch(() => undefined), getProductConfig().catch(() => null)]);

  return (
    <>
      <Nav policy={policy} />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <div className={styles.notFound}>
            <div className="dots" aria-hidden="true">
              <DotMatrix seed="not-found" shape="drift" width={1100} height={280} cell={15} opacity={0.26} />
            </div>
            <p className="prompt" data-tone="muted">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> 404
            </p>
            <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>That page is not here.</h1>
            <p className="lede" style={{ maxWidth: '52ch' }}>
              It may have moved, or a film may have been withdrawn by the people who made it. Everything else is where
              you left it.
            </p>
            <nav className={styles.notFoundLinks} aria-label="Where to go instead">
              <Link href="/collections">Collections</Link>
              <Link href="/work">Reference films</Link>
              <Link href="/blog">Journal</Link>
              <Link href="/how-it-works">How it works</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
          </div>
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <h2 style={{ maxWidth: '22ch' }}>See how {site.name} would launch your product.</h2>
            <StartProject cta={config?.landing.ctaLabel} policy={policy} idPrefix="notfound" />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
