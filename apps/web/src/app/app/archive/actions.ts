'use server';

import { revalidatePath } from 'next/cache';
import { LibraryCategory } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { deleteLibraryAsset, setLibraryAssetProjects, updateLibraryAsset, classifyLibraryAsset } from '@/server/library.ts';

export type LibraryActionResult = { error: string | null };

/** Every edit to the library is a small verb; the card calls the one it means. */
async function attempt(where: string, work: () => Promise<void>): Promise<LibraryActionResult> {
  try {
    await work();
    revalidatePath('/app', 'layout');
    return { error: null };
  } catch (error) {
    return { error: reportError(where, error).publicMessage };
  }
}

export async function renameAssetAction(input: { id: string; name: string }): Promise<LibraryActionResult> {
  return attempt('renameAssetAction', async () => {
    const session = await requireSession();
    await updateLibraryAsset(session, input.id, { name: input.name });
  });
}

export async function setAssetCategoryAction(input: { id: string; category: string }): Promise<LibraryActionResult> {
  return attempt('setAssetCategoryAction', async () => {
    const session = await requireSession();
    const category = LibraryCategory.parse(input.category);
    await updateLibraryAsset(session, input.id, { category });
  });
}

export async function setAssetFlagAction(input: { id: string; flag: 'favorite' | 'approved'; value: boolean }): Promise<LibraryActionResult> {
  return attempt('setAssetFlagAction', async () => {
    const session = await requireSession();
    await updateLibraryAsset(session, input.id, input.flag === 'favorite' ? { favorite: input.value } : { approved: input.value });
  });
}

export async function setAssetProjectsAction(input: { ids: string[]; projectIds: string[] }): Promise<LibraryActionResult> {
  return attempt('setAssetProjectsAction', async () => {
    const session = await requireSession();
    for (const id of new Set(input.ids)) await setLibraryAssetProjects(session, id, input.projectIds);
  });
}

export async function deleteAssetAction(input: { id: string }): Promise<LibraryActionResult> {
  return attempt('deleteAssetAction', async () => {
    const session = await requireSession();
    await deleteLibraryAsset(session, input.id);
  });
}

/** Asks the classifier to look again — after a version, or when the first look found nothing. */
export async function reclassifyAssetAction(input: { id: string }): Promise<LibraryActionResult> {
  return attempt('reclassifyAssetAction', async () => {
    const session = await requireSession();
    await updateLibraryAsset(session, input.id, {});
    await classifyLibraryAsset(session.organizationId, input.id);
  });
}
