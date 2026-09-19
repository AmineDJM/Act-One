'use client';

import { FILM_CUTS, FILM_FORMATS, FilmCut, FilmFormat } from '@act-one/core';
import styles from './app.module.css';

/**
 * The two decisions that are not preferences.
 *
 * Length, tone and voice shade a film. These two decide what it is: whether
 * the product's own interface appears at all, and whether the master is a
 * landscape film or a vertical short. Each changes what every later stage
 * does — a pitch never signs into the customer's product, a short is composed
 * in its own frame and cut to its own rhythm — so they are chosen before
 * anything is written rather than applied to a finished film.
 *
 * One component, used on the command bar and on the production's brief, so the
 * words the customer chose from are the same in both places and both send the
 * same field names.
 */
export function FilmShape({
  format,
  cut,
  onCutChange,
  compact = false,
}: {
  format: FilmFormat;
  cut: FilmCut;
  onCutChange: (cut: FilmCut) => void;
  /** Drops the second line of each card, where space is tight. */
  compact?: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <fieldset className={styles.formatGroup}>
        <legend className={styles.formatLegend}>What the film shows</legend>
        <div className={styles.formats}>
          {FilmFormat.options.map((option) => (
            <label className={styles.format} key={option}>
              <input type="radio" name="filmFormat" value={option} defaultChecked={option === format} />
              <span className={styles.formatName}>{FILM_FORMATS[option].title}</span>
              <span className={styles.formatBlurb}>{FILM_FORMATS[option].blurb}</span>
              {compact ? null : (
                <span className={styles.formatSuits}>{FILM_FORMATS[option].suits}</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.formatGroup}>
        <legend className={styles.formatLegend}>How it is cut</legend>
        <div className={styles.formats}>
          {FilmCut.options.map((option) => (
            <label className={styles.format} key={option}>
              {/*
                * Controlled, because the length choices below depend on it: a
                * reel is not offered ninety seconds, and a classic film is not
                * offered eight.
                */}
              <input
                type="radio"
                name="filmCut"
                value={option}
                checked={option === cut}
                onChange={() => onCutChange(option)}
              />
              <span className={styles.formatName}>{FILM_CUTS[option].title}</span>
              <span className={styles.formatBlurb}>{FILM_CUTS[option].blurb}</span>
              {compact ? null : <span className={styles.formatSuits}>{FILM_CUTS[option].suits}</span>}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
