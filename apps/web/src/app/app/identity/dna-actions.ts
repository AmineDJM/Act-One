'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { BrandComponentPatch, confirmBrand, reviewBrandSignal, updateBrandComponent } from '@/server/brand.ts';

export type BrandDnaResult = { error: string | null; message?: string };

async function attempt(where: string, work: () => Promise<string | void>): Promise<BrandDnaResult> {
  try {
    const message = await work();
    revalidatePath('/app', 'layout');
    return { error: null, ...(message ? { message } : {}) };
  } catch (error) {
    return { error: reportError(where, error).publicMessage };
  }
}

/** One component, edited by hand. The patch is validated here, whatever the form sent. */
export async function saveBrandComponentAction(input: { brandId: string; patch: unknown }): Promise<BrandDnaResult> {
  return attempt('saveBrandComponentAction', async () => {
    const session = await requireSession();
    const patch = BrandComponentPatch.safeParse(input.patch);
    if (!patch.success) {
      const issue = patch.error.issues[0];
      throw new AppError('validation_failed', issue ? `${issue.path.join('.') || 'value'}: ${issue.message}` : 'That could not be read.');
    }
    await updateBrandComponent(session, input.brandId, patch.data);
    return 'Saved.';
  });
}

export async function confirmBrandDnaAction(input: { brandId: string }): Promise<BrandDnaResult> {
  return attempt('confirmBrandDnaAction', async () => {
    const session = await requireSession();
    await confirmBrand(session, input.brandId);
    return 'Brand confirmed.';
  });
}

export async function reviewBrandSignalAction(input: { brandId: string; signalId: string; decision: 'accepted' | 'dismissed' }): Promise<BrandDnaResult> {
  return attempt('reviewBrandSignalAction', async () => {
    const session = await requireSession();
    await reviewBrandSignal(session, input.brandId, input.signalId, input.decision);
  });
}
