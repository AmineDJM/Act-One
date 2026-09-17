'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { switchWorkspaceAction } from './actions.ts';
import styles from './app.module.css';

/**
 * Which workspace you are looking at.
 *
 * Only rendered when somebody belongs to more than one, because a picker with
 * a single option is furniture. Accepting an invitation is how a second one
 * appears, and without this the session falls back to whichever membership
 * happens to sort first — so people joined workspaces they could never reach.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (workspaces.length < 2) return null;

  return (
    <label className={styles.switcher}>
      <span className="sr-only">Workspace</span>
      <select
        value={current}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          start(async () => {
            await switchWorkspaceAction(id);
            router.refresh();
          });
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}
