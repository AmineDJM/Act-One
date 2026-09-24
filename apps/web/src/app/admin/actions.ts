'use server';

import { revalidatePath } from 'next/cache';
import {
  CreativeBudget,
  Plan,
  newId,
  parseEnvBlock,
  routeEnvEntries,
  type Entitlement,
  type Organization,
} from '@act-one/core';
import { ProviderConfig } from '@act-one/providers';
import { requireSuperAdmin } from '@/server/auth.ts';
import {
  ENV_VAR_ROUTES,
  PROVIDER_SLOTS,
  getPlatformConfig,
  listProviderState,
  readProviderCredentials,
  savePlatformConfig,
  saveProviderCredentials,
  testProvider,
  type ProviderSlotId,
} from '@/server/platform.ts';
import { getStore } from '@/server/store.ts';
import { GRANTABLE_LIMITS } from './limits.ts';

/**
 * Console mutations.
 *
 * Every one re-checks staff authorisation. Server actions are reachable by
 * anybody who can construct the request — the layout redirect is for humans,
 * this is the actual control.
 */
export type ActionResult = { ok: boolean; message: string };

export type ImportResult = {
  ok: boolean;
  message: string;
  saved: { provider: string; fields: number; healthy: boolean; message?: string }[];
  /** Keys in the pasted block that nothing wanted, so nobody assumes they landed. */
  unmatched: string[];
};

export type ProviderHealthSummary = {
  provider: string;
  healthy: boolean;
  latencyMs: number | null;
  message: string | null;
};

/** Reads the environment values a slot would fall back to, without storing them. */
function environmentCredentials(id: ProviderSlotId): Record<string, string> {
  const slot = PROVIDER_SLOTS.find((candidate) => candidate.id === id);
  if (!slot) return {};
  const values: Record<string, string> = {};
  for (const field of slot.fields) {
    const value = process.env[field.envVar]?.trim();
    if (value) values[field.key] = value;
  }
  return values;
}

/**
 * Staff actions are logged.
 *
 * Who turned on which integration, and when, is the first question asked after
 * anything unexpected — and the console is the one place where a single person
 * can change how the whole platform behaves.
 */
