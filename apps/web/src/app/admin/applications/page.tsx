import { BETA_APPLICATION_LABELS, BetaApplicationStatus } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { inviteLink } from '@/server/product.ts';
import { ApplicationRow } from './ApplicationRow.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Requests for access, for a person to decide.
 *
 * Approving makes a single-use invitation for the address and shows the
 * link to send; declining records that somebody said no. Nothing is sent
 * on anyone's behalf: the reply is a person's, in their own words.
 */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = typeof params['status'] === 'string' ? params['status'] : 'pending';
  const status = BetaApplicationStatus.safeParse(requested);
  const store = getStore();
  const [applications, counts] = await Promise.all([
    store.applications.list({ ...(status.success ? { status: status.data } : {}), limit: 300 }),
    store.applications.countByStatus(),
  ]);
  const rows = await Promise.all(
    applications.map(async (application) => {
      const code = application.inviteCodeId ? await store.invites.get(application.inviteCodeId) : null;
      return { application, link: code ? inviteLink(code) : null, code: code?.code ?? null, redeemed: code ? code.uses > 0 : false };
    }),
  );

  return (
    <>
      <header className={styles.head}>
        <h1>Requests for access</h1>
        <p className="lede">
          {Object.entries(counts)
            .map(([name, count]) => `${count} ${BETA_APPLICATION_LABELS[name as keyof typeof BETA_APPLICATION_LABELS]?.toLowerCase() ?? name}`)
            .join(' · ') || 'Nobody has asked yet.'}
        </p>
      </header>
      <nav className={styles.windowTabs} aria-label="Status" style={{ marginBottom: 'var(--space-4)' }}>
        {BetaApplicationStatus.options.map((option) => (
          <a key={option} href={`/admin/applications?status=${option}`} data-active={status.success && status.data === option ? 'true' : 'false'}>
            {BETA_APPLICATION_LABELS[option]}
          </a>
        ))}
        <a href="/admin/applications?status=all" data-active={!status.success ? 'true' : 'false'}>
          All
        </a>
      </nav>
      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing here.</p>
      ) : (
        <ul className={styles.customerList}>
          {rows.map((row) => (
            <ApplicationRow key={row.application.id} application={row.application} link={row.link} code={row.code} redeemed={row.redeemed} />
          ))}
        </ul>
      )}
    </>
  );
}
