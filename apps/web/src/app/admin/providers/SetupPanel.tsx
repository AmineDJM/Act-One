'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  importEnvBlockAction,
  testAllProvidersAction,
  type ImportResult,
  type ProviderHealthSummary,
} from '../actions.ts';
import styles from '../admin.module.css';

export type Readiness = {
  /** Integrations that must work before anybody can make a film. */
  blocking: { label: string; ready: boolean; note: string }[];
  /** Things that widen what the platform can do, but are not required. */
  optional: { label: string; ready: boolean; note: string }[];
};

/**
 * Setup, in one place, at the top of the page.
 *
 * Everything below this panel is per-integration detail. This is the part an
 * operator uses on day one: paste what you already have, see what is still
 * missing, check that all of it works.
 */
export function SetupPanel({ readiness }: { readiness: Readiness }) {
  const [importResult, importEnv, importing] = useActionState<ImportResult | null, FormData>(
    importEnvBlockAction,
    null,
  );
  const [health, setHealth] = useState<ProviderHealthSummary[] | null>(null);
  const [checking, startCheck] = useTransition();
  const [open, setOpen] = useState(false);

  const blockers = readiness.blocking.filter((item) => !item.ready);
  const live = blockers.length === 0;
  /*
   * Configured and verified are different claims.
   *
   * `readiness` says a credential is present. Only the check below calls each
   * provider and finds out whether it works — so until somebody has pressed
   * it, saying "verified" tells an operator their platform has been tested
   * when nothing has been tested, which is the one thing this panel exists to
   * be trusted about.
   */
  const verified = health !== null && health.every((entry) => entry.healthy);

  return (
    <section className={styles.setup} data-live={live}>
      <div className={styles.setupHead}>
        <div>
          <h2>{live ? 'Ready to make films' : 'Not ready yet'}</h2>
          <p className={styles.providerPurpose}>
            {live
              ? verified
                ? 'Everything required is configured, and answered when we called it. The rest below is optional and widens what the platform can do.'
                : 'Everything required is configured. Press “Check everything” to call each one and confirm it answers.'
              : `${blockers.length} required integration${blockers.length === 1 ? '' : 's'} still to configure.`}
          </p>
        </div>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => startCheck(async () => setHealth(await testAllProvidersAction()))}
          disabled={checking}
        >
          {checking ? 'Checking…' : 'Check everything'}
        </button>
      </div>

      <ul className={styles.checklist}>
        {[...readiness.blocking, ...readiness.optional].map((item) => (
          <li key={item.label} data-ready={item.ready} data-required={readiness.blocking.includes(item)}>
            <span className={styles.tick} aria-hidden="true">
              {item.ready ? '✓' : readiness.blocking.includes(item) ? '!' : '·'}
            </span>
            <strong>{item.label}</strong>
            <span>{item.note}</span>
          </li>
        ))}
      </ul>

      {health ? (
        <div className={styles.healthStrip} role="status">
          {health.length === 0 ? (
            <span className="muted">Nothing configured to check yet.</span>
          ) : (
            health.map((row) => (
              <span key={row.provider} data-ok={row.healthy} title={row.message ?? undefined}>
                {row.healthy ? '✓' : '✕'} {row.provider}
                {row.latencyMs !== null ? ` · ${row.latencyMs}ms` : ''}
              </span>
            ))
          )}
        </div>
      ) : null}

      <details className={styles.paste} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Paste what you already have</summary>
        <form action={importEnv}>
          <p className="hint">
            Your .env, your host&rsquo;s environment panel, the note in your password manager —
            paste the whole thing. Anything recognised is filed where it belongs, encrypted, and
            verified. Anything else is ignored and listed back to you.
          </p>
          <textarea
            name="env"
            className="input"
            rows={7}
            spellCheck={false}
            placeholder={'OPENAI_API_KEY=sk-…\nSTRIPE_SECRET_KEY=sk_live_…\nSTRIPE_WEBHOOK_SECRET=whsec_…'}
          />
          <div className={styles.pasteActions}>
            <button className="btn" type="submit" disabled={importing}>
              {importing ? 'Configuring…' : 'Configure from this'}
            </button>
            <span className="hint">Nothing is echoed back to this page once saved.</span>
          </div>
        </form>

        {importResult ? (
          <div className={styles.importResult} data-ok={importResult.ok} role="status">
            <strong>{importResult.message}</strong>
            {importResult.saved.length > 0 ? (
              <ul>
                {importResult.saved.map((row) => (
                  <li key={row.provider} data-ok={row.healthy}>
                    {row.healthy ? '✓' : '✕'} {row.provider} — {row.fields} value
                    {row.fields === 1 ? '' : 's'}
                    {row.message ? ` · ${row.message}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {importResult.unmatched.length > 0 ? (
              <p className="hint">
                Ignored: {importResult.unmatched.slice(0, 10).join(', ')}
                {importResult.unmatched.length > 10 ? ` and ${importResult.unmatched.length - 10} more` : ''}.
              </p>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}
