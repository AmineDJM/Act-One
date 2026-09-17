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
