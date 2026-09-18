import { z } from 'zod';
import { ReferralProgram } from './referral.ts';
import { EditorialSchedule } from './editorial.ts';

/**
 * Where the product is in its life, decided in one place.
 *
 * A private beta is by invitation: a code opens the door, and a person may
 * ask for one. A public beta lets anyone in and says so plainly. Production
 * is the commercial flow. The website and the product read this rather than
 * hard-coding any of it, so the day the door opens is a switch in the
 * console, not a deploy.
 */
export const ProductPhase = z.enum(['private_beta', 'public_beta', 'production']);
export type ProductPhase = z.infer<typeof ProductPhase>;

export const PRODUCT_PHASE_LABELS: Record<ProductPhase, string> = {
  private_beta: 'Private beta',
  public_beta: 'Public beta',
  production: 'Production',
};

/**
 * The mark the name has earned. Nothing until there is something to show;
 * ™ where it is commercially wanted before registration; ® only once the
 * registration is real. Never written into a page by hand.
 */
export const TrademarkStatus = z.enum(['none', 'pending', 'registered']);
export type TrademarkStatus = z.infer<typeof TrademarkStatus>;

export function productName(name: string, status: TrademarkStatus): string {
  return status === 'registered' ? `${name}®` : status === 'pending' ? `${name}™` : name;
}

export const LandingConfig = z.object({
  eyebrow: z.string().max(80).default('Launch films for software companies'),
  headline: z.string().max(120).default('Your product. Directed.'),
  /** Empty means the page's own paragraph. */
  subheadline: z.string().max(400).default(''),
  ctaLabel: z.string().max(60).default('See how Act One would launch your product'),
  /** The line under the call to action while the product is by invitation. */
  exclusivityLine: z.string().max(200).default('Act One is currently available by invitation.'),
  /** The line while the product is in public beta. */
  betaLine: z.string().max(200).default('Act One is in public beta. Everything works; some of it is still being refined.'),
});
export type LandingConfig = z.infer<typeof LandingConfig>;

/**
 * The handful of search settings an operator actually owns.
 *
 * Everything else about how this site presents itself to search engines is
 * code — canonicals, structured data, the sitemap — because those are
 * correctness, not preference. What is left is genuinely a decision: the
 * sentence the landing page shows in results, whether this deployment may be
 * indexed at all, and the tokens a search console hands you to prove the site
 * is yours.
 */
export const SeoConfig = z.object({
  /** The landing page's description in search results. Empty means the written one. */
  description: z.string().max(240).default(''),
  /**
   * Keep the whole site out of search even on its real address.
   *
   * For the window between a domain going live and the site being ready to be
   * found. A deployment that is not on its real address is already excluded.
   */
  discourageIndexing: z.boolean().default(false),
  /** The token from Google Search Console's HTML tag method, if that is how it was verified. */
  googleVerification: z.string().max(200).default(''),
  /** The same, for Bing Webmaster Tools. */
  bingVerification: z.string().max(200).default(''),
});
export type SeoConfig = z.infer<typeof SeoConfig>;

export const InviteConfig = z.object({
  /** Whether an invitation code opens the door in a private beta. */
  codesEnabled: z.boolean().default(true),
  /** Whether people may ask for access in a private beta. */
  applicationsEnabled: z.boolean().default(true),
  /** What the request form asks, in the operator's words. */
  applicationPrompt: z.string().max(300).default('Tell us about the product you are launching, and when.'),
});
export type InviteConfig = z.infer<typeof InviteConfig>;

export const ProductConfig = z.object({
  phase: ProductPhase.default('private_beta'),
  trademarkStatus: TrademarkStatus.default('none'),
  landing: LandingConfig.default(() => LandingConfig.parse({})),
  seo: SeoConfig.default(() => SeoConfig.parse({})),
  invites: InviteConfig.default(() => InviteConfig.parse({})),
  /** The referral programme's rules; see domain/referral.ts. */
  referrals: ReferralProgram.default(() => ReferralProgram.parse({})),
  /** The journal's rules; see domain/editorial.ts. */
  editorial: EditorialSchedule.default(() => EditorialSchedule.parse({})),
});
export type ProductConfig = z.infer<typeof ProductConfig>;
export const DEFAULT_PRODUCT_CONFIG: ProductConfig = ProductConfig.parse({});

