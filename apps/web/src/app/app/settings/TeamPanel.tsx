'use client';

import { useActionState, useState } from 'react';
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  type InviteState,
} from './actions.ts';
import styles from '../app.module.css';

export type TeamMember = { id: string; userId: string; email: string; name: string | null; role: string };
export type PendingInvite = { id: string; email: string; role: string; expiresAt: string };

/**
 * Who is in this workspace, and who has been asked.
 *
 * Plans sell seats, so this is what makes a seat usable. Pending invitations
 * count against the limit alongside members — otherwise a three-seat plan can
 * carry thirty outstanding invitations and the limit is discovered by whoever
 * clicks last.
 */
export function TeamPanel({
  members,
  pending,
  seatsUsed,
  seatLimit,
  canManage,
  viewerUserId,
}: {
  members: TeamMember[];
  pending: PendingInvite[];
  seatsUsed: number;
  seatLimit: number;
  canManage: boolean;
  viewerUserId: string;
}) {
  const [inviteState, invite, inviting] = useActionState<InviteState, FormData>(inviteMemberAction, {
    error: null,
    invite: null,
  });
  const [revokeState, revoke] = useActionState<{ error: string | null }, FormData>(revokeInviteAction, {
    error: null,
  });
  const [removeState, remove] = useActionState<{ error: string | null }, FormData>(removeMemberAction, {
    error: null,
  });
  const [copied, setCopied] = useState(false);

  const unlimited = seatLimit < 0;
  const full = !unlimited && seatsUsed >= seatLimit;
  const error = inviteState.error ?? revokeState.error ?? removeState.error;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Team</h3>
        <span className="badge">
          {seatsUsed} of {unlimited ? 'unlimited' : seatLimit} seat{seatLimit === 1 ? '' : 's'}
        </span>
      </div>

      <ul className={styles.memberList}>
        {members.map((member) => (
          <li key={member.id}>
            <span>
              <strong>{member.name || member.email}</strong>
              {member.name ? <span className={styles.memberEmail}>{member.email}</span> : null}
            </span>
            <span className={styles.cite}>{member.role}</span>
            {canManage && member.userId !== viewerUserId ? (
              <form action={remove}>
                <input type="hidden" name="userId" value={member.userId} />
                <button className="btn btn--ghost" type="submit">
                  Remove
                </button>
              </form>
            ) : (
              <span />
            )}
          </li>
        ))}

        {pending.map((invitation) => (
          <li key={invitation.id} data-pending="true">
            <span>
              <strong>{invitation.email}</strong>
              <span className={styles.memberEmail}>
                Invited · expires {new Date(invitation.expiresAt).toLocaleDateString()}
              </span>
            </span>
            <span className={styles.cite}>{invitation.role}</span>
            {canManage ? (
              <form action={revoke}>
                <input type="hidden" name="id" value={invitation.id} />
                <button className="btn btn--ghost" type="submit">
                  Revoke
                </button>
              </form>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>

      {canManage ? (
        <>
          <hr className="divider" />
          <form action={invite} className={styles.inviteForm}>
            <div className="field">
              <label htmlFor="invite-email">Invite somebody</label>
              <input
                id="invite-email"
                name="email"
                className="input"
                type="email"
                required
                placeholder="colleague@yourproduct.com"
                disabled={full}
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">As</label>
              <select id="invite-role" name="role" className="input" defaultValue="editor" disabled={full}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="reviewer">Reviewer</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={inviting || full}>
              {inviting ? 'Creating…' : 'Create invite link'}
            </button>
          </form>

          {full ? (
            <p className="hint">
              Every seat on this plan is taken. Remove somebody, revoke an invitation, or move up a
              plan.
            </p>
          ) : null}

          {inviteState.invite ? (
            <div className={styles.inviteResult} role="status">
              <p>
                Send this to <strong>{inviteState.invite.email}</strong>. It works once, and expires{' '}
                {new Date(inviteState.invite.expiresAt).toLocaleDateString()}.
              </p>
              <div className={styles.inviteLink}>
                <code>{inviteState.invite.url}</code>
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(inviteState.invite!.url)
                      .then(() => setCopied(true))
                      .catch(() => undefined);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="hint">
                We do not email it for you. Anyone holding this link can join as{' '}
                {inviteState.invite.role}.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
          {error}
        </p>
      ) : null}

      <p className="hint">
        Owners manage billing. Admins manage members and product access. Editors do the creative
        work. Reviewers can read and comment.
      </p>
    </section>
  );
}
