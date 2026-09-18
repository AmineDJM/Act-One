'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { FILM_LANGUAGES, type Render } from '@act-one/core';
import { localiseFilmAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

/**
 * The film in other languages.
 *
 * Each one is a master rather than a format, so they sit beside the film and
 * not among the campaign cuts: the script was written again by somebody
 * working in that language, read by a voice that speaks it, and rendered from
 * the same picture with the same score.
 */
export function LanguagesPanel({
  projectId,
  sourceLanguage,
  masters,
  working,
  may,
  planName,
}: {
  projectId: string;
  /** What the film is in now. Never offered as a target. */
  sourceLanguage: string | null;
  masters: { render: Render; language: string | null }[];
  /** A language currently being produced, if one is. */
  working: string | null;
  may: boolean;
  planName: string;
}) {
  const [state, localise, pending] = useActionState<FormState, FormData>(localiseFilmAction, { error: null });

  const taken = new Set(
    [sourceLanguage, ...masters.map((master) => master.language), working]
      .filter((code): code is string => Boolean(code))
      .map((code) => code.slice(0, 2).toLowerCase()),
  );
  const available = FILM_LANGUAGES.filter((language) => !taken.has(language.code));

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Other languages</h3>
        {masters.length > 0 ? <span className="badge badge--ok">{masters.length}</span> : null}
      </div>

      {!may ? (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          The same film, written again and read by a native voice for each market you launch in,
          comes with the plans above {planName}. <Link href="/app/billing">See plans</Link>.
        </p>
      ) : (
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          Not subtitles. The script is written again for the market, read by a voice from it, and
          produced from the same picture and the same score.
        </p>
      )}

      {masters.length > 0 ? (
        <ul className={styles.variantList}>
          {masters.map(({ render, language }) => (
            <li key={render.id}>
              <span>
                <strong>{nameOf(language)}</strong>
                <span className={styles.variantMeta}>
                  {render.aspect} · {Math.round(render.durationSeconds)}s
                </span>
              </span>
              <span className="row" style={{ gap: 'var(--space-2)' }}>
                {render.captionsAssetId ? (
                  <a className="btn btn--secondary" href={`/api/assets/${render.captionsAssetId}?download`} download>
                    Subtitles
                  </a>
                ) : null}
                <a className="btn btn--secondary" href={`/api/assets/${render.masterAssetId}?download`} download>
                  Download
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {working ? <p className="hint">Producing the {nameOf(working)} master…</p> : null}

      {may && available.length > 0 ? (
        <form action={localise} className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input type="hidden" name="projectId" value={projectId} />
          <select className="input" name="language" aria-label="Language" defaultValue="" style={{ maxWidth: '16rem' }}>
            <option value="" disabled>
              Choose a language
            </option>
            {available.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={pending || Boolean(working)}>
            {pending ? 'Starting…' : 'Produce the master'}
          </button>
        </form>
      ) : null}

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="hint">{state.message}</p> : null}
    </section>
  );
}

function nameOf(code: string | null): string {
  if (!code) return 'Another language';
  return FILM_LANGUAGES.find((language) => language.code === code.slice(0, 2).toLowerCase())?.name ?? code;
}
