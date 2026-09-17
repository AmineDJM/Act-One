import { describe, it, expect, beforeEach } from 'vitest';
import {
  newId,
  type Asset,
  type Concept,
  type Organization,
  type Project,
  type User,
} from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';
import type { Store } from '../store.ts';

/**
 * Tenant isolation conformance suite.
 *
 * Written against the Store interface rather than any implementation, so the
 * Postgres store can be held to exactly the same behaviour by pointing this at
 * a live database. The rule under test is blunt: an id belonging to another
 * organisation must behave as if it does not exist — not "forbidden", which
 * would let an attacker enumerate which ids are real.
 */
function makeOrg(name: string): Organization {
  return {
    id: newId('org'),
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    planId: 'free',
    stripeCustomerId: null,
    creditBalance: 100,
    maxProjectCostUsd: 120,
    isSuspended: false,
    createdAt: new Date().toISOString(),
  };
}

function makeUser(email: string): User {
  return {
    id: newId('usr'),
    email,
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
      targetAudience: null,
      goal: null,
      keyMessage: null,
      durationSeconds: null,
      channels: [],
      creativeMode: 'studio',
      voiceStrategy: null,
      formats: [],
      excludedClaims: [],
      realMediaOnly: false,
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

function makeAsset(organizationId: string, projectId: string): Asset {
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

describe('Store tenant isolation (MemoryStore)', () => {
  let store: Store;
  let orgA: Organization;
  let orgB: Organization;
  let userA: User;
  let userB: User;
  let projectA: Project;

  beforeEach(async () => {
    store = new MemoryStore();
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

describe('credit accounting', () => {
  it('refuses to go negative and reports it distinctly from an error', async () => {
    const store = new MemoryStore();
    const org = await store.organizations.create(makeOrg('Acme'));

    expect((await store.organizations.adjustCredits(org.id, -40))?.creditBalance).toBe(60);
    expect(await store.organizations.adjustCredits(org.id, -1000)).toBeNull();
    expect((await store.organizations.get(org.id))?.creditBalance).toBe(60);
  });
});

describe('concept selection', () => {
  it('leaves exactly one concept selected', async () => {
    const store = new MemoryStore();
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
  });
});