async function recordAdminEvent(
  actorUserId: string,
  event: string,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  getStore().log.recordSafely({
    level: 'info',
    source: 'admin',
    event,
    message,
    organizationId: null,
    projectId: null,
    jobId: null,
    actorUserId,
    durationMs: null,
    detail,
  });
}

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

  /** A price the operator typed, or nothing — a blank field never zeroes one. */
  function priceFromForm(form: FormData, tier: string, model: string) {
    const input = Number(form.get(`${tier}.input`));
    const output = Number(form.get(`${tier}.output`));
    if (!model || !Number.isFinite(input) || !Number.isFinite(output)) return {};
    if (input <= 0 && output <= 0) return {};
    return { [model]: { input: Math.max(0, input), output: Math.max(0, output) } };
  }

  const parsed = ProviderConfig.safeParse({
    ...current.providers,
    llm: {
      ...current.providers.llm,
      routing: {
        fast: String(formData.get('llm.fast') ?? current.providers.llm.routing.fast),
        balanced: String(formData.get('llm.balanced') ?? current.providers.llm.routing.balanced),
        deep: String(formData.get('llm.deep') ?? current.providers.llm.routing.deep),
      },
      /*
       * What each routed model costs, per million tokens.
       *
       * Kept beside the routing because they are the same decision: pointing
       * a tier at a model whose price nobody has entered means every call on
       * that tier is billed to the customer at whatever the dearest rate on
       * record happens to be.
       */
      prices: {
        ...current.providers.llm.prices,
        ...priceFromForm(formData, 'llm.fast', String(formData.get('llm.fast') ?? '')),
        ...priceFromForm(formData, 'llm.balanced', String(formData.get('llm.balanced') ?? '')),
        ...priceFromForm(formData, 'llm.deep', String(formData.get('llm.deep') ?? '')),
      },
    },
    browser: {
      ...current.providers.browser,
      primary: String(formData.get('browser.primary') ?? current.providers.browser.primary),
      fallback: String(formData.get('browser.fallback') ?? current.providers.browser.fallback),
    },
    speech: {
      ...current.providers.speech,
      primary: String(formData.get('speech.primary') ?? current.providers.speech.primary),
      preview: String(formData.get('speech.preview') ?? current.providers.speech.preview),
      recognizer: String(formData.get('speech.recognizer') ?? current.providers.speech.recognizer),
    },
    render: {
      ...current.providers.render,
      engine: String(formData.get('render.engine') ?? current.providers.render.engine),
      sceneAuthorTier: String(formData.get('render.sceneAuthorTier') ?? current.providers.render.sceneAuthorTier),
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
      revisionsPerProject: Number(
        formData.get('revisionsPerProject') ?? existing.limits.revisionsPerProject,
      ),
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

/**
 * Adopts credentials that are already in the environment.
 *
 * A deploy typically boots with keys in environment variables, which work but
 * live outside the console: they cannot be rotated without a redeploy, and the
 * console can only report "from environment" rather than own them. One click
 * copies them into the vault, after which the console is the source of truth.
 */
export async function adoptFromEnvironmentAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireSuperAdmin();
  const id = String(formData.get('provider') ?? '') as ProviderSlotId;

  const values = environmentCredentials(id);
  if (Object.keys(values).length === 0) {
    return { ok: false, message: 'Nothing in the environment for this integration.' };
  }

  await saveProviderCredentials(id, values, user.id);
  revalidatePath('/admin/providers');

  const health = await testProvider(id);
  await recordAdminEvent(user.id, 'integration.adopted', `Adopted ${id} from the environment.`, {
    provider: id,
    fields: Object.keys(values),
    healthy: health.healthy,
  });

  return {
    ok: health.healthy,
    message: health.healthy
      ? `Adopted ${Object.keys(values).length} value${Object.keys(values).length === 1 ? '' : 's'} and verified.`
      : `Adopted, but the check failed: ${health.message ?? 'unknown error'}`,
  };
}

/**
 * Takes a pasted block of environment variables and files each value where it
 * belongs.
 *
 * The values are already in the operator's .env or their host's dashboard.
 * Making them pick it apart field by field is busywork, and busywork during
 * setup is where half-configured platforms come from.
 */
export async function importEnvBlockAction(
  _previous: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  const user = await requireSuperAdmin();
  const block = String(formData.get('env') ?? '');

  const { matched, unmatched } = routeEnvEntries(parseEnvBlock(block), ENV_VAR_ROUTES);
  if (matched.length === 0) {
    return {
      ok: false,
      message:
        unmatched.length > 0
          ? `Recognised nothing to configure. Unused: ${unmatched.slice(0, 6).join(', ')}.`
          : 'Nothing that looks like KEY=value.',
      saved: [],
      unmatched,
    };
  }

  // Group by provider: each slot is one encrypted blob, so saving field by
  // field would have the last write drop the others.
  const byProvider = new Map<ProviderSlotId, Record<string, string>>();
  for (const { route, value } of matched) {
    const existing = byProvider.get(route.provider) ?? {};
    existing[route.field] = value;
    byProvider.set(route.provider, existing);
  }

  const saved: { provider: string; fields: number; healthy: boolean; message?: string }[] = [];
  for (const [provider, values] of byProvider) {
    // Merge over what is already stored, so pasting a block that only carries
    // one of a provider's two fields does not erase the other.
    const current = await readProviderCredentials(provider);
    await saveProviderCredentials(provider, { ...current, ...values }, user.id);
    const health = await testProvider(provider);
    saved.push({
      provider,
      fields: Object.keys(values).length,
      healthy: health.healthy,
      ...(health.message ? { message: health.message } : {}),
    });
  }

  revalidatePath('/admin/providers');
  await recordAdminEvent(user.id, 'integration.imported', 'Imported credentials from a pasted block.', {
    providers: saved.map((row) => row.provider),
    unmatched,
  });

  const healthy = saved.filter((row) => row.healthy).length;
  return {
    ok: healthy === saved.length,
    message:
      healthy === saved.length
        ? `Configured ${saved.length} integration${saved.length === 1 ? '' : 's'}, all verified.`
        : `Configured ${saved.length}, ${saved.length - healthy} failed verification.`,
    saved,
    unmatched,
  };
}

/** Runs a live check against every configured integration at once. */
export async function testAllProvidersAction(): Promise<ProviderHealthSummary[]> {
  await requireSuperAdmin();
  const states = await listProviderState();

  return Promise.all(
    states
      .filter((state) => state.configured)
      .map(async (state) => {
        const health = await testProvider(state.id);
        return {
          provider: state.id,
          healthy: health.healthy,
          latencyMs: health.latencyMs ?? null,
          message: health.message ?? null,
        };
      }),
  );
}

/**
 * Grants or revokes platform access.
 *
 * Two refusals are deliberate and not configurable. An operator cannot revoke
 * their own access, because the confirmation dialog they would need is the
 * console they just locked themselves out of; and the last super admin cannot
 * be removed, because there is no way back into the console from inside the
 * product — it would need somebody with database access to repair.
 */
export async function setStaffAccessAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const userId = String(formData.get('userId') ?? '');
  const grant = String(formData.get('grant') ?? '') === 'true';

  const store = getStore();
  const target = await store.users.get(userId);
  if (!target) return { ok: false, message: 'No such person.' };
  if (target.isSuperAdmin === grant) {
    return { ok: true, message: grant ? 'Already staff.' : 'Already not staff.' };
  }

  if (!grant) {
    if (target.id === actor.id) {
      return {
        ok: false,
        message: 'You cannot revoke your own access — ask another operator to do it.',
      };
    }
    if ((await store.users.countSuperAdmins()) <= 1) {
      return {
        ok: false,
        message: 'This is the last operator. Grant somebody else access first.',
      };
    }
  }

  await store.users.update(userId, { isSuperAdmin: grant });
  revalidatePath('/admin/staff');

  await recordAdminEvent(
    actor.id,
    grant ? 'staff.granted' : 'staff.revoked',
    `${grant ? 'Granted' : 'Revoked'} platform access for ${target.email}.`,
    { targetUserId: target.id, targetEmail: target.email },
  );

  return {
    ok: true,
    message: grant ? `${target.email} can now reach the console.` : `${target.email} no longer has access.`,
  };
}

/**
 * Suspends or restores a workspace.
 *
 * Suspension stops new work starting without deleting anything: an unpaid
 * invoice should not cost somebody the film they already made.
 */
export async function setOrganizationSuspendedAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const organizationId = String(formData.get('organizationId') ?? '');
  const suspend = String(formData.get('suspend') ?? '') === 'true';

  const store = getStore();
  const organization = await store.organizations.get(organizationId);
  if (!organization) return { ok: false, message: 'No such workspace.' };

  await store.organizations.update(organizationId, { isSuspended: suspend });
  revalidatePath('/admin/customers');

  await recordAdminEvent(
    actor.id,
    suspend ? 'organization.suspended' : 'organization.restored',
    `${suspend ? 'Suspended' : 'Restored'} ${organization.name}.`,
    { organizationId, name: organization.name },
  );

  return {
    ok: true,
    message: suspend
      ? `${organization.name} is suspended. Existing films are untouched.`
      : `${organization.name} can start work again.`,
  };
}

