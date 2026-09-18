import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, BrandSystem, newId, type Project } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { createProject } from '../projects.ts';
import { brandStatusOf, componentsOf, confirmBrand, loadBrandOverview, reviewBrandSignal, updateBrandComponent } from '../brand.ts';

/**
 * The brand's doors and promises at the layer that keeps them: a role
 * decides who may edit; an edit marks its component as a person's; a
 * confirmation records when; a signal is applied only when accepted, and
 * a dismissed one stays dismissed.
 */
let store: MemoryStore;

async function founder(name: string): Promise<Session> {
  resetRequest();
  request().headers.set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  return signUp({ email: `${name}-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name });
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

async function measured(session: Session, project: Project) {
  const brand = await store.brands.create(
    BrandSystem.parse({
      id: newId('brd'), organizationId: session.organizationId, projectId: project.id, name: 'Acme',
      primaryColor: '#2f6fed', secondaryColor: '#0a0a0c', sources: ['https://acme.example/'],
      signals: [{ id: 'bsg_1', field: 'primaryColor', label: 'Primary colour', current: '#2f6fed', proposed: '#ff5f5f', reason: 'x', sourceUrl: null, projectId: project.id, foundAt: new Date().toISOString(), status: 'pending', decidedAt: null }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
  );
  await store.projects.update(session.organizationId, project.id, { brandId: brand.id });
  return brand;
}

beforeEach(() => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('the brand of a project', () => {
  it('shows every project with its brand’s state and picks the one that needs a person', async () => {
    const ada = await founder('Ada');
    const launch = await createProject(ada, { websiteUrl: 'https://acme.example' });
    const bare = await createProject(ada, { websiteUrl: 'https://other.example' });
    const brand = await measured(ada, launch);

    const overview = await loadBrandOverview(ada, null);
    expect(overview.projects.find((row) => row.id === launch.id)).toMatchObject({ status: 'NEEDS REVIEW', pending: 1, brandId: brand.id });
    expect(overview.projects.find((row) => row.id === bare.id)).toMatchObject({ status: 'NOT MEASURED', brandId: null });
    expect(overview.selected?.project.id).toBe(launch.id);
    expect(overview.selected?.signals).toHaveLength(1);
    expect(overview.selected?.components.find((component) => component.key === 'colors')).toMatchObject({ state: 'measured', pending: 1 });
    expect(brandStatusOf(null).status).toBe('NOT MEASURED');
  });

  it('lets editors change a component and remembers that a person did', async () => {
    const ada = await founder('Ada');
    const launch = await createProject(ada, { websiteUrl: 'https://acme.example' });
    const brand = await measured(ada, launch);
    const reviewer: Session = { ...ada, role: 'reviewer', actor: { ...ada.actor, role: 'reviewer' } };
    expect((await failure(updateBrandComponent(reviewer, brand.id, { component: 'colors', primaryColor: '#000000' }))).code).toBe('forbidden');

    const edited = await updateBrandComponent(ada, brand.id, { component: 'communication', tagline: 'Close the books.', wordsToAvoid: ['cheap'], tone: 'Dry.' });
    expect(edited.communication.tagline).toBe('Close the books.');
    expect(edited.tone).toBe('Dry.');
    expect(edited.overrides).toEqual(['communication']);
    const typed = await updateBrandComponent(ada, brand.id, { component: 'typography', display: 'Geist' });
    expect(typed.typography.find((font) => font.role === 'display')).toMatchObject({ family: 'Geist', renderFamily: 'Geist', source: 'user' });
    expect(typed.overrides).toEqual(['communication', 'typography']);
    expect(componentsOf(typed).find((component) => component.key === 'typography')?.state).toBe('edited');

    const grace = await founder('Grace');
    expect((await failure(updateBrandComponent(grace, brand.id, { component: 'colors', primaryColor: '#000000' }))).code).toBe('not_found');
  });

  it('confirms the whole, and decides a signal one way or the other', async () => {
    const ada = await founder('Ada');
    const launch = await createProject(ada, { websiteUrl: 'https://acme.example' });
    const brand = await measured(ada, launch);

    const confirmed = await confirmBrand(ada, brand.id);
    expect(confirmed.confirmedByUser).toBe(true);
    expect(confirmed.confirmedAt).not.toBeNull();
    // Still needs review: a confirmation does not decide the open reading.
    expect(brandStatusOf(confirmed).status).toBe('NEEDS REVIEW');

    const dismissed = await reviewBrandSignal(ada, brand.id, 'bsg_1', 'dismissed');
    expect(dismissed.primaryColor).toBe('#2f6fed');
    expect(dismissed.signals[0]).toMatchObject({ status: 'dismissed' });
    expect(brandStatusOf(dismissed).status).toBe('CONFIRMED');
    // Deciding it again changes nothing.
    expect((await reviewBrandSignal(ada, brand.id, 'bsg_1', 'accepted')).primaryColor).toBe('#2f6fed');

    const other = await measured(ada, await createProject(ada, { websiteUrl: 'https://acme.example/two' }));
    const accepted = await reviewBrandSignal(ada, other.id, 'bsg_1', 'accepted');
    expect(accepted.primaryColor).toBe('#ff5f5f');
    expect(accepted.overrides).toEqual([]);
    expect((await failure(reviewBrandSignal(ada, other.id, 'bsg_missing', 'accepted'))).code).toBe('not_found');
  });
});
