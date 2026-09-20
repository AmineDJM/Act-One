import { describe, it, expect } from 'vitest';
import {
  CreativePreference,
  CreativeSignature,
  CreativeTerritory,
  CriticReview,
  DirectorDecision,
  newId,
  signatureKey,
  type NewOrganization,
  type Project,
  type User,
} from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The reasoning, read back.
 *
 * Everything the director decided used to live for exactly as long as the job
 * that decided it. The film was kept and the thinking was thrown away, so
 * "why does this end on silence" had no answer and a direction rejected for
 * being off-brand was rejected again on the next film for the same reason.
 *
 * Two properties matter here and neither is obvious. A rejected territory is
 * kept — it is the negative half of a preference dataset and the half nobody
 * keeps. And a creative signature is scoped to the organisation and to nothing
 * wider: what one customer's films have done is never a reason to change
 * another customer's film.
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

async function workspace(store: Store, name: string) {
  const organization = await store.organizations.create(org(name));
  const member = await store.users.create(user(`lead@${name.toLowerCase()}.example`));
  const made = await store.projects.create(project(organization.id, member.id, name));
  return { organizationId: organization.id, projectId: made.id };
}

function territory(name: string, mechanism: CreativeTerritory['mechanism']): CreativeTerritory {
  return CreativeTerritory.parse({
    id: newId('ter'),
    name,
    premise: `${name}: a premise about closing the books once.`,
    mechanism,
    rationale: 'It answers the objection the audience actually has.',
    emotion: 'relief',
    productRole: 'evidence',
    opening: 'A ledger, already closed.',
    risk: 'It could read as cold.',
    createdAt: new Date().toISOString(),
  });
}

