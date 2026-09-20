import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryStore } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
import { resolveAssetUrls, type StageContext } from '../context.ts';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import {
  needsMaterial,
  renderModeFor,
  summariseCoverage,
  visualReadiness,
} from '../master-readiness.ts';

/**
 * The film that made this file necessary.
 *
 * A customer's master came back as thirty seconds of white type on a black
 * frame with a silent audio track, and every check the system had said it was
 * fine — because every check read the plan, and in the plan those shots were
 * still the product. The storage the worker could see did not hold a single
 * one of the objects the database said it did.
 *
 * These tests are written against that shape of failure rather than against
 * that project.
 */

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'x', narration: '', onScreenText: [],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null,
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', language: 'fr', heroShot: null, musicDirection: '', parentStoryboardId: null,
    revisionReason: '', status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const productShot = (id: string, refs: string[]) =>
  scene({
    id, duration: 4, visualType: 'product_ui', assetRefs: refs,
    motionRecipe: { name: 'product_window', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.5, params: {} },
  });

const titleCard = (id: string, text: string) =>
  scene({ id, duration: 3, visualType: 'kinetic_typography', onScreenText: [text] });

describe('preview and master are different promises', () => {
  it('reads the render kind as the mode, and only the animatic is a preview', () => {
    expect(renderModeFor('animatic')).toBe('preview');
    expect(renderModeFor('film')).toBe('master');
    expect(renderModeFor('cut')).toBe('master');
    expect(renderModeFor('localised')).toBe('master');
  });

  it('lets a preview be incomplete and refuses to call the same cut a master', () => {
    const storyboard = board([productShot('a', ['ast_1']), titleCard('b', 'Once.')]);
    const args = { storyboard, resolved: new Set<string>(), missing: [
      { id: 'ast_1', reason: 'object_missing' as const, storageKey: 'org/prj/ast_1.png' },
    ] };

    expect(visualReadiness({ ...args, mode: 'preview' }).ready).toBe(true);

    const master = visualReadiness({ ...args, mode: 'master' });
    expect(master.ready).toBe(false);
    expect(master.blockers.map((blocker) => blocker.code)).toContain('asset_missing');
    // The blocker names the shot and where the bytes were supposed to be, so
    // an operator does not have to go and find out which asset it meant.
    expect(master.blockers[0]!.message).toContain('Shot 1');
    expect(master.blockers[0]!.message).toContain('org/prj/ast_1.png');
  });
});

