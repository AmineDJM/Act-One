'use server';

import { revalidatePath } from 'next/cache';
import { FILM_LANGUAGES, VoiceGender, directVoice } from '@act-one/core';
import { ProviderConfig, hasVoiceLibrary, type LibraryVoice } from '@act-one/providers';
import { requireSession, requireSuperAdmin } from '@/server/auth.ts';
import { buildRegistry, getPlatformConfig, savePlatformConfig } from '@/server/platform.ts';
import { getStore } from '@/server/store.ts';
import { reportError } from '@/server/report.ts';
import type { ActionResult } from '../actions.ts';

/**
 * Voice configuration, for staff.
 *
 * What the engines are, what they may do, and which voices read each
 * language and accent. The customer never sees a vendor name; the operator
 * sees nothing else, because that is who decides what finals cost.
 */
export type CurateResult = ActionResult & {
  candidates?: (LibraryVoice & { language: string })[];
};

function recordAdmin(actorUserId: string, event: string, message: string, detail: Record<string, unknown> = {}): void {
  getStore().log.recordSafely({
    level: 'info',
    source: 'admin',
    event,
    message,
    organizationId: null,
    projectId: null,
    jobId: null,
    actorUserId,
    durationMs: null,
    detail,
  });
}

export async function saveVoiceConfigAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const current = await getPlatformConfig();
  const parsed = ProviderConfig.safeParse({
    ...current.providers,
    speech: {
      ...current.providers.speech,
      primary: String(formData.get('speech.primary') ?? current.providers.speech.primary),
      preview: String(formData.get('speech.preview') ?? current.providers.speech.preview),
      recognizer: String(formData.get('speech.recognizer') ?? current.providers.speech.recognizer),
      cloning: formData.get('speech.cloning') === 'on',
      takes: Number(formData.get('speech.takes') ?? current.providers.speech.takes),
      maxRegenerations: Number(formData.get('speech.maxRegenerations') ?? current.providers.speech.maxRegenerations),
      maxCostPerProjectUsd: Number(formData.get('speech.maxCostPerProjectUsd') ?? current.providers.speech.maxCostPerProjectUsd),
    },
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  await savePlatformConfig({ providers: parsed.data }, user.id);
  recordAdmin(user.id, 'voice.config_saved', 'Voice configuration saved.', {
    primary: parsed.data.speech.primary,
    preview: parsed.data.speech.preview,
    recognizer: parsed.data.speech.recognizer,
    cloning: parsed.data.speech.cloning,
    takes: parsed.data.speech.takes,
  });
  revalidatePath('/admin/voice');
  revalidatePath('/admin/providers');
  return { ok: true, message: 'Saved. The next narration uses it.' };
}

/** Voices in the premium engine's library for a language, to curate from. */
export async function searchLibraryAction(_previous: CurateResult | null, formData: FormData): Promise<CurateResult> {
  const session = await requireSession();
  if (!session.user.isSuperAdmin) return { ok: false, message: 'Not found.' };
  const code = String(formData.get('language') ?? '').trim().toLowerCase();
  const language = FILM_LANGUAGES.some((entry) => entry.code === code) ? code : 'en';
  const genderValue = String(formData.get('gender') ?? '');
  const gender = VoiceGender.options.includes(genderValue as never) ? (genderValue as 'female' | 'male') : null;
  const locale = String(formData.get('locale') ?? '').trim() || null;
  try {
    const registry = await buildRegistry({ organizationId: session.organizationId });
    const engine = registry.speech('final');
    if (!hasVoiceLibrary(engine)) {
      return { ok: false, message: 'The engine reading finals has no library to curate from. Choose ElevenLabs for finals and save its key.' };
    }
    const voices = await engine.searchVoices({ language, gender, locale, limit: 16 }, { organizationId: session.organizationId });
    return {
      ok: true,
      message: voices.length === 0 ? 'Nothing in the library for that language.' : `${voices.length} voices.`,
      candidates: voices.map((voice) => ({ ...voice, language })),
    };
  } catch (error) {
    return { ok: false, message: reportError('searchLibraryAction', error).publicMessage };
  }
}

/** Makes a voice the one that reads a locale or language, for a gender and a profile. */
export async function curateVoiceAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.user.isSuperAdmin) return { ok: false, message: 'Not found.' };
  const key = String(formData.get('key') ?? '').trim();
  const genderValue = String(formData.get('gender') ?? '');
  const profile = String(formData.get('profile') ?? 'premium');
  const voiceId = String(formData.get('voiceId') ?? '').trim();
  const publicOwnerId = String(formData.get('publicOwnerId') ?? '').trim() || null;
  const name = String(formData.get('name') ?? '').trim();
  if (!key || !voiceId) return { ok: false, message: 'A language or locale and a voice are needed.' };
  if (!VoiceGender.options.includes(genderValue as never)) return { ok: false, message: 'Choose a gender.' };
  if (!['premium', 'warm', 'neutral'].includes(profile)) return { ok: false, message: 'Choose a profile.' };
  const gender = genderValue as 'female' | 'male';

  try {
    let id = voiceId;
    if (publicOwnerId) {
      // A shared voice has to be in the account before it can read.
      const registry = await buildRegistry({ organizationId: session.organizationId });
      const engine = registry.speech('final');
      if (hasVoiceLibrary(engine)) {
        ({ voiceId: id } = await engine.addVoice({ id: voiceId, publicOwnerId, name }, { organizationId: session.organizationId }));
      }
    }
    const current = await getPlatformConfig();
    const curated = { ...current.providers.speech.curated };
    const entry = { ...(curated[key] ?? {}) };
    entry[gender] = { ...(entry[gender] ?? {}), [profile]: { voiceId: id, name } };
    curated[key] = entry;
    const parsed = ProviderConfig.safeParse({ ...current.providers, speech: { ...current.providers.speech, curated } });
    if (!parsed.success) return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join('; ') };
    await savePlatformConfig({ providers: parsed.data }, session.user.id);
    recordAdmin(session.user.id, 'voice.curated', `${name || id} now reads ${key} (${gender}, ${profile}).`, { key, gender, profile, voiceId: id });
    revalidatePath('/admin/voice');
    return { ok: true, message: `${name || id} now reads ${key} for a ${gender === 'female' ? 'woman’s' : 'man’s'} ${profile} voice.` };
  } catch (error) {
    return { ok: false, message: reportError('curateVoiceAction', error).publicMessage };
  }
}

