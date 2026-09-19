import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { createProject } from '../projects.ts';
import {
  adoptBrandVoice,
  cloneBrandVoice,
  parsePronunciations,
  produceAudioEdition,
  removeBrandVoice,
  savePronunciations,
} from '../voice.ts';

/**
 * The voice's doors, at the layer that holds them.
 *
 * A brand voice, a clone and an audio edition are each behind a role and an
 * entitlement; a clone is also behind the platform's switch and the consent
 * the member states in words. Every refusal is the right kind of refusal —
 * a permission, an entitlement, a validation — because the page turns each
 * into a different next step.
 */
let store: MemoryStore;
let addresses = 0;

async function founder(name: string): Promise<Session> {
  resetRequest();
  addresses += 1;
  request().headers.set('x-forwarded-for', `203.0.113.${addresses}`);
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

const sample = { data: new Uint8Array([82, 73, 70, 70]), contentType: 'audio/wav', filename: 'take.wav' };

beforeEach(async () => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
  addresses = 0;
  resetRequest();
  // The first account on a fresh install is the operator, and the operator's
  // own workspace is not held to a plan. These doors are a customer's doors,
  // so the suite opens the install first and signs the customer up second.
  await founder('operator');
});

describe('a brand voice', () => {
  it('needs the role, then the plan', async () => {
    const owner = await founder('ada');
    const reviewer: Session = { ...owner, role: 'reviewer', actor: { ...owner.actor, role: 'reviewer' } };
    const adopt = {
      voice: { id: 'marin', publicOwnerId: null, name: 'Marin' },
      language: 'fr',
      locale: 'fr-FR',
      gender: 'female' as const,
      profile: 'premium' as const,
      style: null,
      pace: null,
      useCases: [],
      makeDefault: true,
    };
    expect((await failure(adoptBrandVoice(reviewer, adopt))).code).toBe('forbidden');
    // Free has no brand voice: an entitlement, not a permission.
    expect((await failure(adoptBrandVoice(owner, adopt))).code).toBe('entitlement_required');

    await store.organizations.update(owner.organizationId, { planId: 'pro' });
    const voice = await adoptBrandVoice(owner, adopt);
    expect(voice).toMatchObject({ name: 'Marin', language: 'fr', isDefault: true, consentId: null, provider: 'openai-speech' });
    expect((await store.voiceSettings.get(owner.organizationId))?.defaultBrandVoiceId).toBe(voice.id);

    await removeBrandVoice(owner, voice.id);
    expect(await store.brandVoices.list(owner.organizationId)).toEqual([]);
    expect((await store.voiceSettings.get(owner.organizationId))?.defaultBrandVoiceId).toBeNull();
  });

  it('keeps the pronunciations the organisation writes down', async () => {
    const owner = await founder('ada');
    expect(parsePronunciations('Ornikar = Or-nee-car\nAmine → Ah-meen [fr]\nnonsense line\n')).toEqual([
      { term: 'Ornikar', say: 'Or-nee-car', language: null },
      { term: 'Amine', say: 'Ah-meen', language: 'fr' },
    ]);
    const settings = await savePronunciations(owner, 'Northwind = North-wind');
    expect(settings.pronunciations).toEqual([{ term: 'Northwind', say: 'North-wind', language: null }]);
  });
});

describe('cloning a voice', () => {
  it('is refused without the plan, the platform switch and the stated consent — in that order', async () => {
    const owner = await founder('ada');
    const clone = {
      name: 'Founder',
      subjectName: 'Amine',
      confirmed: false,
      scope: 'organization' as const,
      projectId: null,
      language: 'fr',
      gender: 'male' as const,
      samples: [sample],
    };
    expect((await failure(cloneBrandVoice(owner, clone))).code).toBe('entitlement_required');
    await store.organizations.update(owner.organizationId, { planId: 'studio' });
    // Studio may clone; the platform has it switched off by default.
    expect((await failure(cloneBrandVoice(owner, clone))).code).toBe('forbidden');
    await store.platform.updateSettings(
      { providerConfig: { speech: { primary: 'openai-speech', cloning: true } } },
      owner.user.id,
    );
    const unconfirmed = await failure(cloneBrandVoice(owner, clone));
    expect(unconfirmed.code).toBe('validation_failed');
    expect(unconfirmed.publicMessage).toMatch(/agreed/);
    // Confirmed, but the engine reading finals here cannot clone: nothing is recorded as consented to a vendor that never got it.
    expect((await failure(cloneBrandVoice(owner, { ...clone, confirmed: true }))).code).toBe('provider_unavailable');
    expect(await store.voiceConsents.list(owner.organizationId)).toEqual([]);
  });
});

describe('an audio edition', () => {
  it('needs the plan and a storyboard, and is queued once', async () => {
    const owner = await founder('ada');
    const project = await createProject(owner, { websiteUrl: 'https://northwind.example' });
    expect((await failure(produceAudioEdition(owner, project))).code).toBe('entitlement_required');
    await store.organizations.update(owner.organizationId, { planId: 'pro' });
    expect((await failure(produceAudioEdition(owner, project))).code).toBe('conflict');

    const withBoard = await store.projects.update(owner.organizationId, project.id, { activeStoryboardId: 'sbd_1' });
    const first = await produceAudioEdition(owner, withBoard);
    expect(first.status).toBe('queued');
    // Asking again while it is being read returns the same edition rather than a second job.
    expect((await produceAudioEdition(owner, withBoard)).id).toBe(first.id);
    const jobs = await store.jobs.listForProject(owner.organizationId, project.id);
    expect(jobs.filter((job) => job.kind === 'produce_audio')).toHaveLength(1);
    expect(jobs.find((job) => job.kind === 'produce_audio')?.payload).toMatchObject({ editionId: first.id, storyboardId: 'sbd_1' });

    const reviewer: Session = { ...owner, role: 'reviewer', actor: { ...owner.actor, role: 'reviewer' } };
    expect((await failure(produceAudioEdition(reviewer, withBoard))).code).toBe('forbidden');
  });
});
