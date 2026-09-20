import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  newId,
  type AssetInput,
  type Concept,
  type NewOrganization,
  type Organization,
  type Project,
  type User,
} from '@act-one/core';
import type { PgStore } from '../pg-store.ts';
import type { Store } from '../store.ts';
import { postgresAvailable, storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * Tenant isolation conformance suite.
 *
 * Written against the Store interface rather than any implementation, so the
 * Postgres store can be held to exactly the same behaviour by pointing this at
 * a live database. The rule under test is blunt: an id belonging to another
 * organisation must behave as if it does not exist — not "forbidden", which
 * would let an attacker enumerate which ids are real.
 */
function makeOrg(name: string): NewOrganization {
  return {
    id: newId('org'),
    name,
    slug: uniqueSlug(name),
    planId: 'free',
    stripeCustomerId: null,
    creditBalance: 100,
    maxProjectCostUsd: 120,
    isSuspended: false,
    createdAt: new Date().toISOString(),
  };
}

function makeUser(email: string): User {
  const [local = 'someone', domain = 'example.com'] = email.split('@');
  return {
    id: newId('usr'),
    email: uniqueEmail(local, domain),
    name: email.split('@')[0]!,
    avatarUrl: null,
    isSuperAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

function makeProject(organizationId: string, userId: string, name: string): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'),
    organizationId,
    createdByUserId: userId,
    name,
    websiteUrl: 'https://acme.com/',
    supplementalUrls: [],
    brandId: null,
    productUnderstandingId: null,
    selectedConceptId: null,
    activeStoryboardId: null,
    latestRenderId: null,
    stage: 'created',
    brief: {
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null,
      goal: null,
      keyMessage: null,
      durationSeconds: null,
      channels: [],
      creativeMode: 'studio',
      voiceStrategy: null,
      formats: [],
      excludedClaims: [],
      realMediaOnly: false,
      language: null,
      tone: null,
    voiceGender: null,
    voiceAccent: null,
    voiceStyle: null,
    voicePace: null,
    },
    productCredentialId: null,
    costUsd: 0,
    creditsSpent: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeConcept(projectId: string, name: string): Concept {
  return {
    id: newId('cpt'),
    projectId,
    name,
    keyIdea: 'idea',
    hook: 'hook',
    targetEmotion: 'relief',
    productAngle: 'angle',
    narrativeStructure: 'problem_shift_proof',
    visualDirection: 'v',
    motionDirection: 'm',
    soundDirection: 's',
    productUiUsage: 'p',
    generativeUsage: 'g',
    creativeSystem: 'cinematic_black',
    estimatedDurationSeconds: 60,
    recommendedChannels: ['homepage_hero'],
    keyScenes: ['a', 'b', 'c'],
    momentIds: [],
    animaticAssetId: null,
    selected: false,
    createdAt: new Date().toISOString(),
  };
}

function makeAsset(organizationId: string, projectId: string): AssetInput {
  return {
    id: newId('ast'),
    organizationId,
    projectId,
    conceptId: null,
    sceneId: null,
    kind: 'screenshot',
    origin: 'captured',
    rights: 'customer_owned',
    storageKey: `org/${organizationId}/project/${projectId}/${newId('ast')}.png`,
    contentType: 'image/png',
    bytes: 1024,
    width: 1920,
    height: 1080,
    durationSeconds: null,
    checksum: null,
    provider: null,
    model: null,
    sourceUrl: null,
    costUsd: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

describe.each(storeCases())('Store tenant isolation ($name)', ({ open, close }) => {
  let store: Store;
  let orgA: Organization;
  let orgB: Organization;
  let userA: User;
  let userB: User;
  let projectA: Project;

  afterEach(async () => {
    await close(store);
  });

  beforeEach(async () => {
    store = await open();
    orgA = await store.organizations.create(makeOrg('Acme'));
    orgB = await store.organizations.create(makeOrg('Globex'));
    userA = await store.users.create(makeUser('a@acme.com'));
    userB = await store.users.create(makeUser('b@globex.com'));
    projectA = await store.projects.create(makeProject(orgA.id, userA.id, 'Acme launch'));
  });

  it('hides another org’s project behind not-found rather than forbidden', async () => {
    expect(await store.projects.get(orgA.id, projectA.id)).not.toBeNull();
    expect(await store.projects.get(orgB.id, projectA.id)).toBeNull();
  });

  it('refuses cross-tenant updates', async () => {
    await expect(
      store.projects.update(orgB.id, projectA.id, { name: 'Stolen' }),
    ).rejects.toThrow(/not found/i);

    const untouched = await store.projects.get(orgA.id, projectA.id);
    expect(untouched?.name).toBe('Acme launch');
  });

  it('never leaks another org’s rows into list queries', async () => {
    await store.projects.create(makeProject(orgB.id, userB.id, 'Globex launch'));
    const listA = await store.projects.list(orgA.id);
    const listB = await store.projects.list(orgB.id);

    expect(listA.map((p) => p.name)).toEqual(['Acme launch']);
    expect(listB.map((p) => p.name)).toEqual(['Globex launch']);
  });

  it('scopes assets, concepts and renders by organisation', async () => {
    const asset = await store.assets.create(makeAsset(orgA.id, projectA.id));
    const [concept] = await store.concepts.createMany(
      [makeConcept(projectA.id, 'One command')],
      orgA.id,
    );

    expect(await store.assets.get(orgB.id, asset.id)).toBeNull();
    expect(await store.assets.getMany(orgB.id, [asset.id])).toEqual([]);
    expect(await store.concepts.get(orgB.id, concept!.id)).toBeNull();
    expect(await store.concepts.listForProject(orgB.id, projectA.id)).toEqual([]);
  });

  it('keeps credential ciphertext unreachable from another tenant', async () => {
    const credential = await store.credentials.create(
      {
        id: newId('sec'),
        organizationId: orgA.id,
        projectId: projectA.id,
        kind: 'password',
        loginUrl: 'https://app.acme.com/login',
        username: 'demo@acme.com',
        secretRef: 'ref',
        authorizedByUserId: userA.id,
        authorizedAt: new Date().toISOString(),
        allowedPaths: [],
        deniedPaths: [],
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      },
      { sealed: 'envelope' },
    );

    expect(await store.credentials.getCiphertext(orgA.id, credential.id)).toEqual({
      sealed: 'envelope',
    });
    expect(await store.credentials.getCiphertext(orgB.id, credential.id)).toBeNull();
  });

  it('destroys the sealed secret on revoke, not just the flag', async () => {
    const credential = await store.credentials.create(
      {
        id: newId('sec'),
        organizationId: orgA.id,
        projectId: projectA.id,
        kind: 'password',
        loginUrl: 'https://app.acme.com/login',
        username: null,
        secretRef: 'ref',
        authorizedByUserId: userA.id,
        authorizedAt: new Date().toISOString(),
        allowedPaths: [],
        deniedPaths: [],
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      },
      { sealed: 'envelope' },
    );

    await store.credentials.revoke(orgA.id, credential.id);
    expect(await store.credentials.getCiphertext(orgA.id, credential.id)).toBeNull();
    expect(await store.credentials.getForProject(orgA.id, projectA.id)).toBeNull();
  });

  it('never returns a password hash from a read that is not the login path', async () => {
    const user = await store.users.get(userA.id);
    expect(user).not.toHaveProperty('passwordHash');
    const members = await store.memberships.listForOrganization(orgA.id);
    for (const member of members) expect(member.user).not.toHaveProperty('passwordHash');
  });

  it('keeps cost rollups per tenant', async () => {
    const cost = (organizationId: string, projectId: string, usd: number) => ({
      id: newId('cst'),
      organizationId,
      projectId,
      sceneId: null,
      renderId: null,
      provider: 'higgsfield',
      model: 'dop-turbo',
      operation: 'media.video' as const,
      estimatedCostUsd: usd,
      actualCostUsd: usd,
      creditsCharged: 100,
      quantity: 1,
      unit: 'call',
      succeeded: true,
      isRetry: false,
      costBasis: 'listed' as const,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    const projectB = await store.projects.create(makeProject(orgB.id, userB.id, 'Globex'));
    await store.costs.record(cost(orgA.id, projectA.id, 1.5));
    await store.costs.record(cost(orgB.id, projectB.id, 9));

    expect(await store.costs.totalForProject(orgA.id, projectA.id)).toBeCloseTo(1.5);
    expect(await store.costs.totalForProject(orgB.id, projectA.id)).toBe(0);
    expect(await store.costs.totalForOrganization(orgA.id)).toBeCloseTo(1.5);
  });
});

describe.each(storeCases())('credit accounting ($name)', ({ open, close }) => {
  it('refuses to go negative and reports it distinctly from an error', async () => {
    const store = await open();
    try {
      const org = await store.organizations.create(makeOrg('Acme'));

      expect((await store.organizations.adjustCredits(org.id, -40))?.creditBalance).toBe(60);
      expect(await store.organizations.adjustCredits(org.id, -1000)).toBeNull();
      expect((await store.organizations.get(org.id))?.creditBalance).toBe(60);
    } finally {
      await close(store);
    }
  });
});

describe.each(storeCases())('concept selection ($name)', ({ open, close }) => {
  it('leaves exactly one concept selected', async () => {
    const store = await open();
    try {
    const org = await store.organizations.create(makeOrg('Acme'));
    const user = await store.users.create(makeUser('a@acme.com'));
    const project = await store.projects.create(makeProject(org.id, user.id, 'Launch'));
    const concepts = await store.concepts.createMany(
      [makeConcept(project.id, 'A'), makeConcept(project.id, 'B'), makeConcept(project.id, 'C')],
      org.id,
    );

    await store.concepts.select(org.id, project.id, concepts[1]!.id);
    let stored = await store.concepts.listForProject(org.id, project.id);
    expect(stored.filter((c) => c.selected).map((c) => c.name)).toEqual(['B']);

    // Changing your mind must not leave two selected.
    await store.concepts.select(org.id, project.id, concepts[2]!.id);
    stored = await store.concepts.listForProject(org.id, project.id);
    expect(stored.filter((c) => c.selected).map((c) => c.name)).toEqual(['C']);
    } finally {
      await close(store);
    }
  });
});

describe.each(storeCases())('project quota accounting ($name)', ({ open, close }) => {
  let store: Store;
  let org: Organization;
  let user: User;

  afterEach(async () => {
    await close(store);
  });

  beforeEach(async () => {
    store = await open();
    org = await store.organizations.create(makeOrg('Quota'));
    user = makeUser('founder@quota.com');
    await store.users.create(user);
  });

  const since = '2000-01-01T00:00:00.000Z';

  async function project(stage: Project['stage']): Promise<Project> {
    const created = await store.projects.create({ ...makeProject(org.id, user.id, 'Test'), stage });
    return created;
  }

  it('does not charge a project that failed before it delivered anything', async () => {
    // A founder whose first attempts broke on our side must not be told to
    // upgrade because of it.
    await project('failed');
    await project('failed');
    expect(await store.projects.countTowardQuotaSince(org.id, since)).toBe(0);
  });

  it('charges a failed project once research produced an understanding', async () => {
    const failed = await project('failed');
    await store.understandings.create(
      // The in-memory store accepted a bare id; Postgres, rightly, wants the
      // row's own timestamp. The conformance run is what surfaced the drift.
      {
        id: newId('pun'),
        projectId: failed.id,
        createdAt: new Date().toISOString(),
      } as Parameters<typeof store.understandings.create>[0],
      org.id,
    );

    expect(await store.projects.countTowardQuotaSince(org.id, since)).toBe(1);
  });

  it('charges every project that is not a bare failure', async () => {
    await project('created');
    await project('film_ready');
    await project('failed');
    expect(await store.projects.countTowardQuotaSince(org.id, since)).toBe(2);
  });

  it('ignores projects created before the window', async () => {
    await project('film_ready');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await store.projects.countTowardQuotaSince(org.id, future)).toBe(0);
  });
});


/**
 * Row-level security itself, with the WHERE clauses taken away.
 *
 * Every repository method scopes by organisation, and the suites above prove
 * that. This proves the second lock: a tenant-scoped connection that runs a
 * bare SELECT gets its own rows and nothing else, because the policy decides,
 * not the query. It only means something against a role that is not a
 * superuser — Postgres never applies a policy to one — which is the role the
 * test database URL must name.
 */
describe.skipIf(!postgresAvailable)('row level security (PgStore)', () => {
  it('shows a tenant only its own rows even with no WHERE clause', async () => {
    const [pg] = storeCases().filter((c) => c.name === 'PgStore');
    const store = (await pg!.open()) as PgStore;
    try {
      const role = await store.raw((c) =>
        c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
        ),
      );
      expect(role.rows[0], 'the test role must not be a superuser, or RLS is never applied').toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
      });

      const orgA = await store.organizations.create(makeOrg('Acme'));
      const orgB = await store.organizations.create(makeOrg('Globex'));
      const userA = await store.users.create(makeUser('a@acme.com'));
      const userB = await store.users.create(makeUser('b@globex.com'));
      const projectA = await store.projects.create(makeProject(orgA.id, userA.id, 'Acme launch'));
      await store.projects.create(makeProject(orgB.id, userB.id, 'Globex launch'));

      const seenByB = await store.asTenant(orgB.id, (c) =>
        c.query<{ id: string; organization_id: string }>('SELECT id, organization_id FROM projects'),
      );
      expect(seenByB.rows.every((row) => row.organization_id === orgB.id)).toBe(true);
      expect(seenByB.rows.some((row) => row.id === projectA.id)).toBe(false);

      // Writes are policed too: a tenant cannot insert a row into another
      // organisation, whatever the application code asked for.
      await expect(
        store.asTenant(orgB.id, (c) =>
          c.query(
            `INSERT INTO projects (id, organization_id, created_by_user_id, name, website_url, supplemental_urls,
               stage, brief, cost_usd, credits_spent, created_at, updated_at)
             VALUES ($1, $2, $3, 'Planted', 'https://acme.com', '[]', 'created', '{}', 0, 0, now(), now())`,
            [newId('prj'), orgA.id, userB.id],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);

      // And with no tenant set at all, the policies fail closed.
      const unscoped = await store.raw(async (c) => {
        await c.query("SELECT set_config('app.platform_access', 'off', true)");
        return c.query('SELECT id FROM projects');
      });
      expect(unscoped.rows).toEqual([]);
    } finally {
      await store.close();
    }
  });
});