/** What the public surfaces may offer right now. */
export type SignUpPolicy = {
  phase: ProductPhase;
  /** An account can be created without an invitation. */
  open: boolean;
  /** A valid invitation code is required. */
  requiresCode: boolean;
  /** People may ask for access. */
  applications: boolean;
  /** The public call to action, in words. */
  ctaLabel: string;
  /** The one line saying what the product is right now, or nothing. */
  phaseLine: string | null;
  /** The small tag beside the name inside the product, or nothing. */
  tag: string | null;
};

export function signUpPolicy(config: ProductConfig): SignUpPolicy {
  switch (config.phase) {
    case 'private_beta':
      return {
        phase: 'private_beta',
        open: false,
        requiresCode: config.invites.codesEnabled,
        applications: config.invites.applicationsEnabled,
        ctaLabel: config.invites.applicationsEnabled ? 'Request access' : 'Get invited',
        phaseLine: config.landing.exclusivityLine,
        tag: 'beta',
      };
    case 'public_beta':
      return { phase: 'public_beta', open: true, requiresCode: false, applications: false, ctaLabel: 'Join the beta', phaseLine: config.landing.betaLine, tag: 'beta' };
    case 'production':
      return { phase: 'production', open: true, requiresCode: false, applications: false, ctaLabel: 'Start free', phaseLine: null, tag: null };
  }
}

// --- invitations ---------------------------------------------------------------

export const InviteCodeKind = z.enum(['invite', 'referral']);
export type InviteCodeKind = z.infer<typeof InviteCodeKind>;

/**
 * One code that opens the door.
 *
 * Bounded by uses and by time, withdrawable, and never a credential: it
 * lets a person create an account, nothing more. A referral code is the
 * same thing with an owner, so the referral programme is this table too.
 */
export const InviteCode = z.object({
  id: z.string(),
  code: z.string().min(4).max(40),
  kind: InviteCodeKind.default('invite'),
  note: z.string().max(200).default(''),
  /** Null means unlimited. */
  maxUses: z.number().int().min(1).nullable().default(1),
  uses: z.number().int().min(0).default(0),
  expiresAt: z.string().nullable().default(null),
  createdByUserId: z.string().nullable().default(null),
  /** For a referral code: whose it is. */
  ownerUserId: z.string().nullable().default(null),
  createdAt: z.string(),
  revokedAt: z.string().nullable().default(null),
});
export type InviteCode = z.infer<typeof InviteCode>;

export type InviteRedemption = { codeId: string; userId: string; at: string };

/** As typed by a person: case and spacing are not the code. */
export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
}

/** Unambiguous characters only: no 0/O, 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(random: () => number = Math.random, prefix = 'ACT'): string {
  const chunk = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join('');
  return `${prefix}-${chunk()}-${chunk()}`;
}

/** Why a code cannot be used right now, in the words the sign-up page says; null when it can. */
export function inviteCodeRefusal(code: InviteCode | null, now = new Date()): string | null {
  if (!code) return 'That invitation code is not one we know.';
  if (code.revokedAt) return 'That invitation has been withdrawn.';
  if (code.expiresAt && Date.parse(code.expiresAt) <= now.getTime()) return 'That invitation has expired.';
  if (code.maxUses !== null && code.uses >= code.maxUses) return 'That invitation has already been used.';
  return null;
}

// --- applications ----------------------------------------------------------------

export const BetaApplicationStatus = z.enum(['pending', 'approved', 'rejected']);
export type BetaApplicationStatus = z.infer<typeof BetaApplicationStatus>;

export const BetaApplication = z.object({
  id: z.string(),
  email: z.string().email().max(200),
  name: z.string().max(120).default(''),
  company: z.string().max(120).default(''),
  website: z.string().max(300).nullable().default(null),
  message: z.string().max(2000).default(''),
  status: BetaApplicationStatus.default('pending'),
  /** The invitation an approval made. */
  inviteCodeId: z.string().nullable().default(null),
  note: z.string().max(500).default(''),
  createdAt: z.string(),
  decidedAt: z.string().nullable().default(null),
  decidedByUserId: z.string().nullable().default(null),
});
export type BetaApplication = z.infer<typeof BetaApplication>;

export const BETA_APPLICATION_LABELS: Record<BetaApplicationStatus, string> = {
  pending: 'Under consideration',
  approved: 'Invited',
  rejected: 'Declined',
};
