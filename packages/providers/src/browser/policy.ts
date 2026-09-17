import { AppError, normalizeUrl } from '@act-one/core';
import type { InteractionStep } from './types.ts';

/**
 * Navigation and interaction policy for the research agent.
 *
 * The agent browses real companies' public sites and, when explicitly
 * authorised, their real products. Two rules are absolute:
 *
 *   1. We never attempt to reach anything we were not given access to.
 *      No credential guessing, no forced browsing, no parameter tampering,
 *      no following links out of the authorised origin while authenticated.
 *   2. We never take a destructive or state-changing action inside a
 *      customer's product. We are there to look, not to operate.
 *
 * These are enforced here, in one place, rather than trusted to prompt text.
 * A model that decides to click "Delete workspace" gets stopped by code.
 */

/** Interaction targets that must never be clicked inside an authorised product. */
const DESTRUCTIVE_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdestroy\b/i,
  /\bterminate\b/i,
  /\bcancel\s+(subscription|plan|account)\b/i,
  /\bdowngrade\b/i,
  /\bupgrade\b/i,
  /\bpay\b/i,
  /\bpurchase\b/i,
  /\bcheckout\b/i,
  /\bconfirm\b.*\b(payment|charge)\b/i,
  /\binvite\b/i,
  /\bsend\b.*\b(email|message|invite)\b/i,
  /\btransfer\b/i,
  /\brevoke\b/i,
  /\breset\b/i,
  /\bdeactivate\b/i,
  /\bpublish\b/i,
  /\bdeploy\b/i,
  /\bmerge\b/i,
  /\bsign\s*out\b/i,
  /\blog\s*out\b/i,
];

/** Paths that are off-limits even with valid credentials. */
const DEFAULT_DENIED_PATH_FRAGMENTS = [
  '/billing',
  '/payment',
  '/invoice',
  '/subscription',
  '/admin',
  '/settings/security',
  '/settings/team',
  '/api-keys',
  '/tokens',
  '/danger',
  '/delete',
  '/export',
  '/logout',
  '/signout',
];

/** Hosts we will not visit no matter what a model suggests. */
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
];

export type NavigationPolicy = {
  /** Origins the session is allowed to visit at all. */
  allowedOrigins: string[];
  /** Additional path prefixes allowed within an authenticated origin. Empty = all. */
  allowedPaths: string[];
  deniedPaths: string[];
  /** True once the session holds customer credentials — tightens every rule. */
  authenticated: boolean;
  maxPages: number;
};

export function policyForPublicResearch(
  seedUrls: string[],
  maxPages = 24,
): NavigationPolicy {
  const origins = new Set<string>();
  for (const seed of seedUrls) {
    const normalized = normalizeUrl(seed);
    if (normalized) origins.add(new URL(normalized).origin);
  }
  return {
    allowedOrigins: [...origins],
    allowedPaths: [],
    deniedPaths: [...DEFAULT_DENIED_PATH_FRAGMENTS],
    authenticated: false,
    maxPages,
  };
}

export function policyForAuthenticatedProduct(params: {
  loginUrl: string;
  allowedPaths: string[];
  deniedPaths: string[];
  maxPages?: number;
}): NavigationPolicy {
  const normalized = normalizeUrl(params.loginUrl);
  if (!normalized) {
    throw new AppError('validation_failed', 'Product login URL is not usable.');
  }
  return {
    allowedOrigins: [new URL(normalized).origin],
    allowedPaths: params.allowedPaths,
    deniedPaths: [...new Set([...DEFAULT_DENIED_PATH_FRAGMENTS, ...params.deniedPaths])],
    authenticated: true,
    maxPages: params.maxPages ?? 18,
  };
}

export type PolicyVerdict = { allowed: true } | { allowed: false; reason: string };

export function checkNavigation(policy: NavigationPolicy, rawUrl: string): PolicyVerdict {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return { allowed: false, reason: `Unusable URL: ${rawUrl}` };

  const url = new URL(normalized);

  if (BLOCKED_HOSTS.includes(url.hostname) || isPrivateAddress(url.hostname)) {
    // SSRF guard: a link on a customer's site must never steer us at internal
    // infrastructure.
    return { allowed: false, reason: `Blocked host: ${url.hostname}` };
  }

  if (policy.allowedOrigins.length > 0 && !policy.allowedOrigins.includes(url.origin)) {
    // Leaving the authorised origin while holding credentials is the classic way
    // to leak a session token into somebody else's logs.
    if (policy.authenticated) {
      return { allowed: false, reason: `Authenticated session may not leave ${url.origin}` };
    }
    if (!isRelatedOrigin(policy.allowedOrigins, url.origin)) {
      return { allowed: false, reason: `Origin not in research scope: ${url.origin}` };
    }
  }

  const path = url.pathname.toLowerCase();
  const denied = policy.deniedPaths.find((fragment) => path.includes(fragment.toLowerCase()));
  if (denied) return { allowed: false, reason: `Path is off-limits: ${denied}` };

  if (policy.allowedPaths.length > 0) {
    const permitted = policy.allowedPaths.some((prefix) => path.startsWith(prefix.toLowerCase()));
    if (!permitted) {
      return { allowed: false, reason: `Path outside the paths we were authorised to visit.` };
    }
  }

  return { allowed: true };
}

export function checkInteraction(policy: NavigationPolicy, step: InteractionStep): PolicyVerdict {
  if (step.type === 'wait' || step.type === 'scroll' || step.type === 'hover') {
    return { allowed: true };
  }

  // Selectors and test ids are the main surface here, and they are written as
  // `#cancel-subscription` or `[data-test=delete_workspace]` far more often than
  // as prose. Normalising separators to spaces is what makes \b word boundaries
  // meaningful against a CSS selector.
  const surface = normalizeInteractionSurface(
    [
      'selector' in step ? step.selector : '',
      'text' in step ? step.text : '',
      step.description ?? '',
    ].join(' '),
  );

  if (policy.authenticated) {
    const destructive = DESTRUCTIVE_PATTERNS.find((pattern) => pattern.test(surface));
    if (destructive) {
      return {
        allowed: false,
        reason: `Refusing a state-changing interaction in a customer product: ${surface.slice(0, 120)}`,
      };
    }
  }

  if (step.type === 'type' && looksLikeCredentialField(surface) && !policy.authenticated) {
    return { allowed: false, reason: 'Refusing to type into a credential field without authorisation.' };
  }

  if (step.type === 'press' && /enter/i.test(step.key) && policy.authenticated) {
    // Enter submits forms. Allowed, but only because clicks are already filtered;
    // kept explicit so the intent is documented rather than accidental.
    return { allowed: true };
  }

  return { allowed: true };
}

export function normalizeInteractionSurface(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeCredentialField(surface: string): boolean {
  return /password|passwd|otp|2fa|mfa|verification|credit|card|cvv/i.test(surface);
}

/** www.example.com and docs.example.com are the same company; example.io is not. */
function isRelatedOrigin(allowedOrigins: string[], candidate: string): boolean {
  const candidateHost = new URL(candidate).hostname;
  return allowedOrigins.some((origin) => {
    const host = new URL(origin).hostname;
    return registrableDomain(host) === registrableDomain(candidateHost);
  });
}

export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  // Good enough without a public-suffix list: handles co.uk-style two-part TLDs.
  const twoPartTlds = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.mx']);
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

function isPrivateAddress(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return true;
  return false;
}

export class PolicyViolation extends AppError {
  constructor(reason: string) {
    super('unsafe_operation', reason, { publicMessage: 'That action is outside what we are permitted to do.' });
  }
}