describe('typography by intent is not typography by accident', () => {
  it('says nothing about a film the director wrote as type', () => {
    const readiness = visualReadiness({
      storyboard: board([titleCard('a', 'Close the books.'), titleCard('b', 'Once.')]),
      mode: 'master',
      resolved: new Set(),
      missing: [],
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.coverage.typographicByIntent).toBe(2);
    expect(readiness.coverage.shotsRequiringMaterial).toBe(0);
    expect(readiness.coverage.unresolved).toBe(0);
  });

  /*
   * The exact failure. Every shot was planned as the product, every asset row
   * existed, and not one object was in the storage the worker could reach.
   */
  it('refuses a master where every planned picture came back empty', () => {
    const storyboard = board([
      productShot('a', ['ast_1']),
      productShot('b', ['ast_2']),
      titleCard('c', 'Assurance.'),
    ]);
    const readiness = visualReadiness({
      storyboard,
      mode: 'master',
      resolved: new Set(),
      missing: [
        { id: 'ast_1', reason: 'object_missing', storageKey: 'org/prj/ast_1.png' },
        { id: 'ast_2', reason: 'object_missing', storageKey: 'org/prj/ast_2.png' },
      ],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.coverage).toMatchObject({
      shots: 3,
      shotsRequiringMaterial: 2,
      shotsWithMaterial: 0,
      typographicByIntent: 1,
      unresolved: 2,
      // Planned as almost three quarters product interface; delivered as none
      // of it. The two numbers used to be one number, which is the bug.
      plannedPictureShare: 8 / 11,
      pictureShare: 0,
    });
    // Two shot-level blockers and the film-level one, which is the finding no
    // per-shot check can make: this film shows nothing at all.
    expect(readiness.blockers.filter((blocker) => blocker.code === 'asset_missing')).toHaveLength(2);
    expect(readiness.blockers.some((blocker) => blocker.code === 'no_picture')).toBe(true);
  });

  it('one shot short of its material is a blocker and not a catastrophe', () => {
    const readiness = visualReadiness({
      storyboard: board([productShot('a', ['ast_1']), productShot('b', ['ast_2']), titleCard('c', 'Once.')]),
      mode: 'master',
      resolved: new Set(['ast_1']),
      missing: [{ id: 'ast_2', reason: 'no_such_asset', storageKey: '' }],
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual(['asset_missing']);
    expect(readiness.blockers[0]!.number).toBe(2);
    expect(readiness.blockers[0]!.message).toContain('never created');
    expect(readiness.coverage.shotsWithMaterial).toBe(1);
  });

  it('is satisfied by one reference of several, because a shot plays one thing', () => {
    const readiness = visualReadiness({
      storyboard: board([productShot('a', ['ast_1', 'ast_2'])]),
      mode: 'master',
      resolved: new Set(['ast_2']),
      missing: [{ id: 'ast_1', reason: 'object_missing', storageKey: 'k' }],
    });
    expect(readiness.ready).toBe(true);
  });

  it('knows which shots are containers for something', () => {
    expect(needsMaterial(productShot('a', []))).toBe(true);
    expect(needsMaterial(titleCard('b', 'Once.'))).toBe(false);
    expect(needsMaterial(scene({ id: 'c', duration: 2, visualType: 'logo_reveal' }))).toBe(false);
    expect(needsMaterial(scene({ id: 'd', duration: 6, visualType: 'generated_broll' }))).toBe(true);
  });

  it('summarises coverage in one line an operator can read', () => {
    const readiness = visualReadiness({
      storyboard: board([productShot('a', ['ast_1']), titleCard('b', 'Once.')]),
      mode: 'master',
      resolved: new Set(['ast_1']),
      missing: [],
    });
    expect(summariseCoverage(readiness.coverage)).toBe(
      '1/1 shots with material · 1 typographic by intent · 0 unresolved · 57% picture of 57% planned',
    );
  });
});

/**
 * A master may not be marked PREVIEW.
 *
 * The customer downloaded a file called master_video and read PREVIEW on
 * every frame of it. The watermark is legitimate — it is what a plan pays to
 * remove — but it was labelled as though the artifact were the wrong kind of
 * thing. This is a lint because the rule is about whatever somebody writes
 * there next, not about today's string.
 */
describe('what the watermark says', () => {
  it('never burns the word preview into a rendered film', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../stages/render.ts'),
      'utf8',
    );
    const labels = [...source.matchAll(/watermarkLabel:\s*[^\n]*?'([^']+)'/g)].map((match) => match[1]!);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain('preview');
    }
  });
});

/**
 * The root cause, exercised against a real store and real storage.
 *
 * Two services, two local disks, one shared database. The captures were
 * ingested by the web service, the rows were written where both could see
 * them, and the bytes existed on exactly one machine. `resolveAssetUrls` then
 * signed a URL for every row it found — a check of the database, not of the
 * film — the renderer fetched them, every fetch was an ENOENT, and each shot
 * quietly drew its line of copy instead.
 */
describe('an asset row is not an asset', () => {
  async function context() {
    const store = new MemoryStore();
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-readiness-'));
    const storage = new LocalFsStorageProvider({ root });
    const registry = new ProviderRegistry({ overrides: { storage } });
    const organizationId = 'org_1';
    const project = { id: 'prj_1' } as StageContext['project'];
    return {
      root,
      storage,
      ctx: {
        store, registry, organizationId, project, jobId: 'job_1',
        progress: async () => undefined,
        activity: async () => undefined,
      } as unknown as StageContext,
    };
  }

  const row = (id: string, storageKey: string) => ({
    id, organizationId: 'org_1', projectId: 'prj_1', conceptId: null, sceneId: null,
    kind: 'screenshot' as const, origin: 'captured' as const, rights: 'customer_owned' as const,
    storageKey, contentType: 'image/png', bytes: 4, width: 1280, height: 720,
    durationSeconds: null, provider: null, model: null, sourceUrl: null,
    costUsd: 0, metadata: {}, createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('does not offer the renderer a url for bytes that are not there', async () => {
    const { ctx, storage } = await context();
    await ctx.store.assets.create(row('ast_here', 'org_1/prj_1/here.png'));
    await ctx.store.assets.create(row('ast_gone', 'org_1/prj_1/gone.png'));
    await storage.put('org_1/prj_1/here.png', new Uint8Array([1, 2, 3, 4]), { contentType: 'image/png' });

    const resolved = await resolveAssetUrls(ctx, ['ast_here', 'ast_gone']);

    expect(Object.keys(resolved.urls)).toEqual(['ast_here']);
    expect(resolved.missing).toEqual([
      { id: 'ast_gone', reason: 'object_missing', storageKey: 'org_1/prj_1/gone.png' },
    ]);
  });

  it('says so when the id names no asset at all', async () => {
    const { ctx } = await context();
    const resolved = await resolveAssetUrls(ctx, ['ast_ghost']);
    expect(resolved.urls).toEqual({});
    expect(resolved.missing).toEqual([{ id: 'ast_ghost', reason: 'no_such_asset', storageKey: '' }]);
  });

  /*
   * End to end, on the shape of the production failure: every row present,
   * every object absent, a plan made of product shots. The master is refused
   * and the reason names the storage key, which is the one fact an operator
   * needs to see that their two services do not share a disk.
   */
  it('refuses the master when the database says yes and the storage says no', async () => {
    const { ctx } = await context();
    await ctx.store.assets.create(row('ast_1', 'org_1/prj_1/one.png'));
    await ctx.store.assets.create(row('ast_2', 'org_1/prj_1/two.png'));
    const storyboard = board([productShot('a', ['ast_1']), productShot('b', ['ast_2'])]);

    const { urls, missing } = await resolveAssetUrls(ctx, ['ast_1', 'ast_2']);
    const readiness = visualReadiness({
      storyboard, mode: 'master', resolved: new Set(Object.keys(urls)), missing,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.coverage.pictureShare).toBe(0);
    expect(readiness.coverage.plannedPictureShare).toBe(1);
    expect(readiness.blockers.map((blocker) => blocker.message).join(' ')).toContain('org_1/prj_1/one.png');

    // And the same material, as a preview, is simply a preview.
    expect(
      visualReadiness({ storyboard, mode: 'preview', resolved: new Set(), missing }).ready,
    ).toBe(true);
  });
});
