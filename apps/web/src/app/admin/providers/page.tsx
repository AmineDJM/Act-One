import { PROVIDER_SLOTS, getPlatformConfig, listProviderState } from '@/server/platform.ts';
import { isUsingMemoryStore } from '@/server/store.ts';
import { ProviderCard } from './ProviderCard.tsx';
import { RoutingForm } from './RoutingForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  const [states, config] = await Promise.all([listProviderState(), getPlatformConfig()]);
  const byId = new Map(states.map((state) => [state.id, state]));

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
          routing={{
            llm: config.providers.llm.routing,
            browser: {
              primary: config.providers.browser.primary,
              fallback: config.providers.browser.fallback,
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
