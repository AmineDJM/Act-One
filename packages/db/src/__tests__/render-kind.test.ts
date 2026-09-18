import { describe, it, expect, beforeEach } from 'vitest';
import { newId, type Render } from '@act-one/core';
import { MemoryStore } from '../memory-store.ts';

function render(organizationId: string, projectId: string, over: Partial<Render> = {}): Render {
  const now = new Date().toISOString();
  return {
    id: newId('rnd'),
    projectId,
    storyboardId: 'sbd_1',
    organizationId,
    kind: 'film',
    version: 1,
    aspect: '16:9',
    quality: 'hd',
    fps: 30,
    status: 'completed',
    masterAssetId: newId('ast'),
    posterAssetId: null,
    captionsAssetId: null,
    watermarked: false,
    durationSeconds: 60,
    costUsd: 0,
    qaReportId: null,
    error: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    ...over,
  };
}

/**
 * A film, a campaign cut and a timing animatic are all rows in the same table,
 * and for a while nothing could tell them apart. That is how a customer on a
 * one-render plan could spend their film on a preview of the storyboard, and
 * how the project page came to offer a six-second bumper as the deliverable.
 */
describe('render kind', () => {
  let store: MemoryStore;
  const org = 'org_kind';
  const project = 'prj_kind';

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('counts films against the plan, not cuts or animatics', async () => {
    await store.renders.create(render(org, project));
    await store.renders.create(render(org, project, { kind: 'cut', durationSeconds: 6 }));
    await store.renders.create(render(org, project, { kind: 'animatic', quality: 'preview' }));

    expect(await store.renders.countForProject(org, project)).toBe(1);
  });

  it('defaults to a film, so an unmarked render is never free', async () => {
    const now = new Date().toISOString();
    const parsed = (await import('@act-one/core')).Render.parse({
      id: newId('rnd'),
      projectId: project,
      storyboardId: 'sbd_1',
      organizationId: org,
      version: 1,
      status: 'completed',
      createdAt: now,
    });

    expect(parsed.kind).toBe('film');
  });

  it('keeps every kind in the list for the project, newest first', async () => {
    const film = await store.renders.create(
      render(org, project, { createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    const cut = await store.renders.create(
      render(org, project, { kind: 'cut', createdAt: '2026-01-02T00:00:00.000Z' }),
    );

    const all = await store.renders.listForProject(org, project);
    expect(all.map((r) => r.id)).toEqual([cut.id, film.id]);
  });
});
