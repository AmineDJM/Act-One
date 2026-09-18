'use client';

import { useActionState, useState } from 'react';
import { DURATION_CHOICES, FILM_LANGUAGES, TONE_LABELS, Tone } from '@act-one/core';
import { createProjectAction, type FormState } from './actions.ts';

export function NewProjectForm({ maxDurationSeconds }: { maxDurationSeconds: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, {
    error: null,
  });
  const [showOptional, setShowOptional] = useState(false);
  const durations = DURATION_CHOICES.filter((seconds) => seconds <= maxDurationSeconds);

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
        <>
          {/*
           * The three decisions a customer wants to make up front. Each has a
           * "you decide" default, so the form stays one field for the people
           * who only have a URL.
           */}
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="duration">Length</label>
              <select id="duration" name="duration" className="input" defaultValue="">
                <option value="">Let the concept decide</option>
                {durations.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="tone">Tone</label>
              <select id="tone" name="tone" className="input" defaultValue="">
                <option value="">From your brand&rsquo;s own writing</option>
                {Tone.options.map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABELS[tone]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="voice">Voice</label>
              <select id="voice" name="voice" className="input" defaultValue="">
                <option value="">Let the concept decide</option>
                <option value="female">A woman&rsquo;s voice</option>
                <option value="male">A man&rsquo;s voice</option>
                <option value="none">No voice-over</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="language">Language</label>
              <select id="language" name="language" className="input" defaultValue="">
                <option value="">The language of your site</option>
                {FILM_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="supplemental">Anything else worth reading</label>
            <input
              id="supplemental"
              name="supplemental"
              className="input"
              placeholder="Product Hunt, LinkedIn, docs — separated by spaces"
            />
            <span className="hint">
              Optional. A link you point us at outranks anything we find ourselves. All of this can
              be changed on the project until the film is rendered.
            </span>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ alignSelf: 'flex-start', height: 30, fontSize: '0.85rem', paddingInline: 0 }}
          onClick={() => setShowOptional(true)}
        >
          + Length, tone, language, or more to read
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
