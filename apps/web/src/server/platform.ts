import 'server-only';
import {
  DEFAULT_PLANS,
  DEFAULT_CREATIVE_BUDGET,
  Plan,
  CreativeBudget,
  type Entitlement,
  type Organization,
} from '@act-one/core';
import {
  AesSecretVault,
  DEFAULT_PROVIDER_CONFIG,
  ProviderConfig,
  ProviderRegistry,
  generateVaultKey,
  installProxyFromEnvironment,
  secretContext,
  type ProviderHealth,
  type SecretVault,
} from '@act-one/providers';
import { DbCostSink } from '@act-one/db';
import { getStore } from './store.ts';

/**
 * Platform configuration.
 *
 * Everything an operator needs to run this — which vendors are enabled, which
 * API keys they use, what the plans cost, what each plan unlocks — is stored in
 * the database and edited from the Super Admin console. No redeploy, no
 * environment variable, no config file.
 *
 * Environment variables remain supported as a *fallback* so a fresh deploy can
 * boot before anybody has signed in, but once a key is set in the console the
 * stored one wins.
 */
export const PROVIDER_SLOTS = [
  {
    id: 'openai',
    label: 'OpenAI',
    purpose: 'Reads the product, writes the concepts, checks the finished film.',
    required: true,
    fields: [{ key: 'apiKey', label: 'API key', placeholder: 'sk-…', secret: true, envVar: 'OPENAI_API_KEY' }],
    envFallback: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'browserbase',
    label: 'Browserbase',
    purpose: 'Isolated browsers for reading sites and exploring customer products.',
    required: false,
    fields: [
      { key: 'apiKey', label: 'API key', placeholder: 'bb_…', secret: true, envVar: 'BROWSERBASE_API_KEY' },
      { key: 'projectId', label: 'Project ID', placeholder: 'uuid', secret: false, envVar: 'BROWSERBASE_PROJECT_ID' },
    ],
    envFallback: 'BROWSERBASE_API_KEY',
    docsUrl: 'https://www.browserbase.com/settings',
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    purpose: 'Generated cinematic shots, used sparingly for mood and metaphor.',
    required: false,
    fields: [
      { key: 'apiKey', label: 'API key', placeholder: 'hf_…', secret: true, envVar: 'HIGGSFIELD_API_KEY' },
      { key: 'apiSecret', label: 'API secret', placeholder: 'optional', secret: true, envVar: 'HIGGSFIELD_API_SECRET' },
    ],
    envFallback: 'HIGGSFIELD_API_KEY',
    docsUrl: 'https://higgsfield.ai',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    purpose: 'Subscriptions, credits and the customer billing portal.',
    required: false,
    fields: [
      { key: 'secretKey', label: 'Secret key', placeholder: 'sk_live_…', secret: true, envVar: 'STRIPE_SECRET_KEY' },
      { key: 'webhookSecret', label: 'Webhook signing secret', placeholder: 'whsec_…', secret: true, envVar: 'STRIPE_WEBHOOK_SECRET' },
    ],
    envFallback: 'STRIPE_SECRET_KEY',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
  },
  {
    id: 'supabase',
    label: 'Supabase Storage',
    purpose:
      'Optional. Assets are written to local disk by default, which is enough for a single box — point this at a bucket when the disk is ephemeral or more than one machine renders.',
    required: false,
    fields: [
      { key: 'url', label: 'Project URL', placeholder: 'https://xyz.supabase.co', secret: false, envVar: 'SUPABASE_URL' },
      { key: 'serviceKey', label: 'Service role key', placeholder: 'eyJ…', secret: true, envVar: 'SUPABASE_SERVICE_ROLE_KEY' },
      { key: 'bucket', label: 'Bucket', placeholder: 'act-one', secret: false, envVar: 'SUPABASE_STORAGE_BUCKET' },
    ],
    envFallback: 'SUPABASE_SERVICE_ROLE_KEY',
    docsUrl: 'https://supabase.com/dashboard/project/_/settings/api',
  },
] as const;