export async function uncurateVoiceAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const key = String(formData.get('key') ?? '');
  const gender = String(formData.get('gender') ?? '') as 'female' | 'male';
  const profile = String(formData.get('profile') ?? '') as 'premium' | 'warm' | 'neutral';
  const current = await getPlatformConfig();
  const curated = { ...current.providers.speech.curated };
  const entry = curated[key];
  if (!entry?.[gender]?.[profile]) return { ok: false, message: 'Nothing curated there.' };
  const profiles = { ...entry[gender] };
  delete profiles[profile];
  const next = { ...entry, [gender]: profiles };
  if (Object.keys(profiles).length === 0) delete next[gender];
  if (Object.keys(next).length === 0) delete curated[key];
  else curated[key] = next;
  const parsed = ProviderConfig.safeParse({ ...current.providers, speech: { ...current.providers.speech, curated } });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join('; ') };
  await savePlatformConfig({ providers: parsed.data }, user.id);
  recordAdmin(user.id, 'voice.uncurated', `Curated voice removed for ${key} (${gender}, ${profile}).`, { key, gender, profile });
  revalidatePath('/admin/voice');
  return { ok: true, message: 'Removed. The library is searched for that case again.' };
}

export type BenchmarkResult = ActionResult & {
  reads?: { engine: string; model: string; ms: number; costUsd: number; dataUrl: string }[];
};

/**
 * The same line, the same direction, every engine with a key: a blind
 * comparison for the operator's ears, kept out of storage on purpose.
 */
export async function benchmarkVoicesAction(_previous: BenchmarkResult | null, formData: FormData): Promise<BenchmarkResult> {
  const session = await requireSession();
  if (!session.user.isSuperAdmin) return { ok: false, message: 'Not found.' };
  const text = String(formData.get('text') ?? '').trim().slice(0, 300);
  if (text.length < 4) return { ok: false, message: 'Give it a line to read.' };
  const code = String(formData.get('language') ?? '').trim().toLowerCase();
  const language = FILM_LANGUAGES.some((entry) => entry.code === code) ? code : 'en';
  const genderValue = String(formData.get('gender') ?? '');
  const gender = VoiceGender.options.includes(genderValue as never) ? (genderValue as 'female' | 'male') : null;
  const direction = directVoice({ context: 'launch_film', language, gender });

  try {
    const registry = await buildRegistry({ organizationId: session.organizationId });
    const engines = new Map<string, ReturnType<typeof registry.speech>>();
    for (const tier of ['final', 'preview'] as const) {
      const engine = registry.speech(tier);
      engines.set(engine.name, engine);
    }
    const reads: NonNullable<BenchmarkResult['reads']> = [];
    for (const engine of engines.values()) {
      const started = Date.now();
      try {
        const result = await engine.synthesize(
          { text, persona: 'narrator_neutral', direction, quality: 'final', format: 'mp3', language, gender: direction.gender },
          { organizationId: session.organizationId },
        );
        reads.push({
          engine: engine.name,
          model: result.model,
          ms: Date.now() - started,
          costUsd: result.costUsd,
          dataUrl: `data:${result.contentType};base64,${Buffer.from(result.audio).toString('base64')}`,
        });
      } catch (error) {
        reads.push({ engine: engine.name, model: (error as Error).message.slice(0, 120), ms: Date.now() - started, costUsd: 0, dataUrl: '' });
      }
    }
    recordAdmin(session.user.id, 'voice.benchmarked', `Benchmarked ${reads.length} engine(s) on one line.`, { language, characters: text.length });
    return { ok: true, message: `${reads.filter((read) => read.dataUrl).length} of ${reads.length} engines read it.`, reads };
  } catch (error) {
    return { ok: false, message: reportError('benchmarkVoicesAction', error).publicMessage };
  }
}
