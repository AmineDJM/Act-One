/**
 * Credentials this process never sees.
 *
 * Every provider here was written for the same world: a secret arrives as an
 * environment variable or out of the vault, the provider holds it, and the
 * provider puts it in a header. `isConfigured()` exists so a deployment with
 * no key says so early instead of failing minutes later in the middle of a
 * render — which is right, and which is exactly what breaks in the other
 * world.
 *
 * In that other world the process is behind an egress gateway that holds the
 * credentials and writes the authorization header itself, on the way out. The
 * secret is deliberately not reachable from here: there is nothing to read,
 * nothing to put in a header, and nothing to leak. A provider that insists on
 * holding a key before it will make a call refuses to make a call it would
 * have completed — the credential is present on the wire and absent in the
 * process, and `isConfigured()` was only ever asking about the process.
 *
 * So this splits the question in two. "Do I hold a secret" is what the
 * providers already answer. "Can a call from this process be authenticated"
 * is what they actually needed to know, and for a managed provider the answer
 * is yes without a secret ever existing here.
 *
 * Off unless switched on. With `ACT_ONE_MANAGED_CREDENTIALS` unset — which is
 * every normal deployment — every function below is inert and provider
 * behaviour is bit-for-bit what it was. A key held locally always wins: this
 * only ever speaks for a provider that has nothing.
 *
 * The one rule that makes it safe: a managed provider sends NO authorization
 * header at all and lets the gateway write one. It never sends a placeholder.
 * A fake secret on the wire is a fake secret in somebody's access log, and a
 * provider that sends `Key placeholder` to a vendor that is not behind the
 * gateway has invented an authentication failure that is very hard to read.
 */

/** Providers whose credentials a gateway can hold on this deployment's behalf. */
export type ManagedProvider =
  | 'openai'
  | 'higgsfield'
  | 'browserbase'
  | 'elevenlabs'
  | 'gemini'
  | 'runway'
  | 'recraft'
  | 'ideogram';

const ALL: readonly ManagedProvider[] = [
  'openai',
  'higgsfield',
  'browserbase',
  'elevenlabs',
  'gemini',
  'runway',
  'recraft',
  'ideogram',
];

/**
 * Which providers this process may call without holding their credentials.
 *
 * `ACT_ONE_MANAGED_CREDENTIALS=all`, or a comma-separated list of the names
 * above. Unknown names are ignored rather than fatal: the variable is set by
 * whatever is hosting the process, and a name this build does not know about
 * is a version skew, not a misconfiguration worth refusing to start over.
 */
export function managedProviders(): ReadonlySet<ManagedProvider> {
  const raw = process.env['ACT_ONE_MANAGED_CREDENTIALS']?.trim();
  if (!raw) return new Set();
  if (raw === 'all' || raw === '1' || raw === 'true') return new Set(ALL);

  const named = new Set<ManagedProvider>();
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if ((ALL as readonly string[]).includes(name)) named.add(name as ManagedProvider);
  }
  return named;
}

/**
 * Whether a call to this provider is authenticated by something outside this
 * process.
 *
 * Read at call time rather than cached at construction, because a registry is
 * built once per job and tests set the variable per case.
 */
export function credentialIsManaged(provider: ManagedProvider): boolean {
  return managedProviders().has(provider);
}

/**
 * Whether this provider can make an authenticated call at all: it holds a
 * secret, or something in front of it does.
 *
 * This is the question `isConfigured()` was always standing in for.
 */
export function canAuthenticate(provider: ManagedProvider, held: string | undefined): boolean {
  return Boolean(held && held.length > 0) || credentialIsManaged(provider);
}

/**
 * Authorization headers for a provider, given what it holds.
 *
 * Returns the header when there is a secret to put in it, and an empty object
 * when the gateway is writing it. Never invents a value.
 */
export function authHeaders(
  provider: ManagedProvider,
  held: string | undefined,
  build: (secret: string) => Record<string, string>,
): Record<string, string> {
  if (held && held.length > 0) return build(held);
  if (credentialIsManaged(provider)) return {};
  return {};
}

/** A sentence for a health check, when the credential is not this process's to show. */
export function managedCredentialNote(provider: ManagedProvider): string {
  return `No ${provider} credential is held in this process; calls are authenticated by the egress gateway.`;
}