export type ProviderSlotId = (typeof PROVIDER_SLOTS)[number]['id'];

let vault: SecretVault | null = null;

/**
 * The secret vault.
 *
 * In production a key must be configured — refusing to boot is the correct
 * behaviour, because the alternative is storing customer credentials under a
 * key that changes on every deploy and silently losing them. In development an
 * ephemeral key is generated so the app runs on a fresh clone.
 */
export function getVault(): SecretVault {
  if (vault) return vault;

  if (process.env.ACT_ONE_SECRET_KEYS) {
    vault = AesSecretVault.fromEnv();
    return vault;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ACT_ONE_SECRET_KEYS is not set. Refusing to store secrets under a key that does not survive a restart.',
    );
  }

  const key = generateVaultKey();
  console.warn(
    '[platform] ACT_ONE_SECRET_KEYS not set — generated an ephemeral development key. ' +
      'Stored credentials will not survive a restart.',
  );
  vault = new AesSecretVault({ dev: key }, 'dev');
  return vault;
}

export type ProviderCredentialState = {
  id: ProviderSlotId;
  configured: boolean;
  /** Non-reversible, safe to display. */
  fingerprint: string | null;
  source: 'console' | 'environment' | 'none';
  updatedAt: string | null;
  enabled: boolean;
};

/** Reads credential values for a provider, preferring the console over env. */
export async function readProviderCredentials(
  id: ProviderSlotId,
): Promise<Record<string, string>> {
  const stored = await getStore().platform.getProviderSecret(id);
  if (stored && stored.enabled) {
    try {
      const plaintext = getVault().decrypt(
        stored.ciphertext as never,
        secretContext.providerKey(id),
      );
      return JSON.parse(plaintext) as Record<string, string>;
    } catch {
      // A vault key rotation that lost the old key lands here. Fall through to
      // the environment rather than taking the platform down.
      console.error(`[platform] could not decrypt stored credentials for ${id}`);
    }
  }
  return credentialsFromEnv(id);
}

function credentialsFromEnv(id: ProviderSlotId): Record<string, string> {
  // Derived from the slot table rather than repeated here: two lists of the
  // same environment variable names drift, and the one that drifts is always
  // the one nobody is looking at.
  const slot = PROVIDER_SLOTS.find((candidate) => candidate.id === id);
  if (!slot) return {};
  return clean(
    Object.fromEntries(
      slot.fields.map((field) => [field.key, process.env[field.envVar]?.trim() || undefined]),
    ),
  );
}

/** Every environment variable the console knows how to route, by slot. */
export const ENV_VAR_ROUTES: { envVar: string; provider: ProviderSlotId; field: string }[] =
  PROVIDER_SLOTS.flatMap((slot) =>
    slot.fields.map((field) => ({ envVar: field.envVar, provider: slot.id, field: field.key })),
  );

