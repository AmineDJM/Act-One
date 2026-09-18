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

/**
 * Addresses that are this machine, this network, or the cloud's metadata
 * service, in every spelling a URL parser accepts.
 *
 * The list of names above catches the obvious; this catches the rest. It used
 * to block 127.0.0.1 alone, which left 127.0.0.2 and the whole 127/8 block,
 * IPv6 loopback in its mapped and bracketed forms, and a decimal or octal
 * address that Chromium happily resolves. An SSRF guard with one hole is a
 * door.
 */
export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.home.arpa')) {
    return true;
  }

  const v4 = parseIPv4(host);
  if (v4 !== null) return isPrivateIPv4(v4);

  if (host.includes(':')) {
    // IPv6. Mapped IPv4 (::ffff:a.b.c.d) is judged as the IPv4 it wraps.
    const mapped = host.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) {
      const inner = parseIPv4(mapped[1]);
      return inner === null ? true : isPrivateIPv4(inner);
    }
    const compact = host.replace(/^0*:(0*:)*/, '::');
    if (compact === '::' || compact === '::1') return true;
    // Link-local (fe80::/10), unique local (fc00::/7), and 6to4/Teredo
    // wrappers are all "not the public internet".
    if (/^fe[89ab]/.test(host) || /^f[cd]/.test(host) || /^2002:/.test(host) || /^2001:0*:/.test(host)) {
      return true;
    }
    return false;
  }

  // A bare number is an IPv4 address in disguise (http://2130706433/ is
  // http://127.0.0.1/). Anything numeric that did not parse above is refused.
  if (/^[0-9a-fx.]+$/.test(host) && /^\d/.test(host)) return true;
  return false;
}

/** IPv4 in dotted, short, octal or hex form, as browsers accept it. */
function parseIPv4(host: string): number | null {
  if (!/^[0-9a-fx.]+$/i.test(host) || !/^\d/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => part.length === 0)) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0x[0-9a-f]+$/i.test(part)) value = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
    else if (/^\d+$/.test(part)) value = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(value)) return null;
    numbers.push(value);
  }
  // The last part fills the remaining bytes, as in the classic parsers.
  const last = numbers[numbers.length - 1]!;
  const head = numbers.slice(0, -1);
  if (head.some((value) => value > 255)) return null;
  if (last >= 2 ** (8 * (5 - numbers.length))) return null;
  let address = 0;
  for (const value of head) address = address * 256 + value;
  address = address * 256 ** (5 - numbers.length) + last;
  return address >>> 0;
}

function isPrivateIPv4(address: number): boolean {
  const a = (address >>> 24) & 255;
  const b = (address >>> 16) & 255;
  if (a === 0 || a === 10 || a === 127) return true; // this network, private, loopback
  if (a === 169 && b === 254) return true; // link-local, and the metadata service
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && ((address >>> 8) & 255) === 0) return true; // 192.0.0.0/24
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export class PolicyViolation extends AppError {
  constructor(reason: string) {
    super('unsafe_operation', reason, { publicMessage: 'That action is outside what we are permitted to do.' });
  }
}
