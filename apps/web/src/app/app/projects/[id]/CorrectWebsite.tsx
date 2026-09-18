'use client';

import { useActionState } from 'react';
import { correctWebsiteAction, type FormState } from '../../actions.ts';

/**
 * Changing the address a project was started from.
 *
 * Only offered when the project has stopped, because at any other point the
 * whole brief is derived from what we already read and swapping the site under
 * it would silently invalidate concepts the customer has approved.
 *
 * It exists because a typo used to be fatal: research failed, the page offered
 * a retry that would fail identically forever, and nothing anywhere could edit
 * the URL. The only way out was to abandon the project, which nothing said.
 */
export function CorrectWebsite({ projectId, current }: { projectId: string; current: string }) {
  const [state, correct, pending] = useActionState<FormState, FormData>(correctWebsiteAction, {
    error: null,
  });

  return (
    <form action={correct} style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 520 }}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="field">
        <label htmlFor="correct-website">Read a different address</label>
        <input
          id="correct-website"
          name="website"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          defaultValue={current}
          placeholder="https://yourproduct.com"
        />
        <span className="hint">
          Everything is derived from what we read, so this starts again from the beginning.
        </span>
      </div>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <button className="btn btn--secondary" type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Read this instead'}
        </button>
      </div>

      {state.message ? (
        <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
