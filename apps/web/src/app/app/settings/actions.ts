'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AppError, MemberRole, can } from '@act-one/core';
import { destroySession, requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { inviteMember } from '@/server/team.ts';
import { reportError } from '@/server/report.ts';
import { absoluteUrl } from '@/lib/site.ts';

export type InviteState = {
  error: string | null;
  invite: { email: string; role: string; url: string; expiresAt: string } | null;
};

export async function signOutAction(): Promise<null> {
  await destroySession();
  redirect('/');
}

/**
 * Invites somebody into this workspace.
 *
 * The link is returned to the inviter rather than emailed. Act One has no
 * outbound mail, and a product that silently drops invitations into a mailer
 * nobody configured is worse than one that hands you a link to send yourself.
 */
export async function inviteMemberAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  try {
    const session = await requireSession();
    const { invitation, token } = await inviteMember(session, {
      email: String(formData.get('email') ?? ''),
      role: MemberRole.catch('editor').parse(formData.get('role')),
    });

    revalidatePath('/app/settings');
    return {
      error: null,
      invite: {
        email: invitation.email,
        role: invitation.role,
        url: absoluteUrl(`/invite/${token}`),
        expiresAt: invitation.expiresAt,
      },
    };
  } catch (error) {
    return { error: reportError('inviteMemberAction', error).publicMessage, invite: null };
  }
}

export async function revokeInviteAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'member:manage')) {
      throw new AppError('forbidden', 'Your role cannot manage members.');
    }
    await getStore().invitations.revoke(session.organizationId, String(formData.get('id') ?? ''));
    revalidatePath('/app/settings');
    return { error: null };
  } catch (error) {
    return { error: reportError('revokeInviteAction', error).publicMessage };
  }
}

/**
 * Removes somebody from the workspace.
 *
 * The last owner cannot be removed, and nobody can remove themselves: both
 * leave a workspace that nobody can administer, and there is no way to repair
 * that from inside the product.
 */
export async function removeMemberAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'member:manage')) {
      throw new AppError('forbidden', 'Your role cannot manage members.');
    }

    const userId = String(formData.get('userId') ?? '');
    if (userId === session.user.id) {
      return { error: 'You cannot remove yourself. Ask another owner or admin.' };
    }

    const store = getStore();
    const members = await store.memberships.listForOrganization(session.organizationId);
    const target = members.find((member) => member.userId === userId);
    if (!target) return { error: 'They are not in this workspace.' };

    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
      return { error: 'That is the last owner. Make somebody else an owner first.' };
    }

    await store.memberships.remove(session.organizationId, userId);
    revalidatePath('/app/settings');
    return { error: null };
  } catch (error) {
    return { error: reportError('removeMemberAction', error).publicMessage };
  }
}
