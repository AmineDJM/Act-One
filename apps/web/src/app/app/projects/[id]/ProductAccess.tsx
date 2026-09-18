'use client';

import { useActionState, useState } from 'react';
import { authorizeProductAction, revokeProductAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

export type AccessView = {
  loginUrl: string;
  username: string | null;
  kind: string;
  authorizedAt: string;
  lastUsedAt: string | null;
  allowedPaths: string[];
  deniedPaths: string[];
  audit: { action: string; detail: string; createdAt: string }[];
};

/**
 * Letting us sign into the customer's own product.
 *
 * This is the one place the product asks for something genuinely dangerous, so
 * the panel spends its words on what we will and will not do rather than on
 * persuading. Everything it promises is enforced on the server: the sign-in
 * page must belong to this product, billing and admin are refused whatever the
 * allowed list says, the password is sealed to this workspace and this project
 * and never comes back to a browser, and every page we open is written down
 * below.
 */
export function ProductAccess({
  projectId,
  productHost,
  access,
  canManage,
}: {
  projectId: string;
  productHost: string;
  access: AccessView | null;
  canManage: boolean;
}) {
  const [authState, authorize, authorizing] = useActionState<FormState, FormData>(
    authorizeProductAction,
    { error: null },
  );
  const [revokeState, revoke, revoking] = useActionState<FormState, FormData>(revokeProductAction, {
    error: null,
  });
  const [open, setOpen] = useState(false);

  const result = authState.error ?? revokeState.error;

  if (access) {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h3>Your product</h3>
          <span className="badge badge--ok">Connected</span>
        </div>

        <dl className={styles.kv}>
          <div className={styles.kvRow}>
            <dt>Sign-in</dt>
            <dd className="mono">{access.loginUrl}</dd>
          </div>
          {access.username ? (
            <div className={styles.kvRow}>
              <dt>As</dt>
              <dd>{access.username}</dd>
            </div>
          ) : null}
          <div className={styles.kvRow}>
            <dt>Authorised</dt>
            <dd>{new Date(access.authorizedAt).toLocaleString()}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt>Last used</dt>
            <dd>{access.lastUsedAt ? new Date(access.lastUsedAt).toLocaleString() : 'Not yet'}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt>Never visits</dt>
            {/* Wraps as a list of chips rather than one long ragged line. */}
            <dd>
              <span className={styles.pathList}>
                {access.deniedPaths.map((path) => (
                  <code key={path}>{path}</code>
                ))}
              </span>
            </dd>
          </div>
        </dl>

        {access.audit.length > 0 ? (
          <details className={styles.auditTrail}>
            <summary>Everything we did with it ({access.audit.length})</summary>
            <ol>
              {access.audit.map((event, index) => (
                <li key={`${event.createdAt}-${index}`} data-action={event.action}>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleTimeString('en-GB', { hour12: false })}
                  </time>
                  <span className={styles.cite}>{event.action.replace(/_/g, ' ')}</span>
                  <span>{event.detail}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {canManage ? (
          <form action={revoke}>
            <input type="hidden" name="projectId" value={projectId} />
            <button className="btn btn--secondary" type="submit" disabled={revoking}>
              {revoking ? 'Withdrawing…' : 'Withdraw access'}
            </button>
          </form>
        ) : null}

        {result ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
            {result}
          </p>
        ) : null}
      </section>
    );
  }

  if (!canManage) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Show the real product</h3>
        <span className="badge">Optional</span>
      </div>

      <p className="secondary" style={{ fontSize: '0.9rem' }}>
        Without this we film your product in type and motion, using what {productHost} says
        publicly. With it we sign in, find the moments worth showing, and film the real interface —
        which is the difference between a film about your product and a film of it.
      </p>

      <ul className={styles.promises}>
        <li data-yes="true">We read and we film. We never click anything that changes your data.</li>
        <li data-yes="true">Billing, admin and anything destructive are refused, whatever we are pointed at.</li>
        <li data-yes="true">The password is encrypted to this workspace and this production alone, and never shown again.</li>
        <li data-yes="true">Every page we open is listed here afterwards.</li>
        <li data-yes="false">We only sign in at {productHost}. Not anywhere else, ever.</li>
        <li data-yes="false">Use a demo or read-only account if you have one.</li>
      </ul>

      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className={styles.accessSummary}>Connect {productHost}</summary>

        <form action={authorize} className={styles.accessForm}>
          <input type="hidden" name="projectId" value={projectId} />

          <div className="field">
            <label htmlFor="loginUrl">Sign-in page</label>
            <input
              id="loginUrl"
              name="loginUrl"
              className="input"
              type="url"
              required
              placeholder={`https://app.${productHost}/login`}
            />
            <span className="hint">Must be {productHost} or a subdomain of it.</span>
          </div>

          <div className="field">
            <label htmlFor="kind">Sign in with</label>
            <select id="kind" name="kind" className="input" defaultValue="password">
              <option value="password">Email and password</option>
              <option value="api_token">A token</option>
              <option value="shared_demo_url">A shared demo link</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="username">Email or username</label>
            <input id="username" name="username" className="input" autoComplete="off" />
          </div>

          <div className="field">
            <label htmlFor="secret">Password or token</label>
            <input
              id="secret"
              name="secret"
              className="input"
              type="password"
              required
              autoComplete="off"
            />
            <span className="hint">Encrypted before it is stored. Never sent back to this page.</span>
          </div>

          <div className="field">
            <label htmlFor="allowedPaths">Only these areas (optional)</label>
            <input
              id="allowedPaths"
              name="allowedPaths"
              className="input"
              placeholder="/dashboard, /issues, /reports"
            />
            <span className="hint">Leave blank and we will find the moments worth filming.</span>
          </div>

          <div className="field">
            <label htmlFor="deniedPaths">And never these</label>
            <input id="deniedPaths" name="deniedPaths" className="input" placeholder="/exports" />
            <span className="hint">Billing and admin are already refused.</span>
          </div>

          <label className={styles.consent}>
            <input type="checkbox" name="confirmed" required />
            <span>
              I can authorise this, and I authorise Act One to sign in to {productHost} as this
              account and film what it finds.
            </span>
          </label>

          <button className="btn" type="submit" disabled={authorizing}>
            {authorizing ? 'Connecting…' : 'Authorise and explore'}
          </button>
        </form>
      </details>

      {result ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
          {result}
        </p>
      ) : null}
    </section>
  );
}
