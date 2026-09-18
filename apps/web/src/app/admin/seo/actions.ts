'use server';

import { revalidatePath } from 'next/cache';
import { SeoConfig } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { saveProductConfig } from '@/server/product.ts';

export type SeoActionState = { error: string | null; message?: string };

/**
 * The search settings a person owns.
 *
 * Saved as part of the product configuration, because that is where the phase
 * and the landing words already live: one record an operator can read.
 */
export async function saveSeoAction(_previous: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const user = await requireSuperAdmin();
    const seo = SeoConfig.parse({
      description: String(formData.get('description') ?? '').trim().slice(0, 240),
      discourageIndexing: formData.get('discourageIndexing') === 'on',
      googleVerification: String(formData.get('googleVerification') ?? '').trim().slice(0, 200),
      bingVerification: String(formData.get('bingVerification') ?? '').trim().slice(0, 200),
    });
    await saveProductConfig({ seo }, user.id);
    // Robots, the landing page and this page all read it.
    revalidatePath('/robots.txt');
    revalidatePath('/');
    revalidatePath('/admin/seo');
    return { error: null, message: 'Saved.' };
  } catch (error) {
    return { error: reportError('saveSeoAction', error).publicMessage };
  }
}
