'use server';

import { revalidatePath } from 'next/cache';
import { FILM_LANGUAGES, NarrationContext, VoiceGender, VoicePace, VoiceStyle } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import {
  adoptBrandVoice,
  cloneBrandVoice,
  removeBrandVoice,
  savePronunciations,
  searchBrandVoices,
  setDefaultBrandVoice,
} from '@/server/voice.ts';

export type VoiceCandidate = {
  id: string;
  publicOwnerId: string | null;
  name: string;
  accent: string | null;
  gender: 'female' | 'male' | null;
  age: string | null;
  useCase: string | null;
  description: string | null;
  previewUrl: string | null;
  locale: string | null;
};

export type VoiceFormState = {
  error: string | null;
  message?: string;
  candidates?: VoiceCandidate[];
  /** What the search was for, so the adopt form can carry it. */
  query?: { language: string; gender: 'female' | 'male' | null };
};

function language(formData: FormData, fallback = 'en'): string {
  const code = String(formData.get('language') ?? '').trim().toLowerCase();
  return FILM_LANGUAGES.some((candidate) => candidate.code === code) ? code : fallback;
}

function gender(formData: FormData): 'female' | 'male' | null {
  const value = String(formData.get('gender') ?? '');
  return VoiceGender.options.includes(value as never) ? (value as 'female' | 'male') : null;
}

export async function searchVoicesAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    const query = { language: language(formData), gender: gender(formData) };
    const voices = await searchBrandVoices(session, query);
    return {
      error: null,
      query,
      candidates: voices.map((voice) => ({
        id: voice.id,
        publicOwnerId: voice.publicOwnerId,
        name: voice.name,
        accent: voice.accent,
        gender: voice.gender,
        age: voice.age,
        useCase: voice.useCase,
        description: voice.description,
        previewUrl: voice.previewUrl,
        locale: voice.locale,
      })),
      message: voices.length === 0 ? 'No voice in the library speaks that language yet.' : undefined,
    };
  } catch (error) {
    return { error: reportError('searchVoicesAction', error).publicMessage };
  }
}

export async function adoptVoiceAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    const style = String(formData.get('style') ?? '');
    const pace = String(formData.get('pace') ?? '');
    const profile = String(formData.get('profile') ?? 'premium');
    const useCases = formData
      .getAll('useCases')
      .map(String)
      .filter((value): value is NarrationContext => NarrationContext.options.includes(value as never));
    const voice = await adoptBrandVoice(session, {
      voice: {
        id: String(formData.get('voiceId') ?? ''),
        publicOwnerId: String(formData.get('publicOwnerId') ?? '') || null,
        name: String(formData.get('name') ?? ''),
      },
      language: language(formData),
      locale: String(formData.get('locale') ?? '') || null,
      gender: gender(formData) ?? 'female',
      profile: profile === 'warm' || profile === 'neutral' ? profile : 'premium',
      style: VoiceStyle.options.includes(style as never) ? (style as VoiceStyle) : null,
      pace: VoicePace.options.includes(pace as never) ? (pace as VoicePace) : null,
      useCases,
      makeDefault: formData.get('makeDefault') === 'on',
    });
    revalidatePath('/app/brand');
    return { error: null, message: `${voice.name} is now a brand voice.` };
  } catch (error) {
    return { error: reportError('adoptVoiceAction', error).publicMessage };
  }
}

export async function cloneVoiceAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    const files = formData.getAll('samples').filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const samples = await Promise.all(
      files.map(async (file) => ({
        data: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type || 'audio/mpeg',
        filename: file.name || 'recording',
      })),
    );
    const scope = String(formData.get('scope') ?? 'organization') === 'project' ? 'project' : 'organization';
    const voice = await cloneBrandVoice(session, {
      name: String(formData.get('name') ?? ''),
      subjectName: String(formData.get('subjectName') ?? ''),
      confirmed: formData.get('confirmed') === 'on',
      scope,
      projectId: String(formData.get('projectId') ?? '') || null,
      language: language(formData),
      gender: gender(formData) ?? 'female',
      samples,
    });
    revalidatePath('/app/brand');
    return { error: null, message: `${voice.name} was cloned under the consent you recorded.` };
  } catch (error) {
    return { error: reportError('cloneVoiceAction', error).publicMessage };
  }
}

export async function removeVoiceAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    await removeBrandVoice(session, String(formData.get('brandVoiceId') ?? ''));
    revalidatePath('/app/brand');
    return { error: null, message: 'Removed.' };
  } catch (error) {
    return { error: reportError('removeVoiceAction', error).publicMessage };
  }
}

export async function setDefaultVoiceAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    await setDefaultBrandVoice(session, String(formData.get('brandVoiceId') ?? ''));
    revalidatePath('/app/brand');
    return { error: null, message: 'This voice now reads by default.' };
  } catch (error) {
    return { error: reportError('setDefaultVoiceAction', error).publicMessage };
  }
}

export async function savePronunciationsAction(_previous: VoiceFormState, formData: FormData): Promise<VoiceFormState> {
  try {
    const session = await requireSession();
    const settings = await savePronunciations(session, String(formData.get('pronunciations') ?? ''));
    revalidatePath('/app/brand');
    return { error: null, message: `${settings.pronunciations.length} pronunciation${settings.pronunciations.length === 1 ? '' : 's'} saved.` };
  } catch (error) {
    return { error: reportError('savePronunciationsAction', error).publicMessage };
  }
}
