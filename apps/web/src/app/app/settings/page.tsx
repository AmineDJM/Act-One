import { ROLE_PERMISSIONS } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { SignOutButton } from './SignOutButton.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const store = getStore();
  const [organization, members] = await Promise.all([
    store.organizations.get(session.organizationId),
    store.memberships.listForOrganization(session.organizationId),
  ]);

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Settings</h1>
          <p className="secondary" style={{ marginTop: 'var(--space-2)' }}>
            {organization?.name}
          </p>
        </div>
      </div>

      <div className={styles.panels}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>You</h3>
            <span className="badge">{session.role}</span>
          </div>
          <dl className={styles.kv}>
            <div className={styles.kvRow}>
              <dt>Name</dt>
              <dd>{session.user.name}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Email</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>Can</dt>
              <dd>{ROLE_PERMISSIONS[session.role].length} permissions</dd>
            </div>
          </dl>
          <SignOutButton />
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Team</h3>
            <span className="badge">{members.length} member{members.length === 1 ? '' : 's'}</span>
          </div>
          <ul className={styles.claims}>
            {members.map((member) => (
              <li key={member.id}>
                <span className={styles.cite}>{member.role}</span>
                {member.user.email}
              </li>
            ))}
          </ul>
          <p className="hint">
            Owners manage billing. Admins manage members and product access. Editors do the creative
            work. Reviewers can read and comment.
          </p>
        </section>
      </div>
    </>
  );
}
