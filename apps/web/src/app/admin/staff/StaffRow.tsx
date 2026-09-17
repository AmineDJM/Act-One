'use client';

import { useActionState } from 'react';
import { setStaffAccessAction, type ActionResult } from '../actions.ts';
import styles from '../admin.module.css';

export function StaffRow({
  user,
  workspaces,
  isViewer,
  isLastOperator,
}: {
  user: { id: string; email: string; name: string | null; isSuperAdmin: boolean };
  workspaces: number;
  isViewer: boolean;
  isLastOperator: boolean;
}) {
  const [result, submit, pending] = useActionState<ActionResult | null, FormData>(
    setStaffAccessAction,
    null,
  );

  // The server refuses both of these too; disabling here is so the operator is
  // told why before they click, not after.
  const blocked = user.isSuperAdmin && (isViewer || isLastOperator);
  const blockedReason = isViewer
    ? 'Ask another operator to revoke your access.'
    : 'The last operator cannot be removed.';

  return (
    <li className={styles.staffRow}>
      <div>
        <strong>{user.name || user.email}</strong>
        {user.name ? <span className={styles.staffEmail}>{user.email}</span> : null}
      </div>
      <span className={styles.staffMeta}>
        {workspaces} workspace{workspaces === 1 ? '' : 's'}
      </span>

      <form action={submit}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="grant" value={user.isSuperAdmin ? 'false' : 'true'} />
        <button
          className={user.isSuperAdmin ? 'btn btn--ghost' : 'btn btn--secondary'}
          type="submit"
          disabled={pending || blocked}
          title={blocked ? blockedReason : undefined}
        >
          {pending ? '…' : user.isSuperAdmin ? 'Revoke access' : 'Make operator'}
        </button>
      </form>

      {result ? (
        <span className={styles.verdict} data-ok={result.ok} role="status">
          {result.message}
        </span>
      ) : blocked ? (
        <span className={styles.staffMeta}>{blockedReason}</span>
      ) : null}
    </li>
  );
}
