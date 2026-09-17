import { describe, it, expect } from 'vitest';
import { INVITE_TTL_DAYS, inviteIsUsable, inviteRefusal, type Invitation } from '../domain/org.ts';

function invite(over: Partial<Invitation> = {}): Invitation {
  return {
    id: 'inv_1',
    organizationId: 'org_1',
    email: 'colleague@acme.com',
    role: 'editor',
    tokenHash: 'hash',
    invitedByUserId: 'usr_1',
    acceptedAt: null,
    expiresAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const before = new Date('2026-01-15T00:00:00.000Z');
const after = new Date('2026-03-01T00:00:00.000Z');

describe('invitations', () => {
  it('is usable while it is unaccepted and unexpired', () => {
    expect(inviteIsUsable(invite(), before)).toBe(true);
    expect(inviteRefusal(invite(), before)).toBeNull();
  });

  it('cannot be used twice', () => {
    // A link that keeps working after it is used is a standing credential for
    // somebody else's workspace, sitting in whatever inbox it was sent to.
    const used = invite({ acceptedAt: '2026-01-10T00:00:00.000Z' });
    expect(inviteIsUsable(used, before)).toBe(false);
    expect(inviteRefusal(used, before)).toMatch(/already been used/i);
  });

  it('expires', () => {
    expect(inviteIsUsable(invite(), after)).toBe(false);
    expect(inviteRefusal(invite(), after)).toMatch(/expired/i);
  });

  it('refuses a link that matches nothing without saying why', () => {
    // Distinguishing "no such invitation" from "expired invitation" tells
    // somebody probing tokens which guesses were close.
    expect(inviteRefusal(null, before)).toBe('That invitation link is not valid.');
  });

  it('treats the expiry boundary as expired rather than usable', () => {
    const exact = new Date('2026-02-01T00:00:00.000Z');
    expect(inviteIsUsable(invite(), exact)).toBe(false);
  });

  it('lives long enough to survive a weekend and a holiday', () => {
    expect(INVITE_TTL_DAYS).toBeGreaterThanOrEqual(7);
  });
});
