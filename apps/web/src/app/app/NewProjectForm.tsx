'use client';

import { useActionState, useState } from 'react';
import {
  DURATION_CHOICES,
  FILM_CUTS,
  FILM_FORMATS,
  FILM_LANGUAGES,
  cutDurationChoices,
  type FilmCut,
  TONE_LABELS,
  Tone,
  VOICE_ACCENT_LABELS,
  VOICE_PACE_LABELS,
  VOICE_STYLE_LABELS,
  VoiceAccent,
  VoicePace,
  VoiceStyle,
} from '@act-one/core';
import { createProjectAction, type FormState } from './actions.ts';
import { FilmShape } from './FilmShape.tsx';
import styles from './app.module.css';

/**
 * The command bar.
 *
 * One line: the product's address, and the one verb. Everything else is a
 * source the customer may point us at, or a preference with a "you decide"
 * default, and stays folded until asked for. The field names are what the
 * action reads, and do not change.
 */
const SOURCES = [
  { key: 'producthunt', label: 'Product Hunt', placeholder: 'https://www.producthunt.com/products/…' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://www.linkedin.com/company/…' },
  { key: 'docs', label: 'Docs', placeholder: 'https://docs.yourproduct.com' },
  { key: 'other', label: 'Other source', placeholder: 'https://…' },
] as const;

export function NewProjectForm({ maxDurationSeconds, autoFocus = false }: { maxDurationSeconds: number; autoFocus?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, {
    error: null,
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showOptions, setShowOptions] = useState(false);
  const [cut, setCut] = useState<FilmCut>('feature');
  // Only the lengths this cut can actually deliver. A ninety-second reel is
  // not a reel, so it is not on the menu.
  const durations = cutDurationChoices(cut, DURATION_CHOICES, maxDurationSeconds);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <form action={action} className="stack" style={{ gap: 'var(--space-3)' }} id="new">
      <div className={styles.command}>
        <div className={styles.commandRow}>
          <span className={styles.commandPrompt} aria-hidden="true">
            &gt;
          </span>
          <input
            name="website"
            className={styles.commandInput}
            type="url"
            inputMode="url"
            placeholder="https://yourproduct.com"
            aria-label="Product website"
            required
            autoFocus={autoFocus}
            autoComplete="url"
            spellCheck={false}
          />
          <button className={`btn ${styles.commandGo}`} type="submit" disabled={pending}>
            {pending ? 'Reading…' : 'Understand my product'}
            {pending ? null : (
              <span className="btn__key" aria-hidden="true">
                ↵
              </span>
            )}
          </button>
        </div>

        {open.size > 0 || showOptions ? (
          <div className={styles.commandOpen}>
            {open.size > 0 ? (
              <div className={styles.sourceFields}>
                {SOURCES.filter((source) => open.has(source.key)).map((source) => (
                  <div className="field" key={source.key}>
                    <label htmlFor={`source-${source.key}`}>{source.label}</label>
                    <input
                      id={`source-${source.key}`}
                      name="source"
                      className="input"
                      type="url"
                      inputMode="url"
                      placeholder={source.placeholder}
                      autoFocus
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {showOptions ? (
              <>
                {/*
                 * The kind of film, first and on its own, because it is not a
                 * preference. Length and tone shade a film; this decides
                 * whether we sign into the customer's product at all and what
                 * every shot after that is allowed to be. It has a default
                 * rather than a blank, so nobody is stopped by it, and it is
                 * the only option here with no "you decide".
                 */}
                <FilmShape format="product_tour" cut={cut} onCutChange={setCut} />
                {/*
                 * The decisions a customer wants to make up front. Each has a
                 * "you decide" default, so the bar stays one line for the people
                 * who only have a URL.
                 */}
                <div className={styles.options}>
                  <div className="field">
                    <label htmlFor="duration">Length</label>
                    <select id="duration" name="duration" className="input" defaultValue="">
                      <option value="">
                        Let the concept decide (about {FILM_CUTS[cut].defaultSeconds} seconds)
                      </option>
                      {durations.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds} seconds
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
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
                  <div className="field">
                    <label htmlFor="voice">Voice</label>
                    <select id="voice" name="voice" className="input" defaultValue="">
                      <option value="">Let the concept decide</option>
                      <option value="female">A woman&rsquo;s voice</option>
                      <option value="male">A man&rsquo;s voice</option>
                      <option value="none">No voice-over</option>
                    </select>
                  </div>
                  <div className="field">
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
                  <div className="field">
                    <label htmlFor="voiceAccent">Accent</label>
                    <select id="voiceAccent" name="voiceAccent" className="input" defaultValue="auto">
                      {VoiceAccent.options.map((accent) => (
                        <option key={accent} value={accent}>
                          {VOICE_ACCENT_LABELS[accent]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="voiceStyle">Style</label>
                    <select id="voiceStyle" name="voiceStyle" className="input" defaultValue="">
                      <option value="">Auto</option>
                      {VoiceStyle.options.map((style) => (
                        <option key={style} value={style}>
                          {VOICE_STYLE_LABELS[style].split(' — ')[0]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="voicePace">Pace</label>
                    <select id="voicePace" name="voicePace" className="input" defaultValue="">
                      <option value="">Auto</option>
                      {VoicePace.options.map((pace) => (
                        <option key={pace} value={pace}>
                          {VOICE_PACE_LABELS[pace]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="hint">
                  Optional. Every one of these can be changed on the production until the master exists.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.sources}>
        {SOURCES.map((source) => (
          <button
            key={source.key}
            type="button"
            className={styles.source}
            data-on={open.has(source.key)}
            onClick={() => toggle(source.key)}
            aria-pressed={open.has(source.key)}
          >
            {source.label}
          </button>
        ))}
        {/*
          * Names the choice rather than the drawer.
          *
          * "Length, tone, voice" was a list of preferences, and the two
          * decisions that actually change what gets made — whether we navigate
          * the product, and whether the master is landscape or vertical — were
          * behind it with nothing to suggest they were there. Showing what is
          * currently chosen makes the split legible without opening anything,
          * and makes it obvious it can be changed.
          */}
        <button
          type="button"
          className={styles.source}
          data-on={showOptions}
          onClick={() => setShowOptions((current) => !current)}
          aria-pressed={showOptions}
          style={{ marginLeft: 'auto' }}
        >
          {FILM_FORMATS.product_tour.title} · {FILM_CUTS[cut].title} · length, voice
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
