'use server';

import { redirect } from 'next/navigation';
import { AppError, can, planById, toAppError } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { getPlatformConfig } from '@/server/platform.ts';
import { createCheckoutSession, createCreditCheckout, createPortalSession } from '@/server/stripe.ts';

export type FormState = { error: string | null };

async function billingContext() {
  const session = await requireSession();
  if (!can(session.actor, 'billing:manage')) {
    throw new AppError('forbidden', 'Only the workspace owner can manage billing.');
  }
  const organization = await getStore().organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');
  return { session, organization };
}

export async function startCheckoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let url: string;
  try {
    const { session, organization } = await billingContext();
    const { plans } = await getPlatformConfig();
    const plan = planById(plans, String(formData.get('planId') ?? ''));
    const interval = String(formData.get('interval') ?? 'month') === 'year' ? 'year' : 'month';

    url = await createCheckoutSession({ organization, email: session.user.email, plan, interval });
  } catch (error) {
    return { error: toAppError(error).publicMessage };
  }
  redirect(url);
}

export async function openPortalAction(_previous: FormState): Promise<FormState> {
  let url: string;
  try {
    const { organization } = await billingContext();
    url = await createPortalSession(organization);
  } catch (error) {
    return { error: toAppError(error).publicMessage };
  }
  redirect(url);
}

export async function buyCreditsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let url: string;
  try {
    const { session, organization } = await billingContext();
    const credits = Number(formData.get('credits') ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      return { error: 'Choose how many credits to add.' };
    }
    url = await createCreditCheckout({ organization, email: session.user.email, credits });
  } catch (error) {
    return { error: toAppError(error).publicMessage };
  }
  redirect(url);
}
