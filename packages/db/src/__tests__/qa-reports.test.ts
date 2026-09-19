import { describe, it, expect } from 'vitest';
import {
  Concept,
  QaIssue,
  CreativeTreatment,
  Storyboard,
  newId,
  type NewOrganization,
  type Project,
  type QaReport,
  type Render,
  type User,
} from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The quality record, read back.
 *
 * Every render writes one of these — frames inspected, text measured, the
 * voice listened back to, a director asked whether the thing is any good —
 * and for a long time nothing ever read one again. The repair planner
 * consumed it inside the render loop and that was the end of it, which made
 * the quality bar the one thing in this product with no measurement behind
 * it.
 *
 * A workspace still reads only its own. The operator reads all of them,
 * because "which check fails across every film" is the question worth asking.
 */
function org(name: string): NewOrganization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(email: string): User {
  const [local = 'someone', domain = 'example.com'] = email.split('@');
  return {
    id: newId('usr'), email: uniqueEmail(local, domain), name: local, avatarUrl: null,
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

function render(organizationId: string, projectId: string, storyboardId: string): Render {
  const now = new Date().toISOString();
  return {
    id: newId('rnd'), projectId, storyboardId, organizationId, kind: 'film', version: 1,
    aspect: '16:9', quality: 'hd', fps: 30, status: 'completed', masterAssetId: null,
    posterAssetId: null, captionsAssetId: null, watermarked: false, durationSeconds: 30,
    costUsd: 0, qaReportId: null, error: null, startedAt: now, completedAt: now, createdAt: now,
  };
}

/**
 * A workspace with a film in it.
 *
 * The whole chain — concept, treatment, storyboard, render — because Postgres
 * holds a report to a real film by foreign key, and a fixture that invents the
 * ids proves nothing about the store production runs on.
 */
async function filmed(store: Store, name: string) {
  const now = new Date().toISOString();
  const organization = await store.organizations.create(org(name));
  const member = await store.users.create(user(`lead@${name.toLowerCase()}.example`));
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
  const storyboard = await store.storyboards.create(
    Storyboard.parse({
      id: newId('sbd'), projectId: made.id, conceptId: concept!.id, treatmentId: treatment.id,
      version: 1, scenes: [], createdAt: now, updatedAt: now,
    }),
    organization.id,
  );
  const cut = await store.renders.create(render(organization.id, made.id, storyboard.id));
  return { organization, project: made, render: cut };
}

function report(projectId: string, renderId: string, over: Partial<QaReport> = {}): QaReport {
  return {
    id: newId('ast'),
    renderId,
    projectId,
    passed: true,
    state: 'ready',
    attempt: 0,
    issues: [],
    repairs: [],
    extraCostUsd: 0,
    extraLatencyMs: 0,
    layers: [],
    framesInspected: 0,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function issue(check: QaIssue['check'], severity: QaIssue['severity']): QaIssue {
  return QaIssue.parse({ id: newId('ast'), check, severity, message: `${check} fired`, confidence: 0.9 });
}


describe.each(storeCases())('qa reports ($name)', ({ open, close }) => {
  it('reads back every verdict, newest first, with the workspace that earned it', async () => {
    const store = await open();
    try {
      const acme = await filmed(store, 'Acme');
      const rival = await filmed(store, 'Rival');
      await store.qaReports.create(
        report(acme.project.id, acme.render.id, {
          passed: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          issues: [issue('safe_area', 'hard_fail')],
        }),
        acme.organization.id,
      );
      await store.qaReports.create(
        report(rival.project.id, rival.render.id, { createdAt: '2026-06-01T00:00:00.000Z' }),
        rival.organization.id,
      );

      const all = await store.qaReports.list(50);
      const mine = all.filter(
        (r) => r.organizationId === acme.organization.id || r.organizationId === rival.organization.id,
      );
      expect(mine).toHaveLength(2);
      // Newest first: an operator opening this wants the last film, not the first.
      expect(mine[0]!.organizationId).toBe(rival.organization.id);
      expect(mine[1]).toMatchObject({ organizationId: acme.organization.id, passed: false });
      expect(mine[1]!.issues[0]).toMatchObject({ check: 'safe_area', severity: 'hard_fail' });
    } finally {
      await close(store);
    }
  });

  it('still shows a workspace only its own report', async () => {
    const store = await open();
    try {
      const acme = await filmed(store, 'Acme');
      const rival = await filmed(store, 'Rival');
      const theirs = await store.qaReports.create(
        report(rival.project.id, rival.render.id),
        rival.organization.id,
      );

      expect(await store.qaReports.get(acme.organization.id, theirs.id)).toBeNull();
      expect(await store.qaReports.getForRender(acme.organization.id, theirs.renderId)).toBeNull();
      expect(await store.qaReports.get(rival.organization.id, theirs.id)).toMatchObject({ id: theirs.id });
    } finally {
      await close(store);
    }
  });
});
