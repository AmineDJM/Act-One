import { PROVIDER_SLOTS, getPlatformConfig, listProviderState } from '@/server/platform.ts';
import { isUsingMemoryStore } from '@/server/store.ts';
import { ProviderCard } from './ProviderCard.tsx';
import { SetupPanel, type Readiness } from './SetupPanel.tsx';
import { RoutingForm } from './RoutingForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  const [states, config] = await Promise.all([listProviderState(), getPlatformConfig()]);
  const byId = new Map(states.map((state) => [state.id, state]));

  /*
   * What is actually stopping this platform from making a film, in the order
   * an operator cares about. Only OpenAI is genuinely required: research falls
   * back to a local Chromium, storage falls back to local disk, and a platform
   * with no Stripe simply cannot charge anyone yet.
   */
  const state = (id: string) => byId.get(id as never);
  const readiness: Readiness = {
    blocking: [
      {
        label: 'OpenAI',
        ready: Boolean(state('openai')?.configured),
        note: 'Reads the product, writes the concepts, checks the film.',
      },
      {
        label: 'A database',
        ready: !isUsingMemoryStore(),
        note: isUsingMemoryStore()
          ? 'DATABASE_URL is not set, so nothing survives a restart.'
          : 'Connected.',
      },
    ],
    optional: [
      {
        label: 'Stripe',
        ready: Boolean(state('stripe')?.configured),
        note: state('stripe')?.configured
          ? 'Subscriptions and credits are live.'
          : 'Until this is set, nobody can be charged and every workspace stays on the free plan.',
      },
      {
        label: 'Browserbase',
        ready: Boolean(state('browserbase')?.configured),
        note: state('browserbase')?.configured
          ? 'Research runs on isolated cloud browsers.'
          : state('browserbase')?.stored
            ? 'A key is on file and switched off, so research runs on the local Chromium instead. ' +
              'Switch it on below to use isolated cloud browsers.'
            : 'Research runs on the local Chromium instead, which is fine on one machine.',
      },
      {
        label: 'Higgsfield',
        ready: Boolean(state('higgsfield')?.configured),
        note: state('higgsfield')?.configured
          ? 'Seedance 2.5 shots are available for mood and metaphor.'
          : 'Films are rendered entirely by our own engine and real capture.',
      },
      {
        label: 'Voice',
        ready: true,
        note:
          config.providers.speech.primary === 'elevenlabs' && state('elevenlabs')?.configured
            ? 'Narration by ElevenLabs v3: a native voice per language, performing the direction.'
            : state('elevenlabs')?.configured
              ? 'ElevenLabs key saved. Choose it for finals under Routing to use it; OpenAI reads meanwhile.'
              : 'Narration by OpenAI, directed for the film’s language. Add ElevenLabs for the premium voice.',
      },
      {
        label: 'Object storage',
        ready: Boolean(state('supabase')?.configured),
        note: state('supabase')?.configured
          ? 'Assets are written to your bucket.'
          : 'Assets are written to local disk — fine for one box, lost on an ephemeral one.',
      },
    ],
  };

  return (
    <>
      <header className={styles.head}>
        <h1>Integrations</h1>
        <p className="lede">
          Paste a key, save, and it is verified against the vendor immediately. Keys are encrypted
          before they are stored and never sent back to this page — no config files, no redeploy.
        </p>
      </header>

      {isUsingMemoryStore() ? (
        <div className={styles.notice}>
          <strong>Development store.</strong> DATABASE_URL is not set, so everything here lives in
          memory and disappears on restart. Set DATABASE_URL and ACT_ONE_SECRET_KEYS to persist.
        </div>
      ) : null}

      <SetupPanel readiness={readiness} />

      <div className={styles.providerList}>
        {PROVIDER_SLOTS.map((slot) => (
          <ProviderCard
            key={slot.id}
            id={slot.id}
            label={slot.label}
            purpose={slot.purpose}
            required={slot.required}
            docsUrl={slot.docsUrl}
            fields={slot.fields}
            state={
              byId.get(slot.id) ?? {
                configured: false,
                fingerprint: null,
                source: 'none',
                updatedAt: null,
              }
            }
          />
        ))}

        <RoutingForm
          prices={config.providers.llm.prices}
          routing={{
            llm: config.providers.llm.routing,
            browser: {
              primary: config.providers.browser.primary,
              fallback: config.providers.browser.fallback,
            },
            speech: {
              primary: config.providers.speech.primary,
              preview: config.providers.speech.preview,
              recognizer: config.providers.speech.recognizer,
            },
            media: {
              enabled: config.providers.media.enabled,
              maxCostPerRequestUsd: config.providers.media.maxCostPerRequestUsd,
              maxCostPerSecondUsd: config.providers.media.maxCostPerSecondUsd,
              maxRetries: config.providers.media.maxRetries,
            },
          }}
          budget={config.creativeBudget}
        />
      </div>
    </>
  );
}
