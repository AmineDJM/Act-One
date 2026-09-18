'use server';

import { revalidatePath } from 'next/cache';
import { ReferralQualification, ReferralTier } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { saveReferralProgram } from '@/server/referrals.ts';

export type ReferralActionState = { error: string | null; message?: string };

/** The programme's rules: one form, one save, read everywhere it matters. */
export async function saveReferralProgramAction(_previous: ReferralActionState, formData: FormData): Promise<ReferralActionState> {
  try {
    const user = await requireSuperAdmin();
    const number = (name: string, fallback: number) => {
      const raw = String(formData.get(name) ?? '').trim();
      const value = Number(raw);
      return raw === '' || !Number.isFinite(value) ? fallback : Math.max(0, Math.trunc(value));
    };
    const capRaw = String(formData.get('maxRewardedPerInviter') ?? '').trim();
    const ats = formData.getAll('tierAt').map((value) => Number(value));
    const bonuses = formData.getAll('tierBonus').map((value) => Number(value));
    const labels = formData.getAll('tierLabel').map((value) => String(value));
    const tiers = ats
      .map((at, index) => ReferralTier.safeParse({ at: Math.trunc(at), bonusCredits: Math.trunc(bonuses[index] ?? 0), label: labels[index] ?? '' }))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .sort((a, b) => a.at - b.at);

    await saveReferralProgram(
      {
        enabled: formData.get('enabled') === 'on',
        qualifyOn: ReferralQualification.parse(String(formData.get('qualifyOn') ?? 'film_ready')),
        inviterCredits: number('inviterCredits', 200),
        invitedCredits: number('invitedCredits', 100),
        paidBonusCredits: number('paidBonusCredits', 400),
        maxRewardedPerInviter: capRaw === '' ? null : Math.max(1, Math.trunc(Number(capRaw) || 1)),
        tiers,
        headline: String(formData.get('headline') ?? '').trim().slice(0, 120),
        terms: String(formData.get('terms') ?? '').trim().slice(0, 600),
      },
      user.id,
    );
    revalidatePath('/app', 'layout');
    revalidatePath('/admin/referrals');
    return { error: null, message: 'Saved.' };
  } catch (error) {
    return { error: reportError('saveReferralProgramAction', error).publicMessage };
  }
}
