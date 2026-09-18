import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Project, Scene, Storyboard, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import {
  LocalFsStorageProvider,
  NullCostSink,
  ProviderRegistry,
  ScriptedLlmProvider,
  pcmToWav,
  type CallContext,
  type SpeechProvider,
  type SpeechRecognizer,
  type SpeechRequest,
  type SpeechResult,
  type VoiceConsent,
} from '@act-one/providers';
import { runAudioEdition } from '../stages/audio-edition.ts';
import type { StageContext } from '../context.ts';

/**
 * The audio edition stage, end to end: the script written for the ear
 * (with a figure the film never made refused), the passages read, stitched
 * with the pauses the paragraphs ask for, mastered, kept as an asset, and
 * the record updated — all against a synthesiser for a voice and real
 * FFmpeg for the rest.
 */
const SAMPLE_RATE = 24_000;

function tone(seconds: number): Uint8Array {
  const total = Math.round((0.15 + seconds + 0.2) * SAMPLE_RATE);
  const pcm = new Uint8Array(total * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const inside = t >= 0.15 && t < 0.15 + seconds;
    view.setInt16(i * 2, inside ? Math.round(9000 * Math.sin(2 * Math.PI * 200 * t)) : 0, true);
  }
  return pcmToWav(pcm, SAMPLE_RATE);
}

class FakeVoice implements SpeechProvider {
  readonly name = 'fake-voice';
  readonly kind = 'speech' as const;
  readonly requests: SpeechRequest[] = [];
  readonly consents: VoiceConsent[] = [];
  async health() {
    return { provider: this.name, kind: 'speech' as const, healthy: true, checkedAt: new Date().toISOString() };
  }
  async synthesize(request: SpeechRequest, _context: CallContext): Promise<SpeechResult> {
    this.requests.push(request);
    // Long enough for the length of the line, so the meter does not call the read cut short.
    const seconds = Math.max(0.6, request.text.length / 18);
    return {
      audio: tone(seconds),
      contentType: 'audio/wav',
      durationSecondsEstimate: seconds,
      costUsd: request.text.length * 0.00015,
      model: 'fake-v3',
      voiceId: request.voiceId ?? 'fake_default',
      characters: request.text.length,
      requestId: null,
    };
  }
  async synthesizeWithVoice(request: SpeechRequest & { voiceId: string }, consent: VoiceConsent, context: CallContext) {
    this.consents.push(consent);
    return this.synthesize(request, context);
  }
}

let root = '';
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'act-one-edition-'));
});

