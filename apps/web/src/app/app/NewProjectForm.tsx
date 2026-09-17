'use client';

import { useActionState, useState } from 'react';
import { createProjectAction, type FormState } from './actions.ts';

export function NewProjectForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, {
    error: null,
  });
  const [showOptional, setShowOptional] = useState(false);

  return (
    <form action={action} className="stack" style={{ gap: 'var(--space-3)' }}>
      <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <input
          name="website"
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://yourproduct.com"
          aria-label="Product website"
          required
          style={{ flex: 1, minWidth: 240 }}
        />
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Understand my product'}
        </button>
      </div>

      {showOptional ? (
        <div className="field">
          <label htmlFor="supplemental">Anything else worth reading</label>
          <input
            id="supplemental"
            name="supplemental"
            className="input"
            placeholder="Product Hunt, LinkedIn, docs — separated by spaces"
          />
          <span className="hint">
            Optional. A link you point us at outranks anything we find ourselves.
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ alignSelf: 'flex-start', height: 30, fontSize: '0.85rem', paddingInline: 0 }}
          onClick={() => setShowOptional(true)}
        >
          + Add Product Hunt, LinkedIn or docs
        </button>
      )}

      {state.error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
