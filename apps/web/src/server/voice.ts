import 'server-only';
import {
  AppError,
  BrandVoice,
  PronunciationRule,
  VoiceSettings,
  can,
  languageName,
  newId,
  type AudioEdition,
  type NarrationContext,
  type Project,
  type VoiceConsentRecord,
  type VoiceGender,
} from '@act-one/core';
import { hasVoiceLibrary, type LibraryVoice, type VoiceConsent } from '@act-one/providers';
import type { Session } from './auth.ts';
import { getStore } from './store.ts';
import { buildRegistry, entitlementsFor, getPlatformConfig } from './platform.ts';
import { enqueue } from './projects.ts';

/**
 * The organisation's voice.
 *
 * A brand voice is one narrator kept across every film, cut and audio piece:
 * chosen from the engine's library, or a person's voice cloned under a
 * recorded consent. Three rules hold here and nowhere else can loosen them.
 *
 * Cloning needs the plan, the platform's say-so and the box the member
 * ticked naming the person — and the consent is written down before the
 * vendor is asked for anything. A consent revoked deletes the voice at the
 * vendor in the same breath, so there is no window where a voice outlives
 * the permission it was made under. And every one of these lands in the
 * operational log with who did it.
 */
export type VoiceOverview = {
  voices: BrandVoice[];
  consents: VoiceConsentRecord[];
  settings: VoiceSettings | null;
  /** What this workspace may do. */
  may: { brand: boolean; clone: boolean; editions: boolean };
  /** Whether the engine reading finals has a library to cast from. */
  library: boolean;
  planName: string;
};

export async function loadVoiceOverview(session: Session): Promise<VoiceOverview> {
  const store = getStore();
  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');
  const [{ plan, entitlements }, voices, consents, settings, config] = await Promise.all([
    entitlementsFor(organization),
    store.brandVoices.list(session.organizationId),
    store.voiceConsents.list(session.organizationId),
    store.voiceSettings.get(session.organizationId),
    getPlatformConfig(),
  ]);
  const registry = await buildRegistry({ organizationId: session.organizationId });
  return {
    voices,
    consents,
    settings,
    may: {
      brand: entitlements.has('voice.brand'),
      clone: entitlements.has('voice.clone') && config.providers.speech.cloning,
      editions: entitlements.has('audio.editions'),
    },
    library: hasVoiceLibrary(registry.speech('final')),
    planName: plan.name,
  };
}

/** The six voices the fallback engine has, offered when no library is. */
const BUILT_IN: LibraryVoice[] = (
  [
    ['marin', 'Marin', 'female', 'premium'],
    ['coral', 'Coral', 'female', 'warm'],
    ['sage', 'Sage', 'female', 'neutral'],
    ['cedar', 'Cedar', 'male', 'premium'],
    ['ash', 'Ash', 'male', 'warm'],
    ['onyx', 'Onyx', 'male', 'neutral'],
  ] as const
).map(([id, name, gender, useCase]) => ({
  id,
  name,
  publicOwnerId: null,
  language: null,
  locale: null,
  accent: null,
  gender,
  age: null,
  useCase,
  description: 'Directed to speak the language of the film natively.',
  previewUrl: null,
  category: 'built_in',
}));

export async function searchBrandVoices(
  session: Session,
  query: { language: string; gender: VoiceGender | null; locale?: string | null },
): Promise<LibraryVoice[]> {
  await requireBrandVoiceAccess(session, 'voice.brand');
  const registry = await buildRegistry({ organizationId: session.organizationId });
  const engine = registry.speech('final');
  if (!hasVoiceLibrary(engine)) {
    return BUILT_IN.filter((voice) => !query.gender || voice.gender === query.gender);
  }
  return engine.searchVoices(
    { language: query.language, gender: query.gender, locale: query.locale ?? null, limit: 12 },
    { organizationId: session.organizationId },
  );
}

export type AdoptInput = {
  voice: { id: string; publicOwnerId: string | null; name: string };
  language: string;
  locale: string | null;
  gender: VoiceGender;
  profile: BrandVoice['profile'];
  style: BrandVoice['style'];
  pace: BrandVoice['pace'];
  useCases: NarrationContext[];
  makeDefault: boolean;
};

