import 'server-only';
import {
  AppError,
  BetaApplication,
  DEFAULT_PRODUCT_CONFIG,
  ProductConfig,
  generateInviteCode,
  inviteCodeRefusal,
  newId,
  normalizeInviteCode,
  productName,
  signUpPolicy,
  type InviteCode,
  type SignUpPolicy,
} from '@act-one/core';
import { site } from '@/lib/site.ts';
import { getStore } from './store.ts';
import { getPlatformConfig, savePlatformConfig } from './platform.ts';
import { clientAddress, enforceAttempt } from './rate-limit.ts';

/**
 * The product's phase, read in one place and enforced at the door.
 *
 * The landing page, the navigation, the sign-up page and the console all
 * ask here what the product is right now. A private beta is by invitation:
 * a code opens the door once per person, within its uses and its time, and
 * a person without one may ask. Nothing about the phase is written into a
 * page by hand.
 */
export async function getProductConfig(): Promise<ProductConfig> {
  try {
    return (await getPlatformConfig()).product;
  } catch {
    return DEFAULT_PRODUCT_CONFIG;
  }
}

export async function getSignUpPolicy(): Promise<SignUpPolicy> {
  return signUpPolicy(await getProductConfig());
}

/** The name as the public sees it, with the mark it has earned. */
export async function publicProductName(): Promise<string> {
  return productName(site.name, (await getProductConfig()).trademarkStatus);
}

export async function saveProductConfig(patch: Partial<ProductConfig>, updatedBy: string): Promise<ProductConfig> {
  const current = await getProductConfig();
  const next = ProductConfig.parse({
    ...current,
    ...patch,
    landing: { ...current.landing, ...(patch.landing ?? {}) },
    seo: { ...current.seo, ...(patch.seo ?? {}) },
    invites: { ...current.invites, ...(patch.invites ?? {}) },
  });
  await savePlatformConfig({ product: next }, updatedBy);
  return next;
}

// --- the door ------------------------------------------------------------------

export type SignUpGate = { policy: SignUpPolicy; code: InviteCode | null };

/**
 * May an account be created, and on which invitation?
 *
 * Open phases need nothing. A private beta needs a usable code; the
 * refusal says why in words a person can act on, and never confirms more
 * than the code they typed.
 */
export async function signUpGate(rawCode: string | null | undefined): Promise<SignUpGate> {
  const policy = await getSignUpPolicy();
  const typed = normalizeInviteCode(rawCode ?? '');
  const code = typed ? await getStore().invites.getByCode(typed) : null;
  if (policy.open) return { policy, code: code && !inviteCodeRefusal(code) ? code : null };
  if (!policy.requiresCode) {
    throw new AppError('forbidden', `${site.name} is currently available by invitation.`);
  }
  if (!typed) {
    throw new AppError('forbidden', policy.applications ? 'An invitation is needed to create an account. You can request one.' : 'An invitation is needed to create an account.');
  }
  const refusal = inviteCodeRefusal(code);
  if (refusal) throw new AppError('forbidden', refusal);
  return { policy, code };
}

/** After the account exists: the use is taken, and recorded against the person. */
export async function redeemInvite(code: InviteCode | null, userId: string): Promise<void> {
  if (!code) return;
  const redeemed = await getStore().invites.redeem(code.id, userId);
  if (!redeemed) {
    // Somebody took the last use between the check and the account. The
    // account exists and stays; the console shows the code over its limit
    // by one redemption fewer than accounts, which is the truth.
    console.error(`[product] invitation ${code.code} could not be redeemed for ${userId}`);
  }
}

export function inviteLink(code: Pick<InviteCode, 'code'>): string {
  return `${site.url}/auth/sign-up?code=${encodeURIComponent(code.code)}`;
}

// --- invitations, from the console ------------------------------------------------

export type CreateInvitesInput = { count: number; maxUses: number | null; expiresInDays: number | null; note: string; createdByUserId: string };

export async function createInvites(input: CreateInvitesInput): Promise<InviteCode[]> {
  const store = getStore();
  const count = Math.min(Math.max(Math.floor(input.count), 1), 100);
  const now = new Date();
  const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString() : null;
  const made: InviteCode[] = [];
  for (let index = 0; index < count; index += 1) {
    // A collision is a retry, not a failure.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        made.push(
          await store.invites.create({
            id: newId('inv'),
            code: generateInviteCode(),
            kind: 'invite',
            note: input.note.trim().slice(0, 200),
            maxUses: input.maxUses,
            uses: 0,
            expiresAt,
            createdByUserId: input.createdByUserId,
            ownerUserId: null,
            createdAt: now.toISOString(),
            revokedAt: null,
          }),
        );
        break;
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'conflict') || attempt === 4) throw error;
      }
    }
  }
  return made;
}

// --- requests for access ------------------------------------------------------------

export type AccessRequestInput = { email: string; name: string; company: string; website: string; message: string };

/**
 * A request for access, kept once per address.
 *
 * Rate-limited like sign-up, because it is a public form; a second request
 * from the same address updates the first rather than piling up, and a
 * decided one is left alone.
 */
export async function applyForAccess(input: AccessRequestInput): Promise<BetaApplication> {
  const policy = await getSignUpPolicy();
  if (!policy.applications) throw new AppError('forbidden', 'Requests for access are not open right now.');
  await enforceAttempt('sign_up', { address: await clientAddress() });

  const email = input.email.trim().toLowerCase();
  const parsed = BetaApplication.safeParse({
    id: newId('bap'),
    email,
    name: input.name.trim().slice(0, 120),
    company: input.company.trim().slice(0, 120),
    website: input.website.trim() ? input.website.trim().slice(0, 300) : null,
    message: input.message.trim().slice(0, 2000),
    createdAt: new Date().toISOString(),
  });
  if (!parsed.success) throw new AppError('validation_failed', 'That does not look like an email address.');

  const store = getStore();
  const existing = await store.applications.getByEmail(email);
  if (existing && existing.status === 'pending') {
    return store.applications.update(existing.id, { note: existing.note });
  }
  if (existing && existing.status === 'approved') return existing;
  return store.applications.create(parsed.data);
}

export type ApplicationDecision = { application: BetaApplication; code: InviteCode | null };

/** Approved makes a single-use invitation for the address; declined records that a person said no. */
export async function decideApplication(id: string, decision: 'approved' | 'rejected', decidedByUserId: string, note = ''): Promise<ApplicationDecision> {
  const store = getStore();
  const application = await store.applications.get(id);
  if (!application) throw new AppError('not_found', 'Application not found.');
  if (application.status !== 'pending') {
    const code = application.inviteCodeId ? await store.invites.get(application.inviteCodeId) : null;
    return { application, code };
  }
  const decidedAt = new Date().toISOString();
  if (decision === 'rejected') {
    return { application: await store.applications.update(id, { status: 'rejected', decidedAt, decidedByUserId, note }), code: null };
  }
  const [code] = await createInvites({ count: 1, maxUses: 1, expiresInDays: 30, note: `For ${application.email}`, createdByUserId: decidedByUserId });
  const updated = await store.applications.update(id, { status: 'approved', inviteCodeId: code!.id, decidedAt, decidedByUserId, note });
  return { application: updated, code: code! };
}
