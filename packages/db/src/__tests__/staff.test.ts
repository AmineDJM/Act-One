import { describe, it, expect, beforeEach } from 'vitest';
import { newId, type User } from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';

function makeUser(email: string, isSuperAdmin = false): User {
  return {
    id: newId('usr'),
    email,
    name: email.split('@')[0]!,
    avatarUrl: null,
    isSuperAdmin,
    createdAt: new Date().toISOString(),
  };
}

describe('platform access', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('counts only the people who actually hold access', async () => {
    await store.users.create(makeUser('one@act.one', true));
    await store.users.create(makeUser('two@act.one', true));
    await store.users.create(makeUser('customer@acme.com'));

    expect(await store.users.countSuperAdmins()).toBe(2);
    expect(await store.users.count()).toBe(3);
  });

  it('reports zero once the last operator is demoted', async () => {
    // The guard that refuses this revoke reads exactly this number, so it is
    // worth pinning: an off-by-one here locks everybody out of the console
    // with no way back in from inside the product.
    const only = await store.users.create(makeUser('only@act.one', true));
    await store.users.update(only.id, { isSuperAdmin: false });

    expect(await store.users.countSuperAdmins()).toBe(0);
  });

  it('lists everyone, newest first, without password hashes', async () => {
    await store.users.create({ ...makeUser('old@act.one'), createdAt: '2020-01-01T00:00:00.000Z', passwordHash: 'secret-hash' });
    await store.users.create({ ...makeUser('new@act.one'), createdAt: '2026-01-01T00:00:00.000Z', passwordHash: 'secret-hash' });

    const listed = await store.users.list();
    expect(listed.map((u) => u.email)).toEqual(['new@act.one', 'old@act.one']);
    expect(listed.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('honours the limit', async () => {
    for (let i = 0; i < 5; i += 1) await store.users.create(makeUser(`u${i}@act.one`));
    expect(await store.users.list(2)).toHaveLength(2);
  });
});
