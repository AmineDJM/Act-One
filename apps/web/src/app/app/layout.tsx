import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@act-one/core';
import { getSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import styles from './app.module.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Navigation is five items and never grows.
 *
 * The brief is explicit that customers must not see providers, models, queues
 * or render nodes. Everything operational lives in the staff console.
 */
const TABS = [
  { href: '/app', label: 'Projects' },
  { href: '/app/brand', label: 'Brand' },
  { href: '/app/billing', label: 'Billing' },
  { href: '/app/settings', label: 'Settings' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/auth/sign-in?next=/app');

  const store = getStore();
  const [organization, memberships] = await Promise.all([
    store.organizations.get(session.organizationId),
    store.memberships.listForUser(session.user.id),
  ]);

  const workspaces = (
    await Promise.all(memberships.map((membership) => store.organizations.get(membership.organizationId)))
  )
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={`shell ${styles.topbarInner}`}>
          <Link href="/app" className={styles.brand}>
            <span className={styles.mark} aria-hidden="true" />
            {PRODUCT_NAME}
          </Link>
          <nav className={styles.tabs} aria-label="Workspace">
            {TABS.map((tab) => (
              <Link key={tab.href} href={tab.href}>
                {tab.label}
              </Link>
            ))}
          </nav>
          <div className={styles.spacer} />
          <WorkspaceSwitcher current={session.organizationId} workspaces={workspaces} />
          {organization ? (
            <span className={styles.credits} title="Creative credits">
              {organization.creditBalance.toLocaleString('en-US')} credits
            </span>
          ) : null}
          {session.user.isSuperAdmin ? (
            <Link href="/admin" className="btn btn--ghost" style={{ height: 34, fontSize: '0.85rem' }}>
              Console
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" className={`shell ${styles.main}`}>
        {children}
      </main>
    </div>
  );
}
