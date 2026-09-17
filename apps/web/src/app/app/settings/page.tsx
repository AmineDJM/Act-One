import { ROLE_PERMISSIONS, can } from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { loadTeam } from '@/server/team.ts';
import { SignOutButton } from './SignOutButton.tsx';
import { TeamPanel } from './TeamPanel.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSessionForPage('/app/settings');
  const store = getStore();
  const [organization, team] = await Promise.all([
    store.organizations.get(session.organizationId),
    loadTeam(session),
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

        <TeamPanel
          members={team.members.map((member) => ({
            id: member.id,
            userId: member.userId,
            email: member.user.email,
            name: member.user.name,
            role: member.role,
          }))}
          pending={team.pending.map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
          }))}
          seatsUsed={team.seatsUsed}
          seatLimit={team.seatLimit}
          canManage={can(session.actor, 'member:manage')}
          viewerUserId={session.user.id}
        />
      </div>
    </>
  );
}