async function setup(options: { planId: string; llm: ScriptedLlmProvider; brandVoice?: 'library' | 'clone' | 'revoked' }) {
  const store = new MemoryStore();
  const organizationId = newId('org');
  const userId = newId('usr');
  await store.organizations.create({
    id: organizationId, name: 'Northwind', slug: `northwind-${organizationId.slice(-6)}`, planId: options.planId,
    stripeCustomerId: null, creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  });
  const project = await store.projects.create(
    Project.parse({
      id: newId('prj'), organizationId, createdByUserId: userId, name: 'Northwind', websiteUrl: 'https://northwind.example',
      brief: { durationSeconds: 45, language: 'en', voiceGender: 'female' }, stage: 'rendering',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
  );
  const storyboardId = newId('sbd');
  const scene = (index: number, narration: string, onScreenText: string[]) =>
    Scene.parse({
      id: newId('scn'), storyboardId, index, startTime: index * 4, duration: 4, purpose: 'the argument', narration, onScreenText,
      visualType: 'kinetic_typography', motionRecipe: { name: 'hold' }, cameraRecipe: {}, voiceOver: true,
    });
  const storyboard = await store.storyboards.create(
    Storyboard.parse({
      id: storyboardId, projectId: project.id, conceptId: newId('cpt'), treatmentId: `trt_${storyboardId.slice(-8)}`, version: 1,
      language: 'en', voiceStrategy: 'narrator', status: 'approved',
      scenes: [
        scene(0, 'Northwind closes the books without a week of manual matching.', ['Close the books.']),
        scene(1, 'Teams close their books 3x faster. Trusted by 400 finance teams.', []),
      ],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    organizationId,
  );
  await store.projects.update(organizationId, project.id, { activeStoryboardId: storyboard.id });

  let brandVoiceId: string | null = null;
  if (options.brandVoice) {
    let consentId: string | null = null;
    if (options.brandVoice !== 'library') {
      const consent = await store.voiceConsents.create({
        id: newId('vcs'), organizationId, projectId: null, subjectName: 'Amine', grantedByUserId: userId, scope: 'organization',
        providerVoiceId: 'v_clone', grantedAt: new Date().toISOString(), revokedAt: null,
      });
      if (options.brandVoice === 'revoked') await store.voiceConsents.revoke(organizationId, consent.id);
      consentId = consent.id;
    }
    const now = new Date().toISOString();
    const voice = await store.brandVoices.create({
      id: newId('bvc'), organizationId, name: 'Founder', provider: 'fake-voice', voiceId: consentId ? 'v_clone' : 'v_lib',
      language: 'en', locale: null, gender: 'male', profile: 'warm', style: null, pace: null, useCases: [], consentId,
      sampleAssetId: null, isDefault: true, createdAt: now, updatedAt: now,
    });
    brandVoiceId = voice.id;
    await store.voiceSettings.save({
      organizationId, pronunciations: [{ term: 'Northwind', say: 'North-wind', language: null }], defaultBrandVoiceId: voice.id, updatedAt: now,
    });
  }

  const voice = new FakeVoice();
  // An ear that agrees with the script, so no passage is read twice and nothing leaves the process.
  const ear: SpeechRecognizer = {
    name: 'fake-ear',
    kind: 'speech',
    async health() {
      return { provider: 'fake-ear', kind: 'speech', healthy: true, checkedAt: new Date().toISOString() };
    },
    async transcribe() {
      const last = voice.requests.at(-1);
      return { text: last?.text ?? '', language: 'en', languageConfidence: 0.99, durationSeconds: null, words: [], model: 'fake-ear' };
    },
  };
  const registry = new ProviderRegistry({
    costSink: new NullCostSink(),
    overrides: { llm: options.llm, speech: voice, recognizer: ear, storage: new LocalFsStorageProvider({ root }) },
  });
  const context: StageContext = {
    store, registry, organizationId,
    project: (await store.projects.get(organizationId, project.id))!,
    jobId: newId('job'), progress: async () => {},
  };
  return { store, context, voice, organizationId, project, brandVoiceId };
}

const SCRIPT = {
  title: 'Northwind, in a minute',
  paragraphs: [
    'Northwind closes the books without a week of manual matching.',
    'Teams close their books 3x faster. Trusted by 400 finance teams.',
    'Find it at northwind.example.',
  ],
};

describe('the audio edition', () => {
  it('writes the piece for the ear, reads it, masters it and keeps it', async () => {
    const llm = new ScriptedLlmProvider([{ respond: SCRIPT }]);
    const { store, context, voice, organizationId, project } = await setup({ planId: 'pro', llm });
    const result = await runAudioEdition(context);

    expect(result.assetId).toMatch(/^ast_/);
    expect(result.durationSeconds).toBeGreaterThan(3);
    const edition = (await store.audioEditions.get(organizationId, result.editionId))!;
    expect(edition).toMatchObject({ status: 'completed', title: 'Northwind, in a minute', language: 'en', provider: 'fake-voice', assetId: result.assetId });
    expect(edition.script).toEqual(SCRIPT.paragraphs);
    expect(edition.integratedLufs).toBeLessThan(0);
    expect(edition.costUsd).toBeGreaterThan(0);

    // Three paragraphs, three passages, read in order with the audio-edition direction.
    expect(voice.requests).toHaveLength(3);
    expect(voice.requests.map((request) => request.direction?.context)).toEqual(['audio_edition', 'audio_edition', 'audio_edition']);
    expect(voice.requests[0]?.text).toBe('Northwind closes the books without a week of manual matching.');
    expect(voice.requests[1]?.text).toBe('Teams close their books three times faster. Trusted by four hundred finance teams.');
    expect(voice.requests[0]?.quality).toBe('final');

    const asset = (await store.assets.get(organizationId, result.assetId!))!;
    expect(asset).toMatchObject({ kind: 'audio_edition', contentType: 'audio/mpeg', projectId: project.id });
    expect(asset.bytes).toBeGreaterThan(1000);
    expect(asset.metadata).toMatchObject({ editionId: edition.id, passages: 3, scriptFallback: false });
    const file = path.join(root, asset.storageKey);
    expect((await stat(file)).size).toBe(asset.bytes);
    // The passages are kept too, as the voice's own assets.
    expect(await store.assets.listForProject(organizationId, project.id, 'audio_voice')).toHaveLength(3);
  });

  it('refuses a script that invents a figure and reads the film’s own narration instead', async () => {
    const llm = new ScriptedLlmProvider([
      { respond: { ...SCRIPT, paragraphs: ['Northwind closes the books.', 'Trusted by 4000 finance teams since 2019.'] } },
    ]);
    const { store, context, voice, organizationId } = await setup({ planId: 'pro', llm });
    const result = await runAudioEdition(context);
    const edition = (await store.audioEditions.get(organizationId, result.editionId))!;
    expect(edition.script).toEqual([
      'Northwind closes the books without a week of manual matching.',
      'Teams close their books 3x faster. Trusted by 400 finance teams.',
    ]);
    expect(voice.requests).toHaveLength(2);
    const asset = (await store.assets.get(organizationId, result.assetId!))!;
    expect(asset.metadata['scriptFallback']).toBe(true);
  });

  it('reads with the brand voice, applies the workspace’s pronunciations, and carries a clone’s consent', async () => {
    const llm = new ScriptedLlmProvider([{ respond: SCRIPT }]);
    const { context, voice } = await setup({ planId: 'pro', llm, brandVoice: 'clone' });
    await runAudioEdition(context);
    expect(voice.consents).toHaveLength(3);
    expect(voice.consents[0]).toMatchObject({ subjectName: 'Amine', scope: 'organization', revokedAt: null });
    expect(voice.requests[0]?.voiceId).toBe('v_clone');
    expect(voice.requests[0]?.text).toBe('North-wind closes the books without a week of manual matching.');
    expect(voice.requests[0]?.direction?.gender).toBe('male');
  });

  it('will not read with a cloned voice whose consent was revoked', async () => {
    const llm = new ScriptedLlmProvider([{ respond: SCRIPT }]);
    const { store, context, voice, organizationId } = await setup({ planId: 'pro', llm, brandVoice: 'revoked' });
    await expect(runAudioEdition(context)).rejects.toThrow(/revoked/);
    expect(voice.requests).toHaveLength(0);
    const [edition] = await store.audioEditions.listForProject(organizationId, context.project.id);
    expect(edition).toMatchObject({ status: 'failed' });
    expect(edition?.error).toMatch(/consent/);
  });

  it('is not made on a plan without audio editions', async () => {
    const llm = new ScriptedLlmProvider([{ respond: SCRIPT }]);
    const { context, voice } = await setup({ planId: 'launch', llm });
    await expect(runAudioEdition(context)).rejects.toThrow(/audio editions/);
    expect(voice.requests).toHaveLength(0);
  });
});
