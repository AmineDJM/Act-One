'use client';

import { useActionState } from 'react';
import {
  adoptFromEnvironmentAction,
  saveProviderAction,
  testProviderAction,
  type ActionResult,
} from '../actions.ts';
import styles from '../admin.module.css';

/**
 * One integration, configured entirely from this card.
 *
 * The operator pastes a key and clicks Save; we store it encrypted and
 * immediately run a live call against the vendor so the verdict is real rather
 * than "saved, hope it works". Existing keys are never sent back to the
 * browser — the card shows a fingerprint and an empty field, and leaving that
 * field blank keeps the current value.
 */
export type ProviderCardProps = {
  id: string;
  label: string;
  purpose: string;
  required: boolean;
  docsUrl: string;
  fields: readonly { key: string; label: string; placeholder: string; secret: boolean }[];
  state: {
    configured: boolean;
    fingerprint: string | null;
    source: 'console' | 'environment' | 'none';
    updatedAt: string | null;
  };
};

export function ProviderCard(props: ProviderCardProps) {
  const [saveResult, save, saving] = useActionState<ActionResult | null, FormData>(
    saveProviderAction,
    null,
  );
  const [testResult, test, testing] = useActionState<ActionResult | null, FormData>(
    testProviderAction,
    null,
  );
  const [adoptResult, adopt, adopting] = useActionState<ActionResult | null, FormData>(
    adoptFromEnvironmentAction,
    null,
  );

  const result = adoptResult ?? saveResult ?? testResult;
  const statusLabel = props.state.configured
    ? props.state.source === 'console'
      ? 'Configured'
      : 'From environment'
    : props.required
      ? 'Required'
      : 'Not configured';

  return (
    <section className={styles.provider}>
      <div className={styles.providerHead}>
        <div>
          <div className={styles.providerTitle}>
            {props.label}
            <span
              className={`badge ${
                props.state.configured ? 'badge--ok' : props.required ? 'badge--bad' : ''
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className={styles.providerPurpose}>{props.purpose}</p>
        </div>
        <a
          href={props.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn--ghost"
          style={{ height: 34, fontSize: '0.85rem' }}
        >
          Get a key ↗
        </a>
      </div>

      <form action={save}>
        <input type="hidden" name="provider" value={props.id} />
        <div className={styles.providerBody}>
          {props.fields.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`${props.id}-${field.key}`}>{field.label}</label>
              <input
                id={`${props.id}-${field.key}`}
                name={field.key}
                className="input"
                type={field.secret ? 'password' : 'text'}
                placeholder={
                  props.state.configured && field.secret
                    ? `•••••••• ${props.state.fingerprint ?? ''}`
                    : field.placeholder
                }
                autoComplete="off"
                spellCheck={false}
              />
              {props.state.configured && field.secret ? (
                <span className="hint">Leave blank to keep the current value.</span>
              ) : null}
            </div>
          ))}
        </div>

        <div className={styles.providerActions}>
          {props.state.source === 'environment' ? (
            /*
             * The key already works — it is in the environment — but it lives
             * outside the console, so it cannot be rotated without a redeploy
             * and this page can only report it rather than own it. One click
             * moves it into the vault.
             */
            <button className="btn" type="submit" formAction={adopt} disabled={adopting}>
              {adopting ? 'Adopting…' : 'Adopt from environment'}
            </button>
          ) : null}
          <button
            className={props.state.source === 'environment' ? 'btn btn--secondary' : 'btn'}
            type="submit"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save & verify'}
          </button>
          <button className="btn btn--secondary" type="submit" formAction={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {props.state.updatedAt ? (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Updated {new Date(props.state.updatedAt).toLocaleDateString()}
            </span>
          ) : null}
          {result ? (
            <span className={styles.verdict} data-ok={result.ok} role="status">
              {result.ok ? '✓ ' : '✕ '}
              {result.message}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
