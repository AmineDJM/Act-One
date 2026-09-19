import { describe, it, expect } from 'vitest';
import { newId, type AudioEdition, type BrandVoice, type Organization, type User, type VoiceConsentRecord } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The voice's records, against every store: a brand voice belongs to one
 * workspace and one of them reads by default; a consent is revoked, never
 * lost; an audio edition is the project's; the pronunciations are the
 * organisation's own.
 */
function org(name: string): Organization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(email: string): User {
  const [local = 'someone', domain = 'example.com'] = email.split('@');
  return { id: newId('usr'), email: uniqueEmail(local, domain), name: local, avatarUrl: null, isSuperAdmin: false, createdAt: new Date().toISOString() };
}

function voice(organizationId: string, name: string, over: Partial<BrandVoice> = {}): BrandVoice {
  const now = new Date().toISOString();
  return {
    id: newId('bvc'), organizationId, name, provider: 'elevenlabs', voiceId: `v_${name.toLowerCase()}`, language: 'fr',
    locale: 'fr-FR', gender: 'female', profile: 'premium', style: null, pace: null, useCases: [], consentId: null,
    sampleAssetId: null, isDefault: false, createdAt: now, updatedAt: now, ...over,
  };
}

function consent(organizationId: string, grantedByUserId: string, subjectName: string): VoiceConsentRecord {
  return {
    id: newId('vcs'), organizationId, projectId: null, subjectName, grantedByUserId, scope: 'organization',
    providerVoiceId: null, grantedAt: new Date().toISOString(), revokedAt: null,
  };
}

function edition(organizationId: string, projectId: string): AudioEdition {
  return {
    id: newId('aed'), organizationId, projectId, storyboardId: null, status: 'queued', title: '', script: [],
    language: null, brandVoiceId: null, provider: null, voiceId: null, assetId: null, durationSeconds: 0,
    integratedLufs: null, costUsd: 0, findings: [], error: null, createdAt: new Date().toISOString(), completedAt: null,
  };
}

for (const kase of storeCases()) {
  describe(`the voice (${kase.name})`, () => {
    async function open(): Promise<{ store: Store; acme: Organization; rival: Organization; member: User }> {
      const store = await kase.open();
      const acme = await store.organizations.create(org('Acme'));
      const rival = await store.organizations.create(org('Rival'));
      const member = await store.users.create(user('lead@acme.com'));
      return { store, acme, rival, member };
    }

    it('keeps brand voices to their workspace and one of them by default', async () => {
      const { store, acme, rival } = await open();
      try {
        const camille = await store.brandVoices.create(voice(acme.id, 'Camille'));
        const marc = await store.brandVoices.create(voice(acme.id, 'Marc', { gender: 'male' }));
        expect(await store.brandVoices.get(rival.id, camille.id)).toBeNull();
        expect((await store.brandVoices.list(rival.id)).map((v) => v.id)).not.toContain(camille.id);

        await store.brandVoices.setDefault(acme.id, camille.id);
        await store.brandVoices.setDefault(acme.id, marc.id);
        const listed = await store.brandVoices.list(acme.id);
        expect(listed.filter((v) => v.isDefault).map((v) => v.name)).toEqual(['Marc']);
        expect(listed[0]?.name).toBe('Marc');

        const renamed = await store.brandVoices.update(acme.id, camille.id, { name: 'Camille (studio)', style: 'cinematic' });
        expect(renamed).toMatchObject({ name: 'Camille (studio)', style: 'cinematic', isDefault: false });
        await expect(store.brandVoices.update(rival.id, camille.id, { name: 'Stolen' })).rejects.toThrow();
        await expect(store.brandVoices.setDefault(rival.id, camille.id)).rejects.toThrow();

        await store.brandVoices.remove(rival.id, camille.id);
        expect(await store.brandVoices.get(acme.id, camille.id)).not.toBeNull();
        await store.brandVoices.remove(acme.id, camille.id);
        expect(await store.brandVoices.get(acme.id, camille.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('revokes a consent rather than losing it, and links it to the vendor voice', async () => {
      const { store, acme, rival, member } = await open();
      try {
        const granted = await store.voiceConsents.create(consent(acme.id, member.id, 'Amine'));
        expect(await store.voiceConsents.get(rival.id, granted.id)).toBeNull();
        const linked = await store.voiceConsents.setProviderVoice(acme.id, granted.id, 'v_clone_1');
        expect(linked.providerVoiceId).toBe('v_clone_1');
        const revoked = await store.voiceConsents.revoke(acme.id, granted.id);
        expect(revoked.revokedAt).toBeTruthy();
        // Revoking twice keeps the first moment.
        expect((await store.voiceConsents.revoke(acme.id, granted.id)).revokedAt).toBe(revoked.revokedAt);
        expect((await store.voiceConsents.list(acme.id)).map((c) => c.id)).toContain(granted.id);
        await expect(store.voiceConsents.revoke(rival.id, granted.id)).rejects.toThrow();
      } finally {
        await kase.close(store);
      }
    });

    it('holds the pronunciations and the default voice per workspace', async () => {
      const { store, acme, rival } = await open();
      try {
        expect(await store.voiceSettings.get(acme.id)).toBeNull();
        await store.voiceSettings.save({
          organizationId: acme.id,
          pronunciations: [{ term: 'Ornikar', say: 'Or-nee-car', language: null }],
          defaultBrandVoiceId: null,
          updatedAt: new Date().toISOString(),
        });
        await store.voiceSettings.save({
          organizationId: acme.id,
          pronunciations: [{ term: 'Ornikar', say: 'Or-nee-car', language: 'fr' }],
          defaultBrandVoiceId: 'bvc_x',
          updatedAt: new Date().toISOString(),
        });
        expect(await store.voiceSettings.get(acme.id)).toMatchObject({
          pronunciations: [{ term: 'Ornikar', say: 'Or-nee-car', language: 'fr' }],
          defaultBrandVoiceId: 'bvc_x',
        });
        expect(await store.voiceSettings.get(rival.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('lists a project’s audio editions newest first and updates their state', async () => {
      const { store, acme, rival, member } = await open();
      try {
        const project = await store.projects.create({
          id: newId('prj'), organizationId: acme.id, createdByUserId: member.id, name: 'Launch', websiteUrl: 'https://acme.example/',
          supplementalUrls: [], brandId: null, productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
          latestRenderId: null, stage: 'created',
          brief: {
            filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null, keyMessage: null, durationSeconds: null, channels: [], creativeMode: 'studio',
            voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null, tone: null,
            voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
          },
          productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        const first = await store.audioEditions.create(edition(acme.id, project.id));
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = await store.audioEditions.create(edition(acme.id, project.id));
        expect((await store.audioEditions.listForProject(acme.id, project.id)).map((e) => e.id)).toEqual([second.id, first.id]);
        expect(await store.audioEditions.listForProject(rival.id, project.id)).toEqual([]);
        const done = await store.audioEditions.update(acme.id, first.id, { status: 'completed', assetId: 'ast_1', durationSeconds: 71.5, script: ['One.', 'Two.'] });
        expect(done).toMatchObject({ status: 'completed', assetId: 'ast_1', durationSeconds: 71.5 });
        expect(await store.audioEditions.get(rival.id, first.id)).toBeNull();
        await expect(store.audioEditions.update(rival.id, first.id, { status: 'failed' })).rejects.toThrow();
      } finally {
        await kase.close(store);
      }
    });
  });
}
