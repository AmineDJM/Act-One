import { describe, it, expect } from 'vitest';
import {
  ROLE_PERMISSIONS,
  roleHasPermission,
  can,
  MemberRole,
  Permission,
  type ActorContext,
  type User,
} from '../index.ts';

const user: User = {
  id: 'usr_1',
  email: 'a@b.com',
  name: 'A',
  avatarUrl: null,
  isSuperAdmin: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('role permissions', () => {
  it('gives reviewers read and comment only', () => {
    expect(roleHasPermission('reviewer', 'project:read')).toBe(true);
    expect(roleHasPermission('reviewer', 'comment:write')).toBe(true);
    expect(roleHasPermission('reviewer', 'render:start')).toBe(false);
    expect(roleHasPermission('reviewer', 'storyboard:edit')).toBe(false);
    expect(roleHasPermission('reviewer', 'billing:manage')).toBe(false);
  });

  it('reserves billing and org deletion for owners', () => {
    for (const role of MemberRole.options) {
      expect(roleHasPermission(role, 'billing:manage')).toBe(role === 'owner');
      expect(roleHasPermission(role, 'org:delete')).toBe(role === 'owner');
    }
  });

  it('never lets an editor manage members or credentials', () => {
    expect(roleHasPermission('editor', 'member:manage')).toBe(false);
    expect(roleHasPermission('editor', 'credentials:manage')).toBe(false);
    expect(roleHasPermission('admin', 'credentials:manage')).toBe(true);
  });

  it('keeps roles monotonically ordered: owner >= admin >= editor >= reviewer', () => {
    const order: MemberRole[] = ['reviewer', 'editor', 'admin', 'owner'];
    for (let i = 0; i < order.length - 1; i += 1) {
      const lower = new Set(ROLE_PERMISSIONS[order[i]!]);
      const higher = new Set(ROLE_PERMISSIONS[order[i + 1]!]);
      for (const p of lower) expect(higher.has(p)).toBe(true);
    }
  });

  it('covers every declared permission in at least one role', () => {
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flatMap((ps) => [...ps]));
    for (const p of Permission.options) expect(granted.has(p)).toBe(true);
  });
});

describe('can()', () => {
  it('checks against the actor role, not the user record', () => {
    const actor: ActorContext = { user, organizationId: 'org_1', role: 'reviewer' };
    expect(can(actor, 'project:read')).toBe(true);
    expect(can(actor, 'render:start')).toBe(false);
  });
});
