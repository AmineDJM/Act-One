'use server';

import { AppError, CollectionCategory } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { decideEntry, editEntry, publishManually, reorderEntries, type Decision, type EditorialPatch } from '@/server/collections.ts';

export type CollectionActionState = { error: string | null; message?: string };

async function attempt(where: string, work: () => Promise<Partial<CollectionActionState> | void>): Promise<CollectionActionState> {
  try {
    const result = (await work()) ?? {};
    return { error: null, ...result };
  } catch (error) {
    return { error: reportError(where, error).publicMessage };
  }
}

export async function decideEntryAction(input: { id: string; decision: Decision; note?: string }): Promise<CollectionActionState> {
  return attempt('decideEntryAction', async () => {
    const user = await requireSuperAdmin();
    const entry = await decideEntry(input.id, input.decision, user.id, input.note ?? '');
    return { message: entry.status === 'published' ? 'Published.' : entry.status === 'rejected' ? 'Declined.' : 'Unpublished.' };
  });
}

/** A flag flipped from the list: featured, launch of the week, Act One Original. */
export async function flagEntryAction(input: { id: string; flag: 'featured' | 'launchOfTheWeek' | 'original'; value: boolean }): Promise<CollectionActionState> {
  return attempt('flagEntryAction', async () => {
    const user = await requireSuperAdmin();
    await editEntry(input.id, { [input.flag]: input.value }, user.id);
  });
}

/** The words, the address, the pictures and the order: one form, one save. */
export async function editEntryAction(_previous: CollectionActionState, formData: FormData): Promise<CollectionActionState> {
  return attempt('editEntryAction', async () => {
    const user = await requireSuperAdmin();
    const id = String(formData.get('id') ?? '');
    const text = (name: string) => String(formData.get(name) ?? '').trim();
    const category = CollectionCategory.safeParse(text('category'));
    const position = Number(text('position'));
    const launchDate = text('launchDate');
    const patch: EditorialPatch = {
      title: text('title'),
      tagline: text('tagline'),
      concept: text('concept'),
      company: text('company'),
      productUrl: text('productUrl'),
      slug: text('slug'),
      seoTitle: text('seoTitle'),
      seoDescription: text('seoDescription'),
      editorialNote: text('editorialNote'),
      launchDate: launchDate || null,
      ...(category.success ? { category: category.data } : {}),
      ...(Number.isFinite(position) ? { position: Math.trunc(position) } : {}),
      posterAssetId: text('posterAssetId') || null,
      stillAssetIds: formData.getAll('stillAssetIds').map(String).filter(Boolean).slice(0, 8),
    };
    await editEntry(id, patch, user.id);
    return { message: 'Saved.' };
  });
}

export async function reorderEntriesAction(input: { ids: string[] }): Promise<CollectionActionState> {
  return attempt('reorderEntriesAction', async () => {
    const user = await requireSuperAdmin();
    await reorderEntries(input.ids.slice(0, 500), user.id);
    return { message: 'Order saved.' };
  });
}

/** Staff publish a film themselves, attesting to the written consent they hold. */
export async function publishManuallyAction(_previous: CollectionActionState, formData: FormData): Promise<CollectionActionState> {
  return attempt('publishManuallyAction', async () => {
    const user = await requireSuperAdmin();
    const [organizationId, projectId] = String(formData.get('project') ?? '').split('/');
    if (!organizationId || !projectId) throw new AppError('validation_failed', 'Pick a project.');
    if (formData.get('attest') !== 'on') throw new AppError('validation_failed', 'Tick the attestation: it is stored with the entry.');
    const entry = await publishManually({
      organizationId,
      projectId,
      consentStatement: String(formData.get('consentStatement') ?? ''),
      original: formData.get('original') === 'on',
      category: String(formData.get('category') ?? ''),
      staffUserId: user.id,
    });
    return { message: `Published at /collections/${entry.slug}.` };
  });
}
