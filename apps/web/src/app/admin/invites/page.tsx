import { inviteCodeRefusal } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { inviteLink } from '@/server/product.ts';
import { InviteTools } from './InviteTools.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * Every invitation, and the means to make more.
 *
 * A code is a link a person can be sent; the table says how many times it
 * opened the door, until when it may, and lets it be withdrawn. Referral
 * codes appear here too, with their owner.
 */
export default async function InvitesPage() {
  const store = getStore();
  const codes = await store.invites.list({ limit: 300 });
  const owners = new Map<string, string>();
  for (const id of new Set(codes.map((code) => code.ownerUserId ?? code.createdByUserId).filter((id): id is string => id !== null))) {
    const user = await store.users.get(id);
    if (user) owners.set(id, user.email);
  }
  const rows = codes.map((code) => ({
    ...code,
    link: inviteLink(code),
    refusal: inviteCodeRefusal(code),
    by: (code.createdByUserId && owners.get(code.createdByUserId)) ?? null,
    owner: (code.ownerUserId && owners.get(code.ownerUserId)) ?? null,
  }));
  const open = rows.filter((row) => row.refusal === null).length;

  return (
    <>
      <header className={styles.head}>
        <h1>Invitations</h1>
        <p className="lede">
          {codes.length} code{codes.length === 1 ? '' : 's'}, {open} still open. A code is a link; send it to the person it is for.
        </p>
      </header>
      <InviteTools rows={rows} />
    </>
  );
}
