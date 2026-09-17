import 'server-only';
import {
  AppError,
  INVITE_TTL_DAYS,
  can,
  canAddSeat,
  inviteRefusal,
  newId,
  type Invitation,
  type MemberRole,
} from '@act-one/core';
import { hashToken, newToken, type Session } from './auth.ts';
import { getStore } from './store.ts';
import { entitlementsFor } from './platform.ts';

/**
 * Inviting somebody into a workspace.
 *
 * The raw token exists only in the returned link. What is stored is its hash,
 * because a pending invitation sitting in plaintext is a standing credential
 * for somebody else's workspace, and unlike a session it is valid for a
 * fortnight.
 */
export async function inviteMember(
  session: Session,
  input: { email: string; role: MemberRole },
): Promise<{ invitation: Invitation; token: string }> {
  if (!can(session.actor, 'member:manage')) {
    throw new AppError('forbidden', 'Your role cannot invite people.');
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AppError('validation_failed', 'That does not look like an email address.');
  }
  if (input.role === 'owner') {
    // Ownership transfers deliberately, not through an emailed link.
    throw new AppError('validation_failed', 'Ownership cannot be handed over by invitation.');
  }

  const store = getStore();
  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');

  const existing = await store.memberships.listForOrganization(session.organizationId);
  if (existing.some((member) => member.user.email.toLowerCase() === email)) {
    throw new AppError('conflict', 'They are already in this workspace.');
  }

  /*
   * Pending invitations count against the seat limit. Otherwise a plan with
   * three seats can have thirty invitations outstanding, and the limit is
   * discovered by whoever happens to click last.
   */
  const pending = (await store.invitations.listForOrganization(session.organizationId)).filter(
    (invitation) => !invitation.acceptedAt,
  );
  const { plan } = await entitlementsFor(organization);
  const decision = canAddSeat({ plan, currentSeats: existing.length + pending.length });
  if (!decision.allowed) {
    throw new AppError('entitlement_required', decision.reason);
  }

  const token = newToken();
  const invitation = await store.invitations.create({
    id: newId('inv'),
    organizationId: session.organizationId,
    email,
    role: input.role,
    tokenHash: hashToken(token),
    invitedByUserId: session.user.id,
    acceptedAt: null,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
  });

  return { invitation, token };
}

/**
 * Turns an invitation link into a membership.
 *
 * The email on the invitation is not checked against the signed-in account. An
 * invitation is a bearer credential — whoever holds the link was given it — and
 * pretending otherwise only breaks the common case where somebody's work
 * address differs from the one a colleague typed.
 */
export async function acceptInvitation(token: string, userId: string): Promise<Invitation> {
  const store = getStore();
  const invitation = await store.invitations.findByTokenHash(hashToken(token));

  const refusal = inviteRefusal(invitation);
  if (refusal || !invitation) throw new AppError('not_found', refusal ?? 'Invalid invitation.');

  const already = await store.memberships.find(invitation.organizationId, userId);
  if (!already) {
    await store.memberships.create({
      id: newId('mem'),
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
      createdAt: new Date().toISOString(),
    });
  }

  await store.invitations.markAccepted(invitation.id, new Date().toISOString());
  return invitation;
}

/** The workspace's people and its outstanding invitations. */
export async function loadTeam(session: Session) {
  const store = getStore();
  const [members, invitations, organization] = await Promise.all([
    store.memberships.listForOrganization(session.organizationId),
    store.invitations.listForOrganization(session.organizationId),
    store.organizations.get(session.organizationId),
  ]);

  const { plan } = organization
    ? await entitlementsFor(organization)
    : { plan: null };

  const pending = invitations.filter((invitation) => !invitation.acceptedAt);
  return {
    members,
    pending,
    plan,
    seatsUsed: members.length + pending.length,
    seatLimit: plan?.limits.maxSeats ?? 1,
  };
}
