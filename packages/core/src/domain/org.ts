import { z } from 'zod';
import { nonEmpty } from '../zod-helpers.ts';

export const MemberRole = z.enum(['owner', 'admin', 'editor', 'reviewer']);
export type MemberRole = z.infer<typeof MemberRole>;

/** Everything a member can do. Checked server-side on every mutation. */
export const Permission = z.enum([
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'concept:approve',
  'storyboard:edit',
  'storyboard:approve',
  'render:start',
  'render:approve',
  'brand:edit',
  'asset:upload',
  'comment:write',
  'credentials:manage',
  'billing:manage',
  'member:manage',
  'org:delete',
]);
export type Permission = z.infer<typeof Permission>;

const EDITOR_PERMISSIONS: Permission[] = [
  'project:read',
  'project:create',
  'project:update',
  'concept:approve',
  'storyboard:edit',
  'storyboard:approve',
  'render:start',
  'brand:edit',
  'asset:upload',
  'comment:write',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...EDITOR_PERMISSIONS,
  'project:delete',
  'render:approve',
  'credentials:manage',
  'member:manage',
];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: [...ADMIN_PERMISSIONS, 'billing:manage', 'org:delete'],
  admin: ADMIN_PERMISSIONS,
  editor: EDITOR_PERMISSIONS,
  reviewer: ['project:read', 'comment:write'],
};

export function roleHasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const Organization = z.object({
  id: z.string(),
  name: nonEmpty(160),
  slug: nonEmpty(80),
  planId: z.string().default('free'),
  stripeCustomerId: z.string().nullable().default(null),
  creditBalance: z.number().min(0).default(0),
  /** Hard ceiling per project. Protects us from a runaway render loop. */
  maxProjectCostUsd: z.number().min(0).default(120),
  isSuspended: z.boolean().default(false),
  createdAt: z.string(),
});
export type Organization = z.infer<typeof Organization>;

export const User = z.object({
  id: z.string(),
  email: z.string().trim().toLowerCase(),
  name: z.string().max(160).default(''),
  avatarUrl: z.string().nullable().default(null),
  /** Staff-only flag for the internal Super Admin. Never settable from the app. */
  isSuperAdmin: z.boolean().default(false),
  createdAt: z.string(),
});
export type User = z.infer<typeof User>;

export const Membership = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: MemberRole,
  createdAt: z.string(),
});
export type Membership = z.infer<typeof Membership>;

/** The authenticated caller, resolved once per request. */
export type ActorContext = {
  user: User;
  organizationId: string;
  role: MemberRole;
};

export function can(actor: ActorContext, permission: Permission): boolean {
  return roleHasPermission(actor.role, permission);
}

/**
 * An invitation to join a workspace.
 *
 * The token is stored hashed, exactly like a session. A pending invite sitting
 * in a database in plaintext is a standing credential for somebody else's
 * workspace, and invites live for days rather than minutes.
 */
export const Invitation = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string().email(),
  role: MemberRole,
  tokenHash: z.string(),
  invitedByUserId: z.string(),
  acceptedAt: z.string().nullable().default(null),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Invitation = z.infer<typeof Invitation>;

/** How long an unaccepted invitation stays usable. */
export const INVITE_TTL_DAYS = 14;

export function inviteIsUsable(invitation: Invitation, now = new Date()): boolean {
  if (invitation.acceptedAt) return false;
  return new Date(invitation.expiresAt).getTime() > now.getTime();
}

/** Why an invitation cannot be used, in words for the person holding the link. */
export function inviteRefusal(invitation: Invitation | null, now = new Date()): string | null {
  if (!invitation) return 'That invitation link is not valid.';
  if (invitation.acceptedAt) return 'That invitation has already been used.';
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return 'That invitation has expired. Ask for a new one.';
  }
  return null;
}
