import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId, type Project } from '@act-one/core';
import { MemoryStore, type Store } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
import { resolveAssetUrls, storeAsset, type StageContext } from '../context.ts';

/**
 * One service writes; another reads.
 *
 * The production failure was not that an asset was missing. It was that two
 * processes disagreed about where assets live and nothing ever asked them.
 * The web service ingested every capture to its own disk, wrote the rows to
 * the database both services share, and the worker — which had its own disk —
 * signed a URL for every row and rendered thirty seconds of title cards.
 *
 * Existence-checking catches that at render time, which is late and is not the
 * fix. The fix is that persistent media lives somewhere both processes can
 * reach, and this proves the property in both directions: a store both can
 * reach works across process boundaries, and one that only looks shared is
 * caught by the flag it carries rather than by a customer.
 */

function context(store: Store, registry: ProviderRegistry, project: Project): StageContext {
  return {
    store,
    registry,
    organizationId: project.organizationId,
    project,
    jobId: newId('job'),
    progress: async () => undefined,
    activity: async () => undefined,
  };
}

async function workspace(store: Store) {
  const now = new Date().toISOString();
  const organization = await store.organizations.create({
    id: newId('org'), name: 'Crossing', slug: `crossing-${newId('org').slice(-6)}`, planId: 'pro',
    stripeCustomerId: null, creditBalance: 100, maxProjectCostUsd: 10, isSuspended: false, createdAt: now,
  });
  const user = await store.users.create({
    id: newId('usr'), email: `lead-${newId('usr').slice(-6)}@crossing.example`, name: 'Lead',
    avatarUrl: null, isSuperAdmin: false, createdAt: now,
  });
  const project = await store.projects.create({
    id: newId('prj'), organizationId: organization.id, createdByUserId: user.id, name: 'Crossing',
    websiteUrl: 'https://crossing.example/', supplementalUrls: [], brandId: null,
    productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
    latestRenderId: null, stage: 'created',
    brief: {
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null,
      keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
      voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null,
      tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
    createdAt: now, updatedAt: now,
  });
  return project;
}

describe('an asset written by one service is readable by another', () => {
  it('crosses a process boundary when the two share a store', async () => {
    /*
     * Two registries, two `StageContext`s, one database and one storage root:
     * as close to two services as a test can get without two processes, and
     * it fails for exactly the reason production failed if the root differs.
     */
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-shared-'));
    const store = new MemoryStore();
    const project = await workspace(store);

    try {
      const worker = new ProviderRegistry({ overrides: { storage: new LocalFsStorageProvider({ root }) } });
      const stored = await storeAsset(context(store, worker, project), {
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        kind: 'screenshot', origin: 'captured', rights: 'customer_owned',
        extension: 'png', contentType: 'image/png',
      });

      // A second service, constructed independently, holding nothing from the first.
      const renderer = new ProviderRegistry({ overrides: { storage: new LocalFsStorageProvider({ root }) } });
      const resolved = await resolveAssetUrls(context(store, renderer, project), [stored.asset.id]);

      expect(resolved.missing).toEqual([]);
      expect(resolved.urls[stored.asset.id]).toBeTruthy();
      // And the bytes come back, which is the only claim that matters.
      const bytes = await renderer.storage().get(stored.asset.storageKey);
      expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to hand the renderer a url when the second service has its own disk', async () => {
    // The production incident, reproduced: same database, different disks.
    const writerRoot = await mkdtemp(path.join(tmpdir(), 'act-one-writer-'));
    const readerRoot = await mkdtemp(path.join(tmpdir(), 'act-one-reader-'));
    const store = new MemoryStore();
    const project = await workspace(store);

    try {
      const worker = new ProviderRegistry({ overrides: { storage: new LocalFsStorageProvider({ root: writerRoot }) } });
      const stored = await storeAsset(context(store, worker, project), {
        data: new Uint8Array([1, 2, 3, 4]),
        kind: 'screenshot', origin: 'captured', rights: 'customer_owned',
        extension: 'png', contentType: 'image/png',
      });

      const web = new ProviderRegistry({ overrides: { storage: new LocalFsStorageProvider({ root: readerRoot }) } });
      const resolved = await resolveAssetUrls(context(store, web, project), [stored.asset.id]);

      // The row is there. The bytes are not. Before this, the url was signed
      // anyway and the renderer drew type on black.
      expect(resolved.urls).toEqual({});
      expect(resolved.missing).toEqual([
        { id: stored.asset.id, reason: 'object_missing', storageKey: stored.asset.storageKey },
      ]);
    } finally {
      await rm(writerRoot, { recursive: true, force: true });
      await rm(readerRoot, { recursive: true, force: true });
    }
  });

  it('knows that a local disk is not a shared store, and says so before anything is made', () => {
    /*
     * The flag exists so a deployment can be refused at boot rather than
     * diagnosed from a customer's silent film. One process reading what it
     * wrote is development; two services on two machines is production.
     */
    const local = new LocalFsStorageProvider({ root: '/tmp/anything' });
    expect(local.shared).toBe(false);
  });
});
