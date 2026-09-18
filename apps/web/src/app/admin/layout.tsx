import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth.ts';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import styles from './admin.module.css';

/**
 * The internal console.
 *
 * Separate from the customer app by route, by layout and by authorisation:
 * staff tooling that shares a layout with the product is how an operator
 * eventually clicks the wrong button in front of a customer's screen share.
 */
export const metadata: Metadata = {
  title: 'Console',
  // Staff surfaces must never be indexed, whatever robots.txt says.
  robots: { index: false, follow: false, nocache: true },
};

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/product', label: 'Product' },
  { href: '/admin/invites', label: 'Invitations' },
  { href: '/admin/applications', label: 'Requests' },
  { href: '/admin/collections', label: 'Collections' },
  { href: '/admin/referrals', label: 'Referrals' },
  { href: '/admin/blog', label: 'Journal' },
  { href: '/admin/seo', label: 'Search' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/providers', label: 'Integrations' },
  { href: '/admin/voice', label: 'Voice' },
  { href: '/admin/plans', label: 'Plans & pricing' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/costs', label: 'Costs & margin' },
  { href: '/admin/logs', label: 'Logs' },
  { href: '/admin/standards', label: 'Standards' },
  { href: '/admin/staff', label: 'Access' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // Redirect rather than throw: a signed-out operator should land on sign-in,
  // and a signed-in non-staff user should never learn this route resolves.
  if (!user) redirect('/auth/sign-in?next=/admin');
  if (!user.isSuperAdmin) redirect('/app');

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Wordmark href="/admin" tag="staff" />
        <nav className={styles.navList} aria-label="Console">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: '0.8rem' }} className="muted">
          Signed in as
          <br />
          {user.email}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Link href="/app" className="btn btn--secondary" style={{ height: 34, fontSize: '0.85rem' }}>
              Back to app
            </Link>
          </div>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
