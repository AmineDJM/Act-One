import { AesSecretVault, DEFAULT_PROVIDER_CONFIG, ProviderConfig, ProviderRegistry, secretContext, type SecretVault } from '@act-one/providers';
import { Database, DbCostSink, PgStore, type Store } from '@act-one/db';
import { Plan, DEFAULT_PLANS } from '@act-one/core';

/**
 * Worker configuration.
 *
 * The worker reads the SAME platform settings the Super Admin console writes,
 * so an operator changing a key or a routing rule changes what the next job
 * does — without redeploying the worker. That is the whole point of storing
 * configuration rather than baking it into the environment.
 */
export type WorkerConfig = {
  store: Store;
  database: Database;
  vault: SecretVault;
  concurrency: number;
  workerId: string;
  pollIntervalMs: number;
  /** Jobs whose lock is older than this are reclaimed. */
  staleLockMs: number;
};

export function loadConfig(): WorkerConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. The worker has nothing to do without a queue.');
  }
  if (!process.env.ACT_ONE_SECRET_KEYS) {
    throw new Error(
      'ACT_ONE_SECRET_KEYS is required. The worker decrypts provider keys and customer product credentials.',
    );
  }

  const database = new Database({ connectionString, max: Number(process.env.PGPOOL_MAX ?? 6) });

  return {
    database,
    store: new PgStore(database),
    vault: AesSecretVault.fromEnv(),
    // Renders are CPU and memory heavy. More than a couple in parallel on one
    // host makes every one of them slower and risks the OOM killer taking the
    // whole worker rather than one job.
    concurrency: Number(process.env.ACT_ONE_WORKER_CONCURRENCY ?? 2),
    workerId: `${process.env.RENDER_INSTANCE_ID ?? process.env.HOSTNAME ?? 'worker'}-${process.pid}`,
    pollIntervalMs: Number(process.env.ACT_ONE_POLL_INTERVAL_MS ?? 2000),
    staleLockMs: Number(process.env.ACT_ONE_STALE_LOCK_MS ?? 20 * 60_000),
  };
}

/**
 * Builds a registry from stored platform settings, scoped to one tenant.
 *
 * Mirrors the web app's builder deliberately: if the two diverged, a film
 * rendered by the worker could use a different model than the console reports,
 * and the cost ledger would be describing something that did not happen.
 */
export async function buildRegistry(
  config: WorkerConfig,
  scope: { organizationId: string; projectId?: string | null; renderId?: string | null },
): Promise<ProviderRegistry> {
  const settings = await config.store.platform.getSettings();
  const parsed = ProviderConfig.safeParse(settings.providerConfig);
  const providerConfig = parsed.success ? parsed.data : DEFAULT_PROVIDER_CONFIG;

  const credentials = await readAll(config, ['openai', 'browserbase', 'higgsfield', 'supabase']);
  const costSink = new DbCostSink(config.store, scope);

  const {
    OpenAiLlmProvider,
    BrowserbaseProvider,
    LocalChromiumProvider,
    HiggsfieldProvider,
    OpenAiSpeechProvider,
    SupabaseStorageProvider,
    LocalFsStorageProvider,
  } = await import('@act-one/providers');

  const browserbase = credentials['browserbase'] ?? {};
  const higgsfield = credentials['higgsfield'] ?? {};
  const supabase = credentials['supabase'] ?? {};
  const openai = credentials['openai'] ?? {};

  return new ProviderRegistry({
    config: providerConfig,
    costSink,
    overrides: {
      llm: new OpenAiLlmProvider({
        apiKey: openai['apiKey'],
        costSink,
        routing: providerConfig.llm.routing,
      }),
      browser:
        browserbase['apiKey']
          ? new BrowserbaseProvider({
              apiKey: browserbase['apiKey'],
              projectId: browserbase['projectId'],
              costSink,
            })
          : new LocalChromiumProvider({ costSink }),
      ...(higgsfield['credentials'] || (higgsfield['apiKey'] && higgsfield['apiSecret'])
        ? {
            media: new HiggsfieldProvider({
              credentials: higgsfield['credentials'],
              // Entries saved before the console asked for the single credential.
              apiKey: higgsfield['apiKey'],
              apiSecret: higgsfield['apiSecret'],
              costSink,
              maxCostPerRequestUsd: providerConfig.media.maxCostPerRequestUsd,
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

async function readAll(
  config: WorkerConfig,
  providers: string[],
): Promise<Record<string, Record<string, string>>> {
  const entries = await Promise.all(
    providers.map(async (provider) => {
      const stored = await config.store.platform.getProviderSecret(provider);
      if (stored?.enabled) {
        try {
          return [
            provider,
            JSON.parse(
              config.vault.decrypt(stored.ciphertext as never, secretContext.providerKey(provider)),
            ) as Record<string, string>,
          ] as const;
        } catch {
          console.error(`[worker] could not decrypt credentials for ${provider}`);
        }
      }
      return [provider, fromEnv(provider)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function fromEnv(provider: string): Record<string, string> {
  const pick = (name: string) => process.env[name]?.trim();
  const clean = (values: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v)) as Record<string, string>;

  switch (provider) {
    case 'openai':
      return clean({ apiKey: pick('OPENAI_API_KEY') });
    case 'browserbase':
      return clean({ apiKey: pick('BROWSERBASE_API_KEY'), projectId: pick('BROWSERBASE_PROJECT_ID') });
    case 'higgsfield':
      return clean({ credentials: pick('HF_CREDENTIALS') ?? pick('HF_KEY') });
    case 'supabase':
      return clean({
        url: pick('SUPABASE_URL'),
        serviceKey: pick('SUPABASE_SERVICE_ROLE_KEY'),
        bucket: pick('SUPABASE_STORAGE_BUCKET'),
      });
    default:
      return {};
  }
}

export function loadPlans(raw: unknown): Plan[] {
  const parsed = Plan.array().safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : DEFAULT_PLANS;
}
