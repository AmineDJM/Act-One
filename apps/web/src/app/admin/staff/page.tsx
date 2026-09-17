import { getStore } from '@/server/store.ts';
import { getCurrentUser } from '@/server/auth.ts';
import { StaffRow } from './StaffRow.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Who can reach this console.
 *
 * There is no impersonation here and there will not be. Being able to act as a
 * customer is the single most useful support tool and the single worst thing
 * to have in a breach, and a platform that renders films from a customer's
 * authenticated product session must never let one customer's session be used
 * for anything but that customer's own work.
 */
export default async function StaffPage() {
  const store = getStore();
  const [users, viewer] = await Promise.all([store.users.list(200), getCurrentUser()]);

  const staff = users.filter((user) => user.isSuperAdmin);
  const others = users.filter((user) => !user.isSuperAdmin);

  const memberships = await Promise.all(
    users.map(async (user) => [user.id, (await store.memberships.listForUser(user.id)).length] as const),
  );
  const workspaceCount = new Map(memberships);

  return (
    <>
      <header className={styles.head}>
        <h1>Access</h1>
        <p className="lede">
          Who can reach this console. Platform access is total — every workspace, every cost, every
          key — so it is granted deliberately and every change is logged.
        </p>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Operators</span>
          <strong className={styles.metricValue}>{staff.length}</strong>
          <span className={styles.metricNote}>Can reach this console</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Everyone</span>
          <strong className={styles.metricValue}>{users.length}</strong>
          <span className={styles.metricNote}>Accounts on the platform</span>
        </div>
      </div>

      <section className={styles.section}>
        <h2>Operators</h2>
        <ul className={styles.staffList}>
          {staff.map((user) => (
            <StaffRow
              key={user.id}
              user={{ id: user.id, email: user.email, name: user.name, isSuperAdmin: true }}
              workspaces={workspaceCount.get(user.id) ?? 0}
              isViewer={user.id === viewer?.id}
              isLastOperator={staff.length === 1}
            />
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2>Everyone else</h2>
        {others.length === 0 ? (
          <p className={styles.empty}>Nobody else has signed up yet.</p>
        ) : (
          <ul className={styles.staffList}>
            {others.map((user) => (
              <StaffRow
                key={user.id}
                user={{ id: user.id, email: user.email, name: user.name, isSuperAdmin: false }}
                workspaces={workspaceCount.get(user.id) ?? 0}
                isViewer={user.id === viewer?.id}
                isLastOperator={false}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="hint" style={{ maxWidth: '62ch' }}>
        There is deliberately no &ldquo;sign in as this customer&rdquo;. Act One renders films from
        product sessions customers authorise for their own workspace, and a console that can borrow
        one of those sessions is a console that can use it for somebody else.
      </p>
    </>
  );
}
