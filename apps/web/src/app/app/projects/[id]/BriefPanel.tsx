'use client';

import { useActionState, useEffect, useState } from 'react';
import { DURATION_CHOICES, FILM_LANGUAGES, TONE_LABELS, Tone, languageName } from '@act-one/core';
import { updateBriefAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

/**
 * The three things a customer most wants to decide and used to have nowhere
 * to say: how long, in what tone, in which language. Everything else about
 * the film is inferred, and stays that way.
 *
 * Editable until the film is rendered. A change applies to the next step —
 * the storyboard, if it has not been built yet, or the next revision.
 */
export function BriefPanel({
  projectId,
  brief,
  maxDurationSeconds,
  editable,
}: {
  projectId: string;
  brief: { durationSeconds: number | null; language: string | null; tone: Tone | null };
  maxDurationSeconds: number;
  editable: boolean;
}) {
  const [state, save, saving] = useActionState<FormState, FormData>(updateBriefAction, {
    error: null,
  });
  const [editing, setEditing] = useState(false);

  // A saved brief closes the form and shows the values it now holds.
  useEffect(() => {
    if (state.message && !state.error) setEditing(false);
  }, [state]);
  const durations = DURATION_CHOICES.filter((seconds) => seconds <= maxDurationSeconds);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>The brief</h3>
        {editable && !editing ? (
          <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)}>
            Change
          </button>
        ) : null}
      </div>

      {editing ? (
        <form action={save} className="stack" style={{ gap: 'var(--space-3)' }}>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="field">
            <label htmlFor="brief-duration">Length</label>
            <select
              id="brief-duration"
              name="duration"
              className="input"
              defaultValue={brief.durationSeconds ?? ''}
            >
              <option value="">Let the concept decide</option>
              {durations.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
            <span className="hint">Your plan renders up to {maxDurationSeconds} seconds.</span>
          </div>
          <div className="field">
            <label htmlFor="brief-tone">Tone</label>
            <select id="brief-tone" name="tone" className="input" defaultValue={brief.tone ?? ''}>
              <option value="">From your brand&rsquo;s own writing</option>
              {Tone.options.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABELS[tone]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="brief-language">Language</label>
            <select
              id="brief-language"
              name="language"
              className="input"
              defaultValue={brief.language ?? ''}
            >
              <option value="">The language of your site</option>
              {FILM_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <span className="hint">
            Applies to the next step: the storyboard, or the next revision.
          </span>
          {state.error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
              {state.error}
            </p>
          ) : null}
        </form>
      ) : (
        <dl className={styles.kv}>
          <div className={styles.kvRow}>
            <dt>Length</dt>
            <dd>
              {brief.durationSeconds
                ? `${brief.durationSeconds} seconds`
                : 'Decided by the concept'}
            </dd>
          </div>
          <div className={styles.kvRow}>
            <dt>Tone</dt>
            <dd>
              {brief.tone
                ? TONE_LABELS[brief.tone].split(' — ')[0]
                : 'From your brand’s own writing'}
            </dd>
          </div>
          <div className={styles.kvRow}>
            <dt>Language</dt>
            <dd>{languageName(brief.language) ?? 'The language of your site'}</dd>
          </div>
          {!editable ? (
            <p className="hint">
              Fixed once the film is rendered. Start a new project to change them.
            </p>
          ) : null}
        </dl>
      )}
      {state.message && !editing ? (
        <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
