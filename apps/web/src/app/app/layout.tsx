import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@act-one/core';
import { getSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { getSignUpPolicy } from '@/server/product.ts';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import { NavTabs } from '@/components/ui/NavTabs.tsx';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import styles from './app.module.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Navigation is a handful of words and never grows.
 *
 * The brief is explicit that customers must not see providers, models, queues
 * or render nodes. Everything operational lives in the staff console, one
 * quiet mono link away for the people who hold the keys.
 */
const TABS = [
  { href: '/app', label: 'Projects' },
  { href: '/app/brand', label: 'Brand' },
  { href: '/app/library', label: 'Library' },
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

  const credits = organization?.creditBalance ?? 0;
  // The invitation link appears only while the programme is running.
  const { getReferralProgram } = await import('@/server/referrals.ts');
  const referrals = (await getReferralProgram().catch(() => null))?.enabled ?? false;
  const policy = await getSignUpPolicy();

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={`shell ${styles.topbarInner}`}>
          <Wordmark href="/app" tag={policy.tag ?? undefined} />
          <NavTabs tabs={TABS} className={styles.tabs} />
          <div className={styles.spacer} />
          <WorkspaceSwitcher current={session.organizationId} workspaces={workspaces} />
          <span className={styles.credits} data-empty={credits === 0} title="Creative credits">
            {credits.toLocaleString('en-US')} credits
          </span>
          {/* The one way in to the referral page: beside the credits it earns. */}
          {referrals ? (
            <Link href="/app/refer" className={styles.console} title="Invite a founder">
              Invite
            </Link>
          ) : null}
          {session.user.isSuperAdmin ? (
            <Link href="/admin" className={styles.console}>
              Console
            </Link>
          ) : null}
          <Link href="/app/settings" className={styles.account} title={session.user.email} aria-label="Account">
            {initials(session.user.name || session.user.email)}
          </Link>
        </div>
        <NavTabs tabs={TABS} className={styles.tabsPhone} />
      </header>
      <main id="main" className={`shell ${styles.main}`}>
        {children}
      </main>
      <footer className={styles.foot}>
        <div className={`shell ${styles.footInner}`}>
          <span>
            <span style={{ color: 'var(--accent)' }}>&gt;</span> Great products don&rsquo;t just exist. They have an{' '}
            {PRODUCT_NAME}.
          </span>
          <span className={styles.systems} data-ok={organization !== null}>
            {organization !== null ? 'All systems operational' : 'Reconnecting'}
          </span>
        </div>
      </footer>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