/**
 * Puts a workspace on a plan directly.
 *
 * Every platform needs this within a week of launch: a design partner on a
 * comped plan, a trial extended by hand, an enterprise deal invoiced outside
 * Stripe. Without it the only way to do any of those is a SQL console, and the
 * change leaves no trace.
 *
 * This changes what the workspace is entitled to; it does not touch their
 * Stripe subscription. Anyone billing through Stripe keeps billing through
 * Stripe, and the effective plan still comes from the subscription while one is
 * live — so this is a grant, not a way to silently stop charging somebody.
 */
export async function setOrganizationPlanAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const organizationId = String(formData.get('organizationId') ?? '');
  const planId = String(formData.get('planId') ?? '');

  const { plans } = await getPlatformConfig();
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return { ok: false, message: 'No such plan.' };

  const store = getStore();
  const organization = await store.organizations.get(organizationId);
  if (!organization) return { ok: false, message: 'No such workspace.' };

  await store.organizations.update(organizationId, { planId: plan.id });
  revalidatePath('/admin/customers');

  await recordAdminEvent(actor.id, 'organization.plan_set', `Put ${organization.name} on ${plan.name}.`, {
    organizationId,
    from: organization.planId,
    to: plan.id,
  });

  const subscription = await store.subscriptions.getForOrganization(organizationId);
  return {
    ok: true,
    message: subscription
      ? `${organization.name} is on ${plan.name}. Their live Stripe subscription still decides what they are charged.`
      : `${organization.name} is on ${plan.name}.`,
  };
}

