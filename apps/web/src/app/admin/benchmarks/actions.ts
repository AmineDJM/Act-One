'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toAppError } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import {
  analyzeAllUnanalyzed,
  deleteBenchmark,
  requestBenchmarkAnalysis,
  setBenchmarkRetrieval,
  updateBenchmarkDetails,
} from '@/server/benchmarks.ts';

/**
 * Benchmark Library mutations.
 *
 * Every one re-checks staff authorisation: a server action is reachable by
 * anyone who can construct the request, and the layout's redirect is for
 * people, not for requests. A refusal — a film already being analysed, one
 * with nothing to resume — comes back to the page as a notice.
 */
function back(to: string, notice: string, tone: 'ok' | 'error' = 'ok'): never {
  const url = new URL(to, 'http://console.invalid');
  url.searchParams.set(tone === 'ok' ? 'notice' : 'error', notice);
  redirect(`${url.pathname}${url.search}`);
}

function returnTo(formData: FormData, id: string): string {
  const requested = String(formData.get('returnTo') ?? '');
  // Only ever back into the library: a form field is not a place to send someone.
  return /^\/admin\/benchmarks(\/[a-z0-9_]+)?(\?[^\s]*)?$/.test(requested) ? requested : `/admin/benchmarks/${id}`;
}

export async function analyzeBenchmarkAction(formData: FormData): Promise<void> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('id') ?? '');
  const mode = formData.get('mode') === 'resume' ? 'resume' : 'new';
  const to = returnTo(formData, id);
  try {
    await requestBenchmarkAnalysis(id, mode, user.id);
  } catch (error) {
    back(to, toAppError(error).publicMessage, 'error');
  }
  revalidatePath('/admin/benchmarks');
  back(to, mode === 'resume' ? 'Queued: the analysis resumes at its first unfinished stage.' : 'Queued: a fresh analysis will run. The current FilmIR stays until the new one is complete.');
}

export async function analyzeAllAction(): Promise<void> {
  const user = await requireSuperAdmin();
  const { queued, failed } = await analyzeAllUnanalyzed(user.id);
  revalidatePath('/admin/benchmarks');
  if (failed > 0) back('/admin/benchmarks', `Queued ${queued} film(s); ${failed} could not be queued — see the logs.`, 'error');
  back('/admin/benchmarks', queued === 0 ? 'Nothing was waiting for a first analysis.' : `Queued ${queued} film(s) for analysis.`);
}

export async function setRetrievalAction(formData: FormData): Promise<void> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('id') ?? '');
  const retrieval = formData.get('retrieval') === 'enabled' ? 'enabled' : 'disabled';
  const to = returnTo(formData, id);
  try {
    await setBenchmarkRetrieval(id, retrieval, user.id);
  } catch (error) {
    back(to, toAppError(error).publicMessage, 'error');
  }
  revalidatePath('/admin/benchmarks');
  back(to, retrieval === 'enabled' ? 'The Creative Director may retrieve this film.' : 'The Creative Director will no longer retrieve this film.');
}

export async function updateBenchmarkAction(formData: FormData): Promise<void> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('id') ?? '');
  try {
    await updateBenchmarkDetails(
      id,
      {
        title: String(formData.get('title') ?? ''),
        origin: String(formData.get('origin') ?? ''),
        rights: String(formData.get('rights') ?? ''),
        notes: String(formData.get('notes') ?? ''),
      },
      user.id,
    );
  } catch (error) {
    back(`/admin/benchmarks/${id}`, toAppError(error).publicMessage, 'error');
  }
  revalidatePath(`/admin/benchmarks/${id}`);
  back(`/admin/benchmarks/${id}`, 'Saved.');
}

export async function deleteBenchmarkAction(formData: FormData): Promise<void> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('id') ?? '');
  if (formData.get('confirm') !== 'delete') back(`/admin/benchmarks/${id}`, 'Type "delete" to confirm.', 'error');
  try {
    await deleteBenchmark(id, user.id);
  } catch (error) {
    back(`/admin/benchmarks/${id}`, toAppError(error).publicMessage, 'error');
  }
  revalidatePath('/admin/benchmarks');
  back('/admin/benchmarks', 'Deleted the film, its FilmIR and every checkpoint.');
}
