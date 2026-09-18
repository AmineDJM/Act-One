'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import styles from './film-card.module.css';

export type PublicFilmCardProps = {
  href: string;
  videoSrc: string;
  posterSrc: string | null;
  company: string;
  title: string;
  tagline: string;
  categoryLabel: string;
  credit: string;
  durationSeconds: number;
  launchOfTheWeek?: boolean;
  featured?: boolean;
  /** Something to say under the film besides the credit: a launch date, a host. */
  aside?: string;
};

/**
 * A film from Collections, on the public site.
 *
 * The same manners as the reference film card: a real frame, the real film
 * on hover or tap, never autoplay on load. The whole card goes to the film's
 * own page, where the film has a title, a company and an address of its own.
 */
export function PublicFilmCard({ href, videoSrc, posterSrc, company, title, tagline, categoryLabel, credit, durationSeconds, launchOfTheWeek, featured, aside }: PublicFilmCardProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = () => {
    void video.current?.play().then(() => setPlaying(true)).catch(() => undefined);
  };
  const stop = () => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
    setPlaying(false);
  };

  return (
    <figure className={styles.card}>
      <Link href={href} className={styles.frame} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} aria-label={`${company}: ${title}`}>
        <video ref={video} src={videoSrc} {...(posterSrc ? { poster: posterSrc } : {})} muted loop playsInline preload="none" tabIndex={-1} aria-hidden="true" />
        <span className={styles.badge} data-playing={playing}>
          {playing ? 'Playing' : `▶ ${Math.round(durationSeconds)}s`}
        </span>
        {launchOfTheWeek ? (
          <span className={styles.mark}>Launch of the week</span>
        ) : featured ? (
          <span className={styles.mark}>Featured</span>
        ) : null}
      </Link>
      <figcaption>
        <h3>
          <Link href={href}>{title}</Link>
        </h3>
        {tagline ? <p className={styles.idea}>{tagline}</p> : null}
        <p className={styles.meta}>
          <span>
            <strong>{company}</strong> · {categoryLabel}
          </span>
          <span>
            {credit}
            {aside ? ` · ${aside}` : ''}
          </span>
        </p>
      </figcaption>
    </figure>
  );
}