/** Adds credits to a workspace by hand — goodwill, a failed render, a trial. */
export async function grantCreditsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const organizationId = String(formData.get('organizationId') ?? '');
  const amount = Number(formData.get('credits') ?? 0);

  if (!Number.isInteger(amount) || amount === 0) {
    return { ok: false, message: 'Enter a whole number of credits.' };
  }
  if (Math.abs(amount) > 100_000) {
    // A slipped keystroke here is a five-figure gift, so it needs a second pair
    // of hands rather than a bigger text box.
    return { ok: false, message: 'Over 100,000 credits in one go needs a second operator.' };
  }

  const store = getStore();
  const organization = await store.organizations.get(organizationId);
  if (!organization) return { ok: false, message: 'No such workspace.' };

  /*
   * A unique key, deliberately.
   *
   * Every other movement in the ledger is keyed by what it is, so a retry
   * cannot pay twice. This one is keyed by this press of the button, because
   * an operator granting the same amount twice usually means it.
   */
  const posting = await store.creditLedger.post({
    organizationId,
    kind: 'grant',
    delta: amount,
    sourceKey: `grant:${newId('cle')}`,
    description: `Granted by an operator`,
    actorUserId: actor.id,
  });
  if (!posting.applied) {
    return { ok: false, message: `That would take ${organization.name} below zero credits.` };
  }
  revalidatePath('/admin/customers');

  await recordAdminEvent(
    actor.id,
    'credits.granted',
    `${amount > 0 ? 'Granted' : 'Removed'} ${Math.abs(amount)} credits ${amount > 0 ? 'to' : 'from'} ${organization.name}.`,
    { organizationId, amount, balanceBefore: organization.creditBalance },
  );

  return { ok: true, message: `${organization.name} now has ${posting.balance} credits.` };
}

/**
 * Lifts a limit for one workspace, on top of whatever plan is in force.
 *
 * A plan is a product; a customer is a person. A deal, a pilot, an apology, a
 * friend of the company — each is a limit lifted for exactly one workspace,
 * and the alternative is inventing a plan per customer until the price list is
 * unreadable.
 *
 * Every field is optional and a blank one means "take this back to the plan",
 * so a grant can be undone without knowing what the plan said.
 */
export async function setOrganizationLimitsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const organizationId = String(formData.get('organizationId') ?? '');

  const store = getStore();
  const organization = await store.organizations.get(organizationId);
  if (!organization) return { ok: false, message: 'No such workspace.' };

  const overrides: Organization['limitOverrides'] = {};
  const problems: string[] = [];
  for (const field of GRANTABLE_LIMITS) {
    const raw = String(formData.get(field.name) ?? '').trim();
    if (raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < -1) {
      problems.push(`${field.label} must be a whole number, or -1 for unlimited.`);
      continue;
    }
    if (field.ceiling !== undefined && value > field.ceiling) {
      // Not a policy so much as a typo guard: the difference between 600 and
      // 6000 seconds is an hour of render nobody meant to authorise.
      problems.push(`${field.label} above ${field.ceiling} needs a second operator.`);
      continue;
    }
    overrides[field.name] = value;
  }
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const updated = await store.organizations.update(organizationId, { limitOverrides: overrides });

  revalidatePath('/admin/customers');
  const granted = Object.entries(overrides)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
  await recordAdminEvent(
    actor.id,
    'limits.granted',
    granted
      ? `Lifted limits for ${organization.name}: ${granted}.`
      : `Cleared every lifted limit for ${organization.name}.`,
    { organizationId, overrides },
  );

  return {
    ok: true,
    message: granted
      ? `${updated.name} now runs on its plan plus ${Object.keys(overrides).length} lifted limit${
          Object.keys(overrides).length === 1 ? '' : 's'
        }.`
      : `${updated.name} is back to exactly what its plan sells.`,
  };
}

/**
 * Marks a workspace as one the operator runs rather than sells to.
 *
 * Not billed, not limited, not counted as revenue. It is set automatically
 * when a super admin signs up, and this is how it is granted to a second
 * internal workspace — or taken back from one that should be paying.
 */
export async function setOrganizationInternalAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireSuperAdmin();
  const organizationId = String(formData.get('organizationId') ?? '');
  const internal = formData.get('internal') === 'true';

  const store = getStore();
  const organization = await store.organizations.get(organizationId);
  if (!organization) return { ok: false, message: 'No such workspace.' };

  await store.organizations.update(organizationId, { isInternal: internal });
  revalidatePath('/admin/customers');

  await recordAdminEvent(
    actor.id,
    internal ? 'workspace.internal' : 'workspace.external',
    `${organization.name} is ${internal ? 'now an internal workspace' : 'no longer internal'}.`,
    { organizationId },
  );

  return {
    ok: true,
    message: internal
      ? `${organization.name} is internal: not billed, not limited, not counted as revenue.`
      : `${organization.name} is a customer again, on ${organization.planId}.`,
  };
}
