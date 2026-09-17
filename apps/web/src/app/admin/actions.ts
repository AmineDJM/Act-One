'use server';

import { revalidatePath } from 'next/cache';
import { Plan, CreativeBudget, type Entitlement } from '@act-one/core';
import { ProviderConfig } from '@act-one/providers';
import { requireSuperAdmin } from '@/server/auth.ts';
import {
  getPlatformConfig,
  savePlatformConfig,
  saveProviderCredentials,
  testProvider,
  type ProviderSlotId,
} from '@/server/platform.ts';

/**
 * Console mutations.
 *
 * Every one re-checks staff authorisation. Server actions are reachable by
 * anybody who can construct the request — the layout redirect is for humans,
 * this is the actual control.
 */
export type ActionResult = { ok: boolean; message: string };

export async function saveProviderAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('provider') ?? '') as ProviderSlotId;

  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'provider' || typeof value !== 'string') continue;
    // An untouched masked field submits empty; treat that as "leave it alone"
    // rather than as "clear it", or saving one field wipes the others.
    if (value.trim().length === 0) continue;
    values[key] = value.trim();
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, message: 'Nothing to save — every field was left blank.' };
  }

  await saveProviderCredentials(id, values, user.id);
  revalidatePath('/admin/providers');

  const health = await testProvider(id);
  return {
    ok: health.healthy,
    message: health.healthy
      ? `Saved and verified${health.latencyMs ? ` in ${health.latencyMs}ms` : ''}.`
      : `Saved, but the check failed: ${health.message ?? 'unknown error'}`,
  };
}

export async function testProviderAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = String(formData.get('provider') ?? '') as ProviderSlotId;
  const health = await testProvider(id);
  return {
    ok: health.healthy,
    message: health.healthy
      ? `Connected${health.latencyMs ? ` in ${health.latencyMs}ms` : ''}.${health.message ? ` ${health.message}` : ''}`
      : health.message ?? 'Could not connect.',
  };
}

export async function saveRoutingAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const current = await getPlatformConfig();

  const parsed = ProviderConfig.safeParse({
    ...current.providers,
    llm: {
      ...current.providers.llm,
      routing: {
        fast: String(formData.get('llm.fast') ?? current.providers.llm.routing.fast),
        balanced: String(formData.get('llm.balanced') ?? current.providers.llm.routing.balanced),
        deep: String(formData.get('llm.deep') ?? current.providers.llm.routing.deep),
      },
    },
    browser: {
      ...current.providers.browser,
      primary: String(formData.get('browser.primary') ?? current.providers.browser.primary),
      fallback: String(formData.get('browser.fallback') ?? current.providers.browser.fallback),
    },
    media: {
      ...current.providers.media,
      enabled: formData.get('media.enabled') === 'on',
      maxCostPerRequestUsd: Number(formData.get('media.maxCostPerRequestUsd') ?? 6),
      maxCostPerSecondUsd: Number(formData.get('media.maxCostPerSecondUsd') ?? 0.9),
      maxRetries: Number(formData.get('media.maxRetries') ?? 2),
    },
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  await savePlatformConfig({ providers: parsed.data }, user.id);
  revalidatePath('/admin/providers');
  return { ok: true, message: 'Routing updated. Applies to the next job.' };
}

export async function savePlanAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const config = await getPlatformConfig();
  const planId = String(formData.get('planId') ?? '');

  const existing = config.plans.find((plan) => plan.id === planId);
  if (!existing) return { ok: false, message: 'Unknown plan.' };

  const entitlements = formData
    .getAll('entitlements')
    .map((value) => String(value)) as Entitlement[];

  const candidate = Plan.safeParse({
    ...existing,
    name: String(formData.get('name') ?? existing.name),
    description: String(formData.get('description') ?? existing.description),
    monthlyPriceCents: Math.round(Number(formData.get('monthlyPrice') ?? 0) * 100),
    yearlyPriceCents: Math.round(Number(formData.get('yearlyPrice') ?? 0) * 100),
    stripeMonthlyPriceId: emptyToNull(formData.get('stripeMonthlyPriceId')),
    stripeYearlyPriceId: emptyToNull(formData.get('stripeYearlyPriceId')),
    isPublic: formData.get('isPublic') === 'on',
    entitlements,
    limits: {
      ...existing.limits,
      projectsPerMonth: Number(formData.get('projectsPerMonth') ?? existing.limits.projectsPerMonth),
      rendersPerProject: Number(formData.get('rendersPerProject') ?? existing.limits.rendersPerProject),
      maxMasterDurationSeconds: Number(
        formData.get('maxMasterDurationSeconds') ?? existing.limits.maxMasterDurationSeconds,
      ),
      maxSeats: Number(formData.get('maxSeats') ?? existing.limits.maxSeats),
      maxBrands: Number(formData.get('maxBrands') ?? existing.limits.maxBrands),
      monthlyCredits: Number(formData.get('monthlyCredits') ?? existing.limits.monthlyCredits),
      maxGenerativeSecondsPerFilm: Number(
        formData.get('maxGenerativeSecondsPerFilm') ?? existing.limits.maxGenerativeSecondsPerFilm,
      ),
    },
  });

  if (!candidate.success) {
    return { ok: false, message: candidate.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  const plans = config.plans.map((plan) => (plan.id === planId ? candidate.data : plan));
  await savePlatformConfig({ plans }, user.id);
  revalidatePath('/admin/plans');
  revalidatePath('/pricing');
  return { ok: true, message: `${candidate.data.name} saved. Live immediately.` };
}

export async function saveBudgetAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const parsed = CreativeBudget.safeParse({
    minDeterministicRatio: Number(formData.get('minDeterministicRatio') ?? 0.45),
    maxGenerativeRatio: Number(formData.get('maxGenerativeRatio') ?? 0.25),
    minRealMediaRatio: Number(formData.get('minRealMediaRatio') ?? 0.15),
    maxCostPerSecondUsd: Number(formData.get('maxCostPerSecondUsd') ?? 0.9),
    maxRetries: Number(formData.get('maxRetries') ?? 2),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  if (parsed.data.minDeterministicRatio + parsed.data.maxGenerativeRatio > 1) {
    return { ok: false, message: 'Deterministic minimum and generative ceiling cannot exceed 100%.' };
  }

  await savePlatformConfig({ creativeBudget: parsed.data }, user.id);
  revalidatePath('/admin/providers');
  return { ok: true, message: 'Creative budget updated.' };
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}