/**
 * A hung database connection blocks until the pool's own timeout, which is far
 * longer than a page should ever wait. Bound it explicitly.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function clean(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as Record<string, string>;
}

export async function saveProviderCredentials(
  id: ProviderSlotId,
  values: Record<string, string>,
  updatedBy: string,
): Promise<void> {
  const cleaned = clean(values);
  const plaintext = JSON.stringify(cleaned);
  const vaultInstance = getVault();

  await getStore().platform.setProviderSecret(
    id,
    vaultInstance.encrypt(plaintext, secretContext.providerKey(id)),
    // Fingerprint the primary secret so the console can show "••••ab12" and an
    // operator can confirm which key is live without revealing it.
    vaultInstance.fingerprint(Object.values(cleaned)[0] ?? ''),
    updatedBy,
  );
}

export async function listProviderState(): Promise<ProviderCredentialState[]> {
  // The console is staff-only and should show the truth, so a failure here is
  // surfaced as "nothing stored" rather than pretending everything is fine.
  const stored = await getStore()
    .platform.listProviderSecrets()
    .catch(() => [] as Awaited<ReturnType<ReturnType<typeof getStore>['platform']['listProviderSecrets']>>);
  const byProvider = new Map(stored.map((row) => [row.provider, row]));

  return PROVIDER_SLOTS.map((slot) => {
    const row = byProvider.get(slot.id);
    const fromEnv = Object.keys(credentialsFromEnv(slot.id)).length > 0;
    return {
      id: slot.id,
      configured: Boolean(row) || fromEnv,
      fingerprint: row?.fingerprint ?? null,
      source: row ? ('console' as const) : fromEnv ? ('environment' as const) : ('none' as const),
      updatedAt: row?.updatedAt ?? null,
      enabled: row?.enabled ?? fromEnv,
    };
  });
}

/** Live check against the vendor, so the console can show a real verdict. */
export async function testProvider(id: ProviderSlotId): Promise<ProviderHealth> {
  // Idempotent. A connection test that bypasses the egress proxy would report
  // a healthy key as broken, or a broken one as healthy.
  await installProxyFromEnvironment();
  const credentials = await readProviderCredentials(id);
  const { OpenAiLlmProvider, BrowserbaseProvider, HiggsfieldProvider, SupabaseStorageProvider } =
    await import('@act-one/providers');

  switch (id) {
    case 'openai':
      return new OpenAiLlmProvider({ apiKey: credentials['apiKey'] }).health();
    case 'browserbase':
      return new BrowserbaseProvider({
        apiKey: credentials['apiKey'],
        projectId: credentials['projectId'],
      }).health();
    case 'higgsfield':
      return new HiggsfieldProvider({
        apiKey: credentials['apiKey'],
        apiSecret: credentials['apiSecret'],
      }).health();
    case 'supabase':
      return new SupabaseStorageProvider({
        url: credentials['url'],
        serviceKey: credentials['serviceKey'],
        bucket: credentials['bucket'],
      }).health();
    case 'stripe': {
      const { testStripe } = await import('./stripe.ts');
      return testStripe(credentials['secretKey']);
    }
    default:
      return {
        provider: id,
        kind: 'llm',
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: 'Unknown provider.',
      };
  }
}

export type PlatformConfig = {
  providers: ProviderConfig;
  plans: Plan[];
  featureFlags: Record<string, boolean>;
  creativeBudget: CreativeBudget;
};

const FALLBACK_CONFIG: PlatformConfig = {
  providers: DEFAULT_PROVIDER_CONFIG,
  plans: DEFAULT_PLANS,
  featureFlags: {},
  creativeBudget: DEFAULT_CREATIVE_BUDGET,
};

/**
 * Platform configuration, with a fallback that keeps public pages alive.
 *
 * The pricing page reads plans from here so an operator can run a pricing
 * experiment without a deploy. That is worth it — but it also means a database
 * blip would take down the page that converts visitors, which is not a trade
 * anybody would accept. So a failed or slow read falls back to the seeded
 * catalogue and logs, rather than throwing.
 *
 * The fallback is only ever the *defaults*, never a stale edit, so it cannot
 * quietly serve prices somebody deliberately changed.
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  let settings: Awaited<ReturnType<ReturnType<typeof getStore>['platform']['getSettings']>>;
  try {
    settings = await withTimeout(getStore().platform.getSettings(), 2500);
  } catch (error) {
    console.error('[platform] falling back to default configuration:', (error as Error).message);
    return FALLBACK_CONFIG;
  }

  const providers = ProviderConfig.safeParse(settings.providerConfig);
  const plans = Plan.array().safeParse(settings.plans);
  const budget = CreativeBudget.safeParse(settings.creativeBudget);

  return {
    providers: providers.success ? providers.data : DEFAULT_PROVIDER_CONFIG,
    // Falls back to the seeded catalogue rather than an empty list: a platform
    // with no plans would deny every entitlement to every customer.
    plans: plans.success && plans.data.length > 0 ? plans.data : DEFAULT_PLANS,
    featureFlags: settings.featureFlags ?? {},
    creativeBudget: budget.success ? budget.data : DEFAULT_CREATIVE_BUDGET,
  };
}

export async function savePlatformConfig(
  patch: Partial<PlatformConfig>,
  updatedBy: string,
): Promise<PlatformConfig> {
  await getStore().platform.updateSettings(
    {
      ...(patch.providers ? { providerConfig: patch.providers as Record<string, unknown> } : {}),
      ...(patch.plans ? { plans: patch.plans } : {}),
      ...(patch.featureFlags ? { featureFlags: patch.featureFlags } : {}),
      ...(patch.creativeBudget
        ? { creativeBudget: patch.creativeBudget as unknown as Record<string, unknown> }
        : {}),
    },
    updatedBy,
  );
  return getPlatformConfig();
}

/**
 * Builds a provider registry using whatever Super Admin has configured.
 *
 * Credentials are injected here rather than read from the environment inside
 * each provider, which is what makes the console the single source of truth.
 */
