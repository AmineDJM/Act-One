import { describe, it, expect } from 'vitest';
import {
  Concept,
  CreativeTreatment,
  Scene,
  Storyboard,
  newId,
  type NewOrganization,
  type Project,
  type User,
} from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * A storyboard read back on the film's own clock.
 *
 * A storyboard is stored as a bag of scenes; the timeline is a property of the
 * order they are in, not of whatever `startTime` each row was written with.
 * Only the Postgres store used to say so on the way out, and the difference
 * was invisible until temporal QA started reading `startTime` off a scene:
 * against Postgres a finding at two seconds named the shot that plays at two
 * seconds, and against the memory store it named whichever shot happened to
 * carry a matching number — so a repair trimmed the wrong shot, and the local
 * proof of the repair loop was measuring the wrong film.
 *
 * Both stores now resequence on read. This suite is here so they cannot drift
 * apart again, because the drift does not fail anything loudly: it produces a
 * plausible film with the edit in the wrong place.
 */
function org(name: string): NewOrganization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(name: string): User {
  return {
    id: newId('usr'), email: uniqueEmail('lead', `${name.toLowerCase()}.example`), name, avatarUrl: null,
    isSuperAdmin: false, createdAt: new Date().toISOString(),
  };
}

function project(organizationId: string, userId: string, name: string): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'), organizationId, createdByUserId: userId, name,
    websiteUrl: `https://${name.toLowerCase()}.example/`,
    supplementalUrls: [], brandId: null, productUnderstandingId: null, selectedConceptId: null,
    activeStoryboardId: null, latestRenderId: null, stage: 'created',
    brief: {
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null,
      keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
      voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null,
      tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
    createdAt: now, updatedAt: now,
  };
}

/** Three shots written with nothing but a duration, which is how a planner writes them. */
function scene(storyboardId: string, index: number, duration: number): Scene {
  return Scene.parse({
    id: newId('scn'), storyboardId, index, startTime: 0, duration,
    purpose: `beat ${index}`, narration: '', onScreenText: [`Shot ${index}`],
    visualType: 'kinetic_typography', motionRecipe: { name: 'hold' }, cameraRecipe: {},
    voiceOver: false, transition: 'cut',
  });
}

async function boarded(store: Store, name: string, durations: number[]) {
  const now = new Date().toISOString();
  const organization = await store.organizations.create(org(name));
  const member = await store.users.create(user(name));
  const made = await store.projects.create(project(organization.id, member.id, name));

  const [concept] = await store.concepts.createMany(
    [
      Concept.parse({
        id: newId('cpt'), projectId: made.id, name, keyIdea: 'An idea about reconciliation',
        hook: 'The books are already closed.', targetEmotion: 'relief', productAngle: 'The close, end to end.',
        narrativeStructure: 'problem_shift_proof', visualDirection: 'Ledger type on near-black.',
        motionDirection: 'Cuts on the beat.', soundDirection: 'Room tone.', productUiUsage: 'The real close screen.',
        generativeUsage: 'none', creativeSystem: 'kinetic_product', estimatedDurationSeconds: 30,
        recommendedChannels: ['homepage_hero'], keyScenes: ['The pile', 'The run', 'The empty desk'],
        createdAt: now,
      }),
    ],
    organization.id,
  );
  const treatment = await store.treatments.create(
    CreativeTreatment.parse({
      id: newId('cpt'), conceptId: concept!.id, projectId: made.id, title: name, tagline: 'Close it once.',
      visualLanguage: 'Ledger type on near-black.', typographyDirection: 'One grotesque, two weights.',
      cameraLanguage: 'Locked off.', rhythm: 'Even, then a held beat.', motionStyleNotes: 'Nothing eases.',
      soundStyle: 'Room tone and one low note.', voiceStrategy: 'none', generativeMediaStrategy: 'none',
      productUiUsage: 'The real close screen.', cta: 'See it close.', createdAt: now,
    }),
    organization.id,
  );

  const storyboardId = newId('sbd');
  await store.storyboards.create(
    Storyboard.parse({
      id: storyboardId, projectId: made.id, conceptId: concept!.id, treatmentId: treatment.id,
      version: 1, scenes: durations.map((duration, index) => scene(storyboardId, index, duration)),
      createdAt: now, updatedAt: now,
    }),
    organization.id,
  );
  return { organizationId: organization.id, projectId: made.id, storyboardId };
}

describe.each(storeCases())('a storyboard is read back on the clock ($name)', ({ open, close }) => {
  it('lays the shots end to end whatever start times were written', async () => {
    const store = await open();
    try {
      // Every shot written at zero, which is what the probe fixture did and
      // what a planner that only sets durations does.
      const { organizationId, storyboardId } = await boarded(store, 'Northwind', [2, 6, 2]);

      const read = await store.storyboards.get(organizationId, storyboardId);
      expect(read!.scenes.map((s) => s.startTime)).toEqual([0, 2, 8]);
      expect(read!.scenes.map((s) => s.index)).toEqual([0, 1, 2]);
    } finally {
      await close(store);
    }
  });

  it('re-lays them after a repair changes one duration', async () => {
    const store = await open();
    try {
      const { organizationId, storyboardId } = await boarded(store, 'Westwind', [2, 6, 2]);
      const before = await store.storyboards.get(organizationId, storyboardId);

      // What `trim_hold` does: one shot gets shorter and everything after it
      // moves up. A page that read stale start times would draw the old edit.
      const trimmed = before!.scenes.map((s, index) => (index === 1 ? { ...s, duration: 1.2 } : s));
      const replaced = await store.storyboards.replaceScenes(organizationId, storyboardId, trimmed);
      expect(replaced.scenes.map((s) => s.startTime)).toEqual([0, 2, 3.2]);

      const reread = await store.storyboards.get(organizationId, storyboardId);
      expect(reread!.scenes.map((s) => s.startTime)).toEqual([0, 2, 3.2]);
    } finally {
      await close(store);
    }
  });

  it('gives every board of a project the same clock as a single read', async () => {
    const store = await open();
    try {
      const { organizationId, projectId, storyboardId } = await boarded(store, 'Eastwind', [3, 1.5, 4]);
      const [listed] = await store.storyboards.listForProject(organizationId, projectId);
      const read = await store.storyboards.get(organizationId, storyboardId);
      expect(listed!.scenes.map((s) => s.startTime)).toEqual(read!.scenes.map((s) => s.startTime));
      expect(listed!.scenes.map((s) => s.startTime)).toEqual([0, 3, 4.5]);
    } finally {
      await close(store);
    }
  });
});
