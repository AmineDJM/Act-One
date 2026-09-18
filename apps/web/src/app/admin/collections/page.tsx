import { COLLECTION_STATUS_LABELS, CollectionStatus } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { pictureChoicesFor, publishableProjects } from '@/server/collections.ts';
import { CollectionRow } from './CollectionRow.tsx';
import { PublishFilm } from './PublishFilm.tsx';
import { ReorderList } from './ReorderList.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Collections, for a person to run.
 *
 * Everything the public gallery shows is decided here: what is selected,
 * what is featured, which film is the launch of the week, in which order,
 * under which title and with which frame. Submissions wait under
 * consideration until somebody looks; staff may also publish a film with
 * the written consent they hold, and say so in the entry.
 */
export default async function CollectionsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = typeof params['status'] === 'string' ? params['status'] : 'pending';
  const status = CollectionStatus.safeParse(requested);
  const store = getStore();
  const [entries, counts, candidates] = await Promise.all([
    store.collections.list({ ...(status.success ? { status: status.data } : {}), limit: 300 }),
    store.collections.countByStatus(),
    publishableProjects(60),
  ]);
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const [organization, submitter, pictures] = await Promise.all([
        store.organizations.get(entry.organizationId),
        entry.submittedByUserId ? store.users.get(entry.submittedByUserId) : null,
        pictureChoicesFor(entry),
      ]);
      return {
        entry,
        organizationName: organization?.name ?? entry.organizationId,
        submitterEmail: submitter?.email ?? null,
        pictures: pictures.map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name || asset.kind, width: asset.width, height: asset.height })),
      };
    }),
  );
  const published = status.success && status.data === 'published' ? entries : [];

  return (
    <>
      <header className={styles.head}>
        <h1>Collections</h1>
        <p className="lede">
          {Object.entries(counts)
            .map(([name, count]) => `${count} ${COLLECTION_STATUS_LABELS[name as CollectionStatus]?.toLowerCase() ?? name}`)
            .join(' · ') || 'Nothing has been submitted yet.'}
        </p>
      </header>

      <nav className={styles.windowTabs} aria-label="Status" style={{ marginBottom: 'var(--space-4)' }}>
        {CollectionStatus.options.map((option) => (
          <a key={option} href={`/admin/collections?status=${option}`} data-active={status.success && status.data === option ? 'true' : 'false'}>
            {COLLECTION_STATUS_LABELS[option]}
            {counts[option] ? ` (${counts[option]})` : ''}
          </a>
        ))}
        <a href="/admin/collections?status=all" data-active={!status.success ? 'true' : 'false'}>
          All
        </a>
      </nav>

      {published.length > 1 ? <ReorderList entries={published.map((entry) => ({ id: entry.id, company: entry.company, title: entry.title, launchOfTheWeek: entry.launchOfTheWeek, featured: entry.featured }))} /> : null}

      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing here.</p>
      ) : (
        <ul className={styles.customerList}>
          {rows.map((row) => (
            <CollectionRow key={row.entry.id} entry={row.entry} organizationName={row.organizationName} submitterEmail={row.submitterEmail} pictures={row.pictures} />
          ))}
        </ul>
      )}

      <PublishFilm
        candidates={candidates.map((candidate) => ({
          value: `${candidate.project.organizationId}/${candidate.project.id}`,
          label: `${candidate.organizationName} · ${candidate.project.name} · ${candidate.project.websiteUrl}`,
          state: candidate.entry ? COLLECTION_STATUS_LABELS[candidate.entry.status] : null,
        }))}
      />
    </>
  );
}