export async function buildRegistry(scope: {
  organizationId: string;
  projectId?: string | null;
  renderId?: string | null;
}): Promise<ProviderRegistry> {
  // Node's fetch ignores HTTPS_PROXY, so on a deploy behind an egress proxy
  // every provider call fails in a way that looks like a bad key. Installing it
  // here covers both the registry and the console's own connection tests.
  await installProxyFromEnvironment();

  const config = await getPlatformConfig();
  const [openai, browserbase, higgsfield, supabase] = await Promise.all([
    readProviderCredentials('openai'),
    readProviderCredentials('browserbase'),
    readProviderCredentials('higgsfield'),
    readProviderCredentials('supabase'),
  ]);

  const costSink = new DbCostSink(getStore(), scope);
  const {
    OpenAiLlmProvider,
    BrowserbaseProvider,
    LocalChromiumProvider,
    HiggsfieldProvider,
    OpenAiSpeechProvider,
    SupabaseStorageProvider,
    LocalFsStorageProvider,
  } = await import('@act-one/providers');

  const browserConfigured = Boolean(openai && browserbase['apiKey'] && browserbase['projectId']);

  return new ProviderRegistry({
    config: config.providers,
    costSink,
    overrides: {
      llm: new OpenAiLlmProvider({
        apiKey: openai['apiKey'],
        costSink,
        routing: config.providers.llm.routing,
      }),
      browser: browserConfigured
        ? new BrowserbaseProvider({
            apiKey: browserbase['apiKey'],
            projectId: browserbase['projectId'],
            costSink,
          })
        : new LocalChromiumProvider({ costSink }),
      ...(higgsfield['apiKey']
        ? {
            media: new HiggsfieldProvider({
              apiKey: higgsfield['apiKey'],
              apiSecret: higgsfield['apiSecret'],
              costSink,
              maxCostPerRequestUsd: config.providers.media.maxCostPerRequestUsd,
            }),
          }
        : {}),
      speech: new OpenAiSpeechProvider({ apiKey: openai['apiKey'], costSink }),
      storage:
        supabase['url'] && supabase['serviceKey']
          ? new SupabaseStorageProvider({
              url: supabase['url'],
              serviceKey: supabase['serviceKey'],
              bucket: supabase['bucket'],
            })
          : new LocalFsStorageProvider(),
    },
  });
}

/** Entitlements for an organisation, resolved through its live subscription. */
export async function entitlementsFor(
  organization: Organization,
): Promise<{ plan: Plan; entitlements: Set<Entitlement> }> {
  const { plans } = await getPlatformConfig();
  const subscription = await getStore().subscriptions.getForOrganization(organization.id);

  // One definition, shared with the worker. Two copies of "what is this
  // customer entitled to" is how a page offers 4K that the renderer does not
  // make, or a lapsed subscription keeps a feature on one side and loses it on
  // the other.
  const { effectivePlan } = await import('@act-one/core');
  const plan = effectivePlan({
    plans,
    organization,
    subscription: subscription
      ? { planId: subscription.planId, status: subscription.status }
      : null,
  });

  return { plan, entitlements: new Set(plan.entitlements) };
}
