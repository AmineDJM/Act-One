import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  directVoice,
  displayHost,
  newId,
  type AudioEdition,
  type BrandVoice,
} from '@act-one/core';
import { pauseAfter, segmentForSpeech, writeAudioEdition } from '@act-one/creative';
import type { VoiceConsent } from '@act-one/providers';
import { masterLoudness, runFfmpeg, stitchVoice } from '@act-one/sound';
import { storeAsset, type StageContext } from '../context.ts';
import { planAllows, planFor } from '../entitlements.ts';
import { narrate } from '../narration.ts';

/**
 * The audio edition stage.
 *
 * The film's argument, written again for the ear and read as one piece:
 * content, the spoken adaptation, the direction, the performance, QA, then
 * the master. The script is written from the storyboard the customer
 * approved and the facts they published, and read by the organisation's
 * brand voice when they have one — a cloned voice only under its consent.
 *
 * It is a deliverable of its own, kept as our asset with its script, its
 * loudness and what it cost, and it never touches the film.
 */
export async function runAudioEdition(
  context: StageContext,
  options: { editionId?: string; storyboardId?: string; brandVoiceId?: string | null } = {},
): Promise<{ editionId: string; assetId: string | null; durationSeconds: number }> {
  const { store, registry, project, organizationId } = context;

  const plan = await planFor(store, organizationId);
  if (!planAllows(plan, 'audio.editions')) {
    throw new AppError('entitlement_required', `${plan.name} does not include audio editions.`);
  }

  const storyboardId = options.storyboardId ?? project.activeStoryboardId;
  if (!storyboardId) throw new AppError('conflict', 'There is no storyboard to read from yet.');
  const storyboard = await store.storyboards.get(organizationId, storyboardId);
  if (!storyboard) throw new AppError('not_found', 'Storyboard not found.');

  const now = new Date().toISOString();
  const edition: AudioEdition =
    (options.editionId ? await store.audioEditions.get(organizationId, options.editionId) : null) ??
    (await store.audioEditions.create({
      id: newId('aed'),
      organizationId,
      projectId: project.id,
      storyboardId,
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
      createdAt: now,
      completedAt: null,
    }));
  await store.audioEditions.update(organizationId, edition.id, { status: 'running', error: null });

  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-audio-'));
  try {
    await context.progress(0.05, 'Reading the film');
    const [understanding, settings, voices] = await Promise.all([
      project.productUnderstandingId
        ? store.understandings.get(organizationId, project.productUnderstandingId)
        : store.understandings.getLatestForProject(organizationId, project.id),
      store.voiceSettings.get(organizationId),
      store.brandVoices.list(organizationId),
    ]);
    const language = storyboard.language ?? project.brief.language ?? 'en';

    await context.progress(0.15, 'Writing it for the ear');
    const script = await writeAudioEdition(
      registry.llm(),
      {
        storyboard,
        understanding,
        language,
        websiteHost: displayHost(project.websiteUrl),
        targetSeconds: Math.max(45, Math.min(180, (project.brief.durationSeconds ?? 60) * 1.5)),
      },
      { organizationId, projectId: project.id },
    );
    if (script.paragraphs.length === 0) {
      throw new AppError('conflict', 'The storyboard has no narration or on-screen copy to read.');
    }
    await store.audioEditions.update(organizationId, edition.id, {
      title: script.title,
      script: script.paragraphs,
      language,
    });

    // The voice: the brand's, when they chose one and it may read this; the brief's otherwise.
    const chosen = pickBrandVoice(voices, options.brandVoiceId ?? settings?.defaultBrandVoiceId ?? null, language);
    const consent = chosen?.consentId ? await consentFor(context, chosen) : null;
    if (chosen?.consentId && !consent) {
      throw new AppError('forbidden', `The consent behind the voice "${chosen.name}" has been revoked.`);
    }
    const direction = directVoice({
      context: 'audio_edition',
      language,
      accent: project.brief.voiceAccent ?? null,
      gender: chosen?.gender ?? project.brief.voiceGender ?? null,
      style: chosen?.style ?? project.brief.voiceStyle ?? null,
      pace: chosen?.pace ?? project.brief.voicePace ?? null,
      tone: project.brief.tone ?? null,
    });
    if (chosen?.locale) direction.locale = chosen.locale;

    const passages = segmentForSpeech(script.paragraphs.join('\n\n'));
    await context.progress(0.3, `Reading ${passages.length} passages`);
    const premium = planAllows(plan, 'voice.premium');
    const result = await narrate(context, {
      passages: passages.map((passage) => ({ id: `passage-${passage.index}`, text: passage.text })),
      direction,
      quality: premium ? 'final' : 'preview',
      context: 'audio_edition',
      workDir,
      takes: 1,
      regenerations: registry.config.speech.maxRegenerations,
      listenBack: premium,
      pronunciations: settings?.pronunciations ?? [],
      persona: 'narrator_neutral',
      ...(chosen ? { voiceId: chosen.voiceId } : {}),
      ...(consent ? { consent } : {}),
      label: 'audio',
    });
    if (result.tracks.length === 0) {
      throw new AppError('provider_unavailable', 'The voice could not read any of the piece.');
    }

    await context.progress(0.8, 'Stitching and mastering');
    const byPassage = new Map(result.tracks.map((track) => [track.passageId, track]));
    const segments = passages
      .map((passage) => {
        const track = byPassage.get(`passage-${passage.index}`);
        if (!track) return null;
        return {
          path: track.path,
          durationSeconds: track.durationSeconds,
          gapAfterSeconds: pauseAfter(passage),
          // The engine's dead air comes off; a breath stays.
          trimHeadSeconds: Math.max(0, track.headSilenceSeconds - 0.12),
          trimTailSeconds: Math.max(0, track.tailSilenceSeconds - 0.2),
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
    const stitched = path.join(workDir, 'edition.wav');
    await stitchVoice({
      segments,
      target: stitched,
      leadInSeconds: 0.4,
      leadOutSeconds: 1.2,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    // Spoken word for streaming: −16 LUFS integrated, −1 dBTP, the level the podcast platforms ask for.
    const mastered = path.join(workDir, 'edition-master.wav');
    const measured = await masterLoudness({
      source: stitched,
      target: mastered,
      lufs: -16,
      truePeak: -1.5,
      outputArgs: ['-c:a', 'pcm_s16le'],
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const encoded = path.join(workDir, 'edition.mp3');
    const encode = await runFfmpeg(
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', mastered, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '2', encoded],
      { ...(context.signal ? { signal: context.signal } : {}), timeoutMs: 10 * 60_000 },
    );
    if (!encode.ok) throw new AppError('internal', `Encoding the audio edition failed: ${encode.stderr.slice(-300)}`);

    const durationSeconds = Math.round(segments.reduce((sum, s) => sum + s.durationSeconds - (s.trimHeadSeconds ?? 0) - (s.trimTailSeconds ?? 0) + s.gapAfterSeconds, 0.4 + 1.2) * 10) / 10;
    const stored = await storeAsset(context, {
      data: new Uint8Array(await readFile(encoded)),
      kind: 'audio_edition',
      origin: 'rendered',
      rights: 'our_license',
      extension: 'mp3',
      contentType: 'audio/mpeg',
      durationSeconds,
      provider: result.usage.provider,
      model: result.usage.model,
      costUsd: result.usage.costUsd,
      metadata: {
        editionId: edition.id,
        title: script.title,
        language,
        voiceId: result.tracks[0]?.assetId ? (chosen?.voiceId ?? null) : null,
        integratedLufs: measured?.integratedLufs ?? null,
        truePeakDb: measured?.truePeakDb ?? null,
        passages: result.tracks.length,
        scriptFallback: script.fallback,
      },
    });

    const finished = await store.audioEditions.update(organizationId, edition.id, {
      status: 'completed',
      provider: result.usage.provider,
      voiceId: chosen?.voiceId ?? null,
      brandVoiceId: chosen?.id ?? null,
      assetId: stored.asset.id,
      durationSeconds,
      integratedLufs: measured?.integratedLufs ?? null,
      costUsd: result.usage.costUsd,
      findings: result.issues.map((issue) => ({ check: issue.check, severity: issue.severity, message: issue.message })),
      completedAt: new Date().toISOString(),
    });
    await context.progress(1, `${Math.round(durationSeconds)} seconds, read and mastered`);
    return { editionId: finished.id, assetId: finished.assetId, durationSeconds };
  } catch (error) {
    await store.audioEditions.update(organizationId, edition.id, {
      status: 'failed',
      error: error instanceof AppError ? error.publicMessage : 'The audio edition could not be produced.',
    });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** The brand voice to read with: the one asked for, or the default, when it speaks the language. */
function pickBrandVoice(voices: BrandVoice[], wantedId: string | null, language: string): BrandVoice | null {
  const wanted = wantedId ? voices.find((voice) => voice.id === wantedId) : null;
  const candidate = wanted ?? voices.find((voice) => voice.isDefault) ?? null;
  if (!candidate) return null;
  if (candidate.language.toLowerCase().slice(0, 2) !== language.toLowerCase().slice(0, 2)) return null;
  if (candidate.useCases.length > 0 && !candidate.useCases.includes('audio_edition')) return null;
  return candidate;
}

/** The consent a cloned voice was made under, as the provider wants it; null when revoked or missing. */
async function consentFor(context: StageContext, voice: BrandVoice): Promise<VoiceConsent | null> {
  if (!voice.consentId) return null;
  const record = await context.store.voiceConsents.get(context.organizationId, voice.consentId);
  if (!record || record.revokedAt) return null;
  return {
    subjectName: record.subjectName,
    grantedByUserId: record.grantedByUserId,
    organizationId: record.organizationId,
    grantedAt: record.grantedAt,
    revokedAt: record.revokedAt,
    scope: record.scope,
    projectId: record.projectId,
  };
}
