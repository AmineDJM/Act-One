'use server';

import { revalidatePath } from 'next/cache';
import { ProductPhase, TrademarkStatus } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { createInvites, decideApplication, inviteLink, saveProductConfig } from '@/server/product.ts';
import { getStore } from '@/server/store.ts';

export type ProductActionState = { error: string | null; message?: string; links?: string[] };

async function attempt(where: string, work: () => Promise<Partial<ProductActionState> | void>): Promise<ProductActionState> {
  try {
    const result = (await work()) ?? {};
    revalidatePath('/', 'layout');
    return { error: null, ...result };
  } catch (error) {
    return { error: reportError(where, error).publicMessage };
  }
}

/** The phase, the mark and the landing copy: one form, one save. */
export async function saveProductAction(_previous: ProductActionState, formData: FormData): Promise<ProductActionState> {
  return attempt('saveProductAction', async () => {
    const user = await requireSuperAdmin();
    const phase = ProductPhase.parse(String(formData.get('phase') ?? ''));
    const trademarkStatus = TrademarkStatus.parse(String(formData.get('trademarkStatus') ?? 'none'));
    const text = (name: string) => String(formData.get(name) ?? '').trim();
    await saveProductConfig(
      {
        phase,
        trademarkStatus,
        landing: {
          eyebrow: text('eyebrow'),
          headline: text('headline'),
          subheadline: text('subheadline'),
          ctaLabel: text('ctaLabel'),
          exclusivityLine: text('exclusivityLine'),
          betaLine: text('betaLine'),
        },
        invites: {
          codesEnabled: formData.get('codesEnabled') === 'on',
          applicationsEnabled: formData.get('applicationsEnabled') === 'on',
          applicationPrompt: text('applicationPrompt'),
        },
      },
      user.id,
    );
    return { message: 'Saved. The site reads it within a minute.' };
  });
}

export async function createInvitesAction(_previous: ProductActionState, formData: FormData): Promise<ProductActionState> {
  return attempt('createInvitesAction', async () => {
    const user = await requireSuperAdmin();
    const count = Number(formData.get('count') ?? 1);
    const maxUsesRaw = String(formData.get('maxUses') ?? '1').trim();
    const expiresRaw = String(formData.get('expiresInDays') ?? '').trim();
    const codes = await createInvites({
      count: Number.isFinite(count) ? count : 1,
      maxUses: maxUsesRaw === '' || maxUsesRaw === '0' ? null : Math.max(1, Math.floor(Number(maxUsesRaw))),
      expiresInDays: expiresRaw === '' ? null : Math.max(1, Math.floor(Number(expiresRaw))),
      note: String(formData.get('note') ?? ''),
      createdByUserId: user.id,
    });
    return { message: `${codes.length} invitation${codes.length === 1 ? '' : 's'} made.`, links: codes.map(inviteLink) };
  });
}

export async function revokeInviteAction(input: { id: string }): Promise<ProductActionState> {
  return attempt('revokeInviteAction', async () => {
    await requireSuperAdmin();
    await getStore().invites.revoke(input.id);
  });
}

export async function decideApplicationAction(input: { id: string; decision: 'approved' | 'rejected'; note?: string }): Promise<ProductActionState> {
  return attempt('decideApplicationAction', async () => {
    const user = await requireSuperAdmin();
    const { code } = await decideApplication(input.id, input.decision, user.id, input.note ?? '');
    return code ? { message: 'Invited.', links: [inviteLink(code)] } : { message: 'Declined.' };
  });
}