describe.each(storeCases())('creative intelligence ($name)', ({ open, close }) => {
  it('keeps the brief, the audience and the genome, latest version first', async () => {
    const store = await open();
    try {
      const { organizationId, projectId } = await workspace(store, 'Northwind');

      await store.creative.putModel(organizationId, {
        id: newId('cbf'), projectId, kind: 'brief', version: 1,
        data: { creativeObjective: 'first' }, createdAt: '2026-01-01T00:00:00.000Z',
      });
      await store.creative.putModel(organizationId, {
        id: newId('cbf'), projectId, kind: 'brief', version: 2,
        data: { creativeObjective: 'second' }, createdAt: '2026-01-02T00:00:00.000Z',
      });
      await store.creative.putModel(organizationId, {
        id: newId('aud'), projectId, kind: 'audience', version: 1,
        data: { who: 'finance leads' }, createdAt: '2026-01-01T00:00:00.000Z',
      });

      // A brief revised mid-production is two assignments, and the work made
      // under each stays attributable to the one it was made under.
      expect(await store.creative.latestModel(organizationId, projectId, 'brief')).toMatchObject({
        creativeObjective: 'second',
      });
      expect(await store.creative.latestModel(organizationId, projectId, 'audience')).toMatchObject({
        who: 'finance leads',
      });
      expect(await store.creative.latestModel(organizationId, projectId, 'genome')).toBeNull();
    } finally {
      await close(store);
    }
  });

  it('keeps the directions that died, with the reason each one died', async () => {
    const store = await open();
    try {
      const { organizationId, projectId } = await workspace(store, 'Southwind');

      const chosen = territory('The quiet close', 'data_proof');
      const dropped = territory('The loud close', 'contrarian_statement');
      await store.creative.putTerritories(organizationId, projectId, [
        { territory: chosen, kept: true, selected: true, rejectionReason: null },
        { territory: dropped, kept: false, selected: false, rejectionReason: 'off_brand' },
      ]);

      const read = await store.creative.listTerritories(organizationId, projectId);
      expect(read).toHaveLength(2);
      expect(read.find((row) => row.selected)?.territory.name).toBe('The quiet close');
      const rejected = read.find((row) => !row.kept);
      expect(rejected?.rejectionReason).toBe('off_brand');
      // The whole territory survives, not a summary of it: a rejected idea is
      // only a useful negative example if you can still read what it was.
      expect(rejected?.territory.premise).toContain('closing the books');
    } finally {
      await close(store);
    }
  });

  it('keeps what each specialist said and what the director did about it', async () => {
    const store = await open();
    try {
      const { organizationId, projectId } = await workspace(store, 'Eastwind');
      const artifactId = newId('ter');

      await store.creative.putReviews(organizationId, [
        CriticReview.parse({
          id: newId('crv'), projectId, artifactKind: 'territory', artifactId,
          critic: 'conversion', verdict: 'revise',
          findings: [{ severity: 'high', observation: 'The call to action is invisible.', evidence: ['shot_07'], confidence: 0.8 }],
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        CriticReview.parse({
          id: newId('crv'), projectId, artifactKind: 'territory', artifactId,
          critic: 'film', verdict: 'pass', findings: [],
          createdAt: '2026-01-01T00:00:01.000Z',
        }),
      ]);

      await store.creative.putDecision(
        organizationId,
        DirectorDecision.parse({
          id: newId('ddn'), projectId, stage: 'territories',
          decision: 'Kept the ending silent.',
          reason: 'A stated call to action would land on the beat the film was built to hold.',
          selected: artifactId,
          arbitrations: [
            {
              between: ['conversion', 'film'],
              conflict: 'Conversion wants a spoken call to action; film says it destroys the payoff.',
              resolution: 'The product and the address are on screen; nothing is spoken.',
            },
          ],
          createdAt: '2026-01-01T00:00:02.000Z',
        }),
      );

      const reviews = await store.creative.listReviews(organizationId, projectId);
      expect(reviews.map((review) => review.critic).sort()).toEqual(['conversion', 'film']);
      expect(reviews.find((review) => review.critic === 'conversion')?.findings[0]?.evidence).toEqual(['shot_07']);

      const [decision] = await store.creative.listDecisions(organizationId, projectId);
      // The disagreement and its resolution, which is the part worth more
      // later than either opinion was.
      expect(decision?.arbitrations[0]?.between).toEqual(['conversion', 'film']);
      expect(decision?.arbitrations[0]?.resolution).toContain('nothing is spoken');
    } finally {
      await close(store);
    }
  });

  it('never lets one workspace’s devices reach another', async () => {
    const store = await open();
    try {
      const mine = await workspace(store, 'Mine');
      const theirs = await workspace(store, 'Theirs');

      const device = 'opens on a held black frame with one word';
      await store.creative.putSignatures(mine.organizationId, [
        CreativeSignature.parse({
          id: newId('sig'), organizationId: mine.organizationId, projectId: mine.projectId,
          kind: 'opening', device, key: signatureKey('opening', device),
          createdAt: new Date().toISOString(),
        }),
      ]);

      expect(await store.creative.recentSignatures(mine.organizationId)).toHaveLength(1);
      expect(await store.creative.recentSignatures(theirs.organizationId)).toHaveLength(0);
    } finally {
      await close(store);
    }
  });

  it('keeps a pairwise judgement with the judge that made it', async () => {
    const store = await open();
    try {
      const { organizationId } = await workspace(store, 'Westwind');

      await store.creative.putPreference(
        organizationId,
        CreativePreference.parse({
          id: newId('cpf'), organizationId, briefId: 'cbf_1',
          artifactA: 'rnd_a', artifactB: 'rnd_b',
          judge: 'creative_director', winner: 'b', dimension: 'memorability',
          reason: 'B is the one anybody would describe to somebody else afterwards.',
          blind: true, createdAt: new Date().toISOString(),
        }),
      );

      const [preference] = await store.creative.listPreferences(organizationId);
      // The judge is kept because a customer's preference, a director's and an
      // evaluator's are three signals that must never be averaged into one.
      expect(preference?.judge).toBe('creative_director');
      expect(preference?.blind).toBe(true);
      expect(preference?.dimension).toBe('memorability');
    } finally {
      await close(store);
    }
  });
});
