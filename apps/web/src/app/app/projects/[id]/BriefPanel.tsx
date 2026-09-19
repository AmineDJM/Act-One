'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  DURATION_CHOICES,
  FILM_CUTS,
  FILM_FORMATS,
  FILM_LANGUAGES,
  cutDurationChoices,
  type FilmCut,
  type FilmFormat,
  TONE_LABELS,
  Tone,
  VOICE_ACCENT_LABELS,
  VOICE_PACE_LABELS,
  VOICE_STYLE_LABELS,
  VoiceAccent,
  VoicePace,
  VoiceStyle,
  languageName,
} from '@act-one/core';
import { updateBriefAction, type FormState } from '../../actions.ts';
import { FilmShape } from '../../FilmShape.tsx';
import styles from '../../app.module.css';

/**
 * What the customer decided, and can still change.
 *
 * The kind of film comes first because it is the only one that changes what
 * we do rather than how it looks: a pitch never signs into their product, and
 * every shot after that is drawn from a different vocabulary. The rest — how
 * long, in what tone, in which language, read by whom — shade the film.
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
  brief: {
    filmFormat: FilmFormat;
    filmCut: FilmCut;
    durationSeconds: number | null;
    language: string | null;
    tone: Tone | null;
    voice: 'female' | 'male' | 'none' | null;
    voiceAccent: VoiceAccent | null;
    voiceStyle: VoiceStyle | null;
    voicePace: VoicePace | null;
  };
  maxDurationSeconds: number;
  editable: boolean;
}) {
  const [state, save, saving] = useActionState<FormState, FormData>(updateBriefAction, {
    error: null,
  });
  const [editing, setEditing] = useState(false);
  const [cut, setCut] = useState<FilmCut>(brief.filmCut);

  // A saved brief closes the form and shows the values it now holds.
  useEffect(() => {
    if (state.message && !state.error) setEditing(false);
  }, [state]);
  const durations = cutDurationChoices(cut, DURATION_CHOICES, maxDurationSeconds);

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
          <FilmShape format={brief.filmFormat} cut={cut} onCutChange={setCut} compact />
          <div className="field">
            <label htmlFor="brief-duration">Length</label>
            <select
              id="brief-duration"
              name="duration"
              className="input"
              defaultValue={brief.durationSeconds ?? ''}
            >
              <option value="">
                Let the concept decide (about {FILM_CUTS[cut].defaultSeconds} seconds)
              </option>
              {durations.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
            <span className="hint">
              A {FILM_CUTS[cut].title.toLowerCase()} runs {FILM_CUTS[cut].seconds[0]}–
              {FILM_CUTS[cut].seconds[1]} seconds. Your plan renders up to {maxDurationSeconds}.
            </span>
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
            <label htmlFor="brief-voice">Voice</label>
            <select
              id="brief-voice"
              name="voice"
              className="input"
              defaultValue={brief.voice ?? ''}
            >
              <option value="">Let the concept decide</option>
              <option value="female">A woman&rsquo;s voice</option>
              <option value="male">A man&rsquo;s voice</option>
              <option value="none">No voice-over</option>
            </select>
            <span className="hint">
              The voice speaks the film&rsquo;s language natively, whoever reads.
            </span>
          </div>
          {brief.voice !== 'none' ? (
            <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="brief-accent">Accent</label>
                <select id="brief-accent" name="voiceAccent" className="input" defaultValue={brief.voiceAccent ?? 'auto'}>
                  {VoiceAccent.options.map((accent) => (
                    <option key={accent} value={accent}>
                      {VOICE_ACCENT_LABELS[accent]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="brief-style">Style</label>
                <select id="brief-style" name="voiceStyle" className="input" defaultValue={brief.voiceStyle ?? ''}>
                  <option value="">Auto</option>
                  {VoiceStyle.options.map((style) => (
                    <option key={style} value={style}>
                      {VOICE_STYLE_LABELS[style]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="brief-pace">Pace</label>
                <select id="brief-pace" name="voicePace" className="input" defaultValue={brief.voicePace ?? ''}>
                  <option value="">Auto</option>
                  {VoicePace.options.map((pace) => (
                    <option key={pace} value={pace}>
                      {VOICE_PACE_LABELS[pace]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
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
            <dt>Film</dt>
            <dd>
              {FILM_FORMATS[brief.filmFormat].title} · {FILM_CUTS[brief.filmCut].title}
              <span className="hint" style={{ display: 'block' }}>
                {FILM_FORMATS[brief.filmFormat].blurb} {FILM_CUTS[brief.filmCut].blurb}
              </span>
            </dd>
          </div>
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
            <dt>Voice</dt>
            <dd>
              {brief.voice === 'none'
                ? 'No voice-over'
                : brief.voice === 'female'
                  ? 'A woman’s voice'
                  : brief.voice === 'male'
                    ? 'A man’s voice'
                    : 'Decided by the concept'}
            </dd>
          </div>
          {brief.voice !== 'none' ? (
            <div className={styles.kvRow}>
              <dt>Read</dt>
              <dd>
                {[
                  brief.voiceStyle ? VOICE_STYLE_LABELS[brief.voiceStyle].split(' — ')[0] : null,
                  brief.voicePace ? `${VOICE_PACE_LABELS[brief.voicePace].toLowerCase()} pace` : null,
                  brief.voiceAccent && brief.voiceAccent !== 'auto'
                    ? `${VOICE_ACCENT_LABELS[brief.voiceAccent]} accent`
                    : null,
                ]
                  .filter(Boolean)
                  .join(', ') || 'Directed for the kind of film'}
              </dd>
            </div>
          ) : null}
          <div className={styles.kvRow}>
            <dt>Language</dt>
            <dd>{languageName(brief.language) ?? 'The language of your site'}</dd>
          </div>
          {!editable ? (
            <p className="hint">
              Fixed once the master exists. Start a new production to change them.
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
