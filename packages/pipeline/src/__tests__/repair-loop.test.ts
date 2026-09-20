import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrandSystem, Scene, Storyboard, newId, type Project } from '@act-one/core';
import { MemoryStore, type Store } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
import type { GenerativeMediaProvider, MediaJob } from '@act-one/providers';
import { applyRepairs } from '@act-one/qa';
import { runSceneAssets } from '../stages/assets.ts';
import { storeAsset, type StageContext } from '../context.ts';

/**
 * The repair loop, closed.
 *
 * `applyRepairs` has always known which shots lost their material: it clears
 * their references and pushes them onto `needsProvider`. What that list did
 * for a long time was nothing — it was computed, returned and dropped, so a
 * shot whose capture had gone missing was marked as needing a provider and
 * then rendered as a title card, and the film came out of the loop shorter on
 * pictures than it went in.
 *
 * This walks the whole thing with a real store, real storage and a provider
 * that actually answers: a shot loses its asset, the plan says regenerate it,
 * the loop asks a provider, the bytes land in storage, and the scene comes
 * back holding a reference to them. Anything less than that last step and the
 * loop is a list.
 */

/** A provider that answers, counts what it was asked, and hands back real bytes. */
function fakeMedia(url: string): GenerativeMediaProvider & { calls: string[] } {
  const calls: string[] = [];
  const job = (id: string): MediaJob => ({
    id,
    status: 'succeeded',
    outputUrls: [url],
    contentType: 'video/mp4',
    costUsd: 0.4,
    model: 'test-video-1',
  });
  return {
    kind: 'media',
    name: 'test-media',
    calls,
    async generateImage(request: { prompt: string }) {
      calls.push(`image:${request.prompt.slice(0, 40)}`);
      return job(newId('job'));
    },
    async generateVideo(request: { prompt: string }) {
      calls.push(`video:${request.prompt.slice(0, 40)}`);
      return job(newId('job'));
    },
    async editImage() {
      return job(newId('job'));
    },
    async getJob(jobId: string) {
      return job(jobId);
    },
    async waitForJob(jobId: string) {
      return job(jobId);
    },
    async estimateCost() {
      return 0.4;
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  } as unknown as GenerativeMediaProvider & { calls: string[] };
}

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

async function workspace(store: Store): Promise<Project> {
  const now = new Date().toISOString();
  const organization = await store.organizations.create({
    id: newId('org'), name: 'Relay', slug: `relay-${newId('org').slice(-6)}`, planId: 'pro',
    stripeCustomerId: null, creditBalance: 5000, maxProjectCostUsd: 50, isSuspended: false, createdAt: now,
  });
  const user = await store.users.create({
    id: newId('usr'), email: `lead-${newId('usr').slice(-6)}@relay.example`, name: 'Lead',
    avatarUrl: null, isSuperAdmin: false, createdAt: now,
  });
  const brand = await store.brands.create(
    BrandSystem.parse({
      id: newId('brd'),
      organizationId: organization.id,
      projectId: null,
      name: 'Relay',
      primaryColor: '#5b8cff',
      secondaryColor: '#101218',
      tone: 'Direct and unhurried.',
      createdAt: now,
      updatedAt: now,
    }),
  );
  return store.projects.create({
    id: newId('prj'), organizationId: organization.id, createdByUserId: user.id, name: 'Relay',
    websiteUrl: 'https://relay.example/', supplementalUrls: [], brandId: brand.id,
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
}

function scene(over: Partial<Scene> = {}): Scene {
  return Scene.parse({
    id: newId('scn'),
    storyboardId: 'sbd_placeholder',
    index: 0,
    purpose: 'the world before',
    startTime: 0,
    duration: 4,
    visualType: 'generated_broll',
    motionRecipe: { name: 'footage' },
    cameraRecipe: {},
    onScreenText: [],
    narration: '',
    assetRefs: [],
    generativeNeeds: [],
    status: 'ready',
    notes: '',
    ...over,
  });
}

async function storyboardWith(store: Store, project: Project, scenes: Scene[]): Promise<Storyboard> {
  const now = new Date().toISOString();
  const id = newId('sbd');
  // Stamped on the scenes as well: a scene is found by the board it belongs to.
  const owned = scenes.map((one) => ({ ...one, storyboardId: id }));
  return store.storyboards.create(
    Storyboard.parse({
      id,
      projectId: project.id,
      conceptId: newId('cpt'),
      treatmentId: newId('cpt'),
      version: 1,
      scenes: owned,
      language: 'en',
      createdAt: now,
      updatedAt: now,
    }),
    project.organizationId,
  );
}

describe('a shot that lost its material gets it back', () => {
  it('asks a provider, stores the bytes, and puts the reference on the scene', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-repair-'));
    const store = new MemoryStore();
    const project = await workspace(store);

    // Bytes a provider can be fetched from, so nothing here is a stub of the
    // ingest path: storage really does go and get them.
    const payload = Buffer.alloc(512, 7);
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(payload.length) });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/shot.mp4`;
    const media = fakeMedia(url);

    try {
      const registry = new ProviderRegistry({
        overrides: { storage: new LocalFsStorageProvider({ root }), media },
      });
      const stage = context(store, registry, project);

      // The shot as it stood: one generated clip, already made once.
      const original = await storeAsset(stage, {
        data: new Uint8Array([0, 1, 2, 3]),
        kind: 'generated_video', origin: 'generated', rights: 'generated_derivative',
        extension: 'mp4', contentType: 'video/mp4',
      });
      const shot = scene({
        assetRefs: [original.asset.id],
        generativeNeeds: [
          {
            kind: 'video',
            brief: 'A relay of hands passing a package across a loading bay at dawn.',
            mustNotContainText: true,
            referenceAssetIds: [],
            durationSeconds: 4,
            aspect: '16:9',
            resolvedProvider: null,
            resolvedModel: null,
            estimatedCostUsd: 0.4,
          },
        ],
      });
      const storyboard = await storyboardWith(store, project, [shot]);
      await store.projects.update(project.organizationId, project.id, { activeStoryboardId: storyboard.id });

      /*
       * The finding the render loop would have: the shot's material is gone.
       * The plan's answer is to make it again.
       */
      const applied = applyRepairs(storyboard, {
        scenes: [
          {
            sceneId: shot.id,
            action: 'regenerate_shot',
            reason: 'The clip is missing from storage.',
            issueId: newId('evt'),
            check: 'asset_resolution',
            escalated: false,
          },
        ],
        film: [],
        manual: [],
        state: 'repairing',
        shippable: false,
        deadEnd: false,
      });

      expect(applied.needsProvider).toEqual([{ sceneId: shot.id, action: 'regenerate_shot' }]);
      const stripped = applied.storyboard.scenes[0]!;
      expect(stripped.assetRefs).toEqual([]);
      expect(stripped.status).toBe('assets_pending');

      // What the render loop does with that list, which for a long time was nothing.
      await store.storyboards.replaceScenes(project.organizationId, storyboard.id, applied.storyboard.scenes);
      const result = await runSceneAssets(stage, { storyboardId: storyboard.id, sceneIds: [shot.id] });

      expect(media.calls).toHaveLength(1);
      expect(media.calls[0]).toMatch(/^video:/);
      expect(result.generated).toBe(1);
      expect(result.failed).toBe(0);

      const after = await store.storyboards.get(project.organizationId, storyboard.id);
      const repaired = after!.scenes[0]!;
      expect(repaired.assetRefs).toHaveLength(1);
      expect(repaired.assetRefs[0]).not.toBe(original.asset.id);

      // And the bytes are really there, which is the whole point: a reference
      // to an object storage cannot produce is what started all of this.
      const asset = await store.assets.get(project.organizationId, repaired.assetRefs[0]!);
      expect(asset).not.toBeNull();
      expect(await registry.storage().exists(asset!.storageKey)).toBe(true);
      expect(asset!.bytes).toBe(payload.length);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not ask a provider for a shot that still has its material', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-repair-keep-'));
    const store = new MemoryStore();
    const project = await workspace(store);
    const media = fakeMedia('http://127.0.0.1:1/never');

    try {
      const registry = new ProviderRegistry({
        overrides: { storage: new LocalFsStorageProvider({ root }), media },
      });
      const stage = context(store, registry, project);
      const kept = await storeAsset(stage, {
        data: new Uint8Array([9, 9, 9, 9]),
        kind: 'generated_video', origin: 'generated', rights: 'generated_derivative',
        extension: 'mp4', contentType: 'video/mp4',
      });
      const shot = scene({
        assetRefs: [kept.asset.id],
        generativeNeeds: [
          {
            kind: 'video', brief: 'Unchanged.', mustNotContainText: true, referenceAssetIds: [],
            durationSeconds: 4, aspect: '16:9', resolvedProvider: null, resolvedModel: null,
            estimatedCostUsd: 0.4,
          },
        ],
      });
      const storyboard = await storyboardWith(store, project, [shot]);

      const result = await runSceneAssets(stage, { storyboardId: storyboard.id, sceneIds: [shot.id] });
      expect(media.calls).toEqual([]);
      expect(result.generated).toBe(0);
      expect(result.skipped).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