/** Makes a library voice the organisation's: copied into the account when it is shared, recorded either way. */
export async function adoptBrandVoice(session: Session, input: AdoptInput): Promise<BrandVoice> {
  await requireBrandVoiceAccess(session, 'voice.brand');
  const store = getStore();
  const registry = await buildRegistry({ organizationId: session.organizationId });
  const engine = registry.speech('final');
  let voiceId = input.voice.id;
  if (hasVoiceLibrary(engine)) {
    ({ voiceId } = await engine.addVoice(input.voice, { organizationId: session.organizationId }));
  } else if (!BUILT_IN.some((voice) => voice.id === input.voice.id)) {
    throw new AppError('validation_failed', 'That voice is not one this workspace can use.');
  }
  const now = new Date().toISOString();
  const existing = await store.brandVoices.list(session.organizationId);
  const voice = await store.brandVoices.create(
    BrandVoice.parse({
      id: newId('bvc'),
      organizationId: session.organizationId,
      name: input.voice.name.trim().slice(0, 80) || 'Brand voice',
      provider: engine.name,
      voiceId,
      language: input.language.toLowerCase(),
      locale: input.locale,
      gender: input.gender,
      profile: input.profile,
      style: input.style,
      pace: input.pace,
      useCases: input.useCases,
      consentId: null,
      sampleAssetId: null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (input.makeDefault || existing.length === 0) await setDefaultBrandVoice(session, voice.id);
  record(session, 'voice.adopted', `Brand voice "${voice.name}" adopted for ${languageName(voice.language) ?? voice.language}.`, {
    brandVoiceId: voice.id,
    provider: voice.provider,
    voiceId,
  });
  return (await store.brandVoices.get(session.organizationId, voice.id)) ?? voice;
}

export type CloneInput = {
  name: string;
  subjectName: string;
  /** The box they had to tick: the named person has agreed to this. Not a formality. */
  confirmed: boolean;
  scope: 'organization' | 'project';
  projectId: string | null;
  language: string;
  gender: VoiceGender;
  samples: { data: Uint8Array; contentType: string; filename: string }[];
};

/**
 * Clones a person's voice. The consent record exists before the vendor is
 * called; the vendor's own check runs as well; and both the record and the
 * log say who granted it and for whom.
 */
export async function cloneBrandVoice(session: Session, input: CloneInput): Promise<BrandVoice> {
  await requireBrandVoiceAccess(session, 'voice.clone');
  const config = await getPlatformConfig();
  if (!config.providers.speech.cloning) {
    throw new AppError('forbidden', 'Voice cloning is switched off on this platform.');
  }
  if (!input.confirmed) {
    throw new AppError('validation_failed', 'Confirm that the person named has agreed to have their voice cloned.');
  }
  if (!input.subjectName.trim()) throw new AppError('validation_failed', 'Name the person whose voice this is.');
  if (input.samples.length === 0) throw new AppError('validation_failed', 'Add at least one recording of the person.');
  const bytes = input.samples.reduce((sum, sample) => sum + sample.data.byteLength, 0);
  if (bytes > 25 * 1024 * 1024) throw new AppError('validation_failed', 'Recordings must total under 25 MB.');
  if (input.scope === 'project' && !input.projectId) {
    throw new AppError('validation_failed', 'A project-scoped consent needs a project.');
  }

  const store = getStore();
  const registry = await buildRegistry({ organizationId: session.organizationId });
  const engine = registry.speech('final');
  if (!hasVoiceLibrary(engine)) {
    throw new AppError('provider_unavailable', 'The voice engine on this platform cannot clone voices.');
  }

  const consent = await store.voiceConsents.create({
    id: newId('vcs'),
    organizationId: session.organizationId,
    projectId: input.scope === 'project' ? input.projectId : null,
    subjectName: input.subjectName.trim(),
    grantedByUserId: session.user.id,
    scope: input.scope,
    providerVoiceId: null,
    grantedAt: new Date().toISOString(),
    revokedAt: null,
  });
  record(session, 'voice.consent_granted', `Consent recorded to clone the voice of ${consent.subjectName}.`, {
    consentId: consent.id,
    scope: consent.scope,
    projectId: consent.projectId,
  });

  let voiceId: string;
  try {
    ({ voiceId } = await engine.cloneVoice(
      {
        name: `${input.name.trim() || consent.subjectName} (${session.organizationId.slice(-6)})`,
        description: `Cloned under consent ${consent.id} for ${consent.subjectName}.`,
        samples: input.samples,
        language: input.language,
        labels: { gender: input.gender, organization: session.organizationId },
      },
      asProviderConsent(consent),
      { organizationId: session.organizationId, projectId: consent.projectId },
    ));
  } catch (error) {
    // No voice, no consent left dangling: it is revoked so nothing can be made under it later.
    await store.voiceConsents.revoke(session.organizationId, consent.id);
    throw error;
  }
  await store.voiceConsents.setProviderVoice(session.organizationId, consent.id, voiceId);

  const now = new Date().toISOString();
  const voice = await store.brandVoices.create(
    BrandVoice.parse({
      id: newId('bvc'),
      organizationId: session.organizationId,
      name: input.name.trim().slice(0, 80) || consent.subjectName,
      provider: engine.name,
      voiceId,
      language: input.language.toLowerCase(),
      locale: null,
      gender: input.gender,
      profile: 'warm',
      style: null,
      pace: null,
      useCases: [],
      consentId: consent.id,
      sampleAssetId: null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
  record(session, 'voice.cloned', `Voice of ${consent.subjectName} cloned as "${voice.name}".`, {
    brandVoiceId: voice.id,
    consentId: consent.id,
    provider: voice.provider,
  });
  return voice;
}

export async function setDefaultBrandVoice(session: Session, id: string): Promise<BrandVoice> {
  await requireBrandVoiceAccess(session, 'voice.brand');
  const store = getStore();
  const voice = await store.brandVoices.setDefault(session.organizationId, id);
  const settings = await store.voiceSettings.get(session.organizationId);
  await store.voiceSettings.save({
    organizationId: session.organizationId,
    pronunciations: settings?.pronunciations ?? [],
    defaultBrandVoiceId: voice.id,
    updatedAt: new Date().toISOString(),
  });
  return voice;
}

/** Removes a brand voice. A cloned one has its consent revoked and is deleted at the vendor first. */
export async function removeBrandVoice(session: Session, id: string): Promise<void> {
  await requireBrandVoiceAccess(session, 'voice.brand');
  const store = getStore();
  const voice = await store.brandVoices.get(session.organizationId, id);
  if (!voice) throw new AppError('not_found', 'Brand voice not found.');
  if (voice.consentId) {
    await store.voiceConsents.revoke(session.organizationId, voice.consentId);
    const registry = await buildRegistry({ organizationId: session.organizationId });
    const engine = registry.speech('final');
    if (hasVoiceLibrary(engine) && engine.name === voice.provider) {
      await engine.deleteVoice(voice.voiceId, { organizationId: session.organizationId });
    }
    record(session, 'voice.consent_revoked', `Consent revoked and the cloned voice "${voice.name}" deleted.`, {
      brandVoiceId: voice.id,
      consentId: voice.consentId,
    });
  } else {
    record(session, 'voice.removed', `Brand voice "${voice.name}" removed.`, { brandVoiceId: voice.id });
  }
  await store.brandVoices.remove(session.organizationId, id);
  const settings = await store.voiceSettings.get(session.organizationId);
  if (settings?.defaultBrandVoiceId === id) {
    await store.voiceSettings.save({ ...settings, defaultBrandVoiceId: null, updatedAt: new Date().toISOString() });
  }
}

/**
 * The organisation's pronunciations, one per line: `Ornikar = Or-nee-car`,
 * with an optional language in brackets: `Amine = Ah-meen [fr]`.
 */
export function parsePronunciations(text: string): PronunciationRule[] {
  const rules: PronunciationRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(.{1,80}?)\s*(?:=|→|->|:)\s*(.+?)\s*(?:\[([a-z]{2})\])?$/i);
    if (!match) continue;
    const parsed = PronunciationRule.safeParse({ term: match[1], say: match[2], language: match[3]?.toLowerCase() ?? null });
    if (parsed.success) rules.push(parsed.data);
    if (rules.length >= 200) break;
  }
  return rules;
}

export function formatPronunciations(rules: PronunciationRule[]): string {
  return rules.map((rule) => `${rule.term} = ${rule.say}${rule.language ? ` [${rule.language}]` : ''}`).join('\n');
}

export async function savePronunciations(session: Session, text: string): Promise<VoiceSettings> {
  if (!can(session.actor, 'brand:edit')) throw new AppError('forbidden', 'Your role cannot change the brand.');
  const store = getStore();
  const settings = await store.voiceSettings.get(session.organizationId);
  return store.voiceSettings.save(
    VoiceSettings.parse({
      organizationId: session.organizationId,
      pronunciations: parsePronunciations(text),
      defaultBrandVoiceId: settings?.defaultBrandVoiceId ?? null,
      updatedAt: new Date().toISOString(),
    }),
  );
}

/** Asks the worker for an audio edition of the film on this storyboard. */
export async function produceAudioEdition(
  session: Session,
  project: Project,
  options: { brandVoiceId?: string | null } = {},
): Promise<AudioEdition> {
  if (!can(session.actor, 'project:update')) throw new AppError('forbidden', 'Your role cannot produce an audio version.');
  const store = getStore();
  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');
  const { plan, entitlements } = await entitlementsFor(organization);
  if (!entitlements.has('audio.editions')) {
    throw new AppError('entitlement_required', `Audio versions are not included in ${plan.name}.`);
  }
  if (!project.activeStoryboardId) throw new AppError('conflict', 'There is no storyboard to read from yet.');
  const running = (await store.audioEditions.listForProject(session.organizationId, project.id)).find(
    (edition) => edition.status === 'queued' || edition.status === 'running',
  );
  if (running) return running;

  const edition = await store.audioEditions.create({
    id: newId('aed'),
    organizationId: session.organizationId,
    projectId: project.id,
    storyboardId: project.activeStoryboardId,
    status: 'queued',
    title: '',
    script: [],
    language: null,
    brandVoiceId: options.brandVoiceId ?? null,
    provider: null,
    voiceId: null,
    assetId: null,
    durationSeconds: 0,
    integratedLufs: null,
    costUsd: 0,
    findings: [],
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
  await enqueue(
    project,
    'produce_audio',
    {
      editionId: edition.id,
      storyboardId: project.activeStoryboardId,
      ...(options.brandVoiceId ? { brandVoiceId: options.brandVoiceId } : {}),
    },
    5,
  );
  return edition;
}

async function requireBrandVoiceAccess(session: Session, entitlement: 'voice.brand' | 'voice.clone'): Promise<void> {
  if (!can(session.actor, 'brand:edit')) throw new AppError('forbidden', 'Your role cannot change the brand voice.');
  const store = getStore();
  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');
  const { plan, entitlements } = await entitlementsFor(organization);
  if (!entitlements.has(entitlement)) {
    throw new AppError(
      'entitlement_required',
      entitlement === 'voice.clone'
        ? `Voice cloning is not included in ${plan.name}.`
        : `A brand voice is not included in ${plan.name}.`,
    );
  }
}

function asProviderConsent(consent: VoiceConsentRecord): VoiceConsent {
  return {
    subjectName: consent.subjectName,
    grantedByUserId: consent.grantedByUserId,
    organizationId: consent.organizationId,
    grantedAt: consent.grantedAt,
    revokedAt: consent.revokedAt,
    scope: consent.scope,
    projectId: consent.projectId,
  };
}

function record(session: Session, event: string, message: string, detail: Record<string, unknown>): void {
  getStore().log.recordSafely({
    level: 'info',
    source: 'web',
    event,
    message,
    organizationId: session.organizationId,
    projectId: null,
    jobId: null,
    actorUserId: session.user.id,
    durationMs: null,
    detail,
  });
}
