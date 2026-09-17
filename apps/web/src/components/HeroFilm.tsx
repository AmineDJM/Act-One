'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './hero-film.module.css';

/** Three real renders, cycled. Each is our own work for a fictional company. */
const FILMS = [
  { slug: 'northwind', company: 'Northwind', system: 'Cinematic Black' },
  { slug: 'meridian', company: 'Meridian', system: 'Kinetic Product' },
  { slug: 'halyard', company: 'Halyard', system: 'Editorial Tech' },
] as const;

/**
 * The film on the homepage.
 *
 * Starts on a still and only plays once the viewer is actually looking at it,
 * and never when they have asked for reduced motion. A page that sells
 * restraint should not open by autoplaying video at somebody.
 */
export function HeroFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const film = FILMS[index]!;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Only spend the viewer's bandwidth once the film is on screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void element.play().catch(() => undefined);
        else element.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [index]);

  return (
    <figure className={styles.wrap}>
      <div className={styles.frame}>
        <video
          ref={video}
          key={film.slug}
          src={`/work/${film.slug}.mp4`}
          poster={`/work/${film.slug}.png`}
          muted
          playsInline
          preload="metadata"
          aria-label={`A reference launch film for ${film.company}, a fictional company`}
          onEnded={() => setIndex((current) => (current + 1) % FILMS.length)}
        />
      </div>

      <figcaption className={styles.caption}>
        <span className={styles.dots} role="tablist" aria-label="Reference films">
          {FILMS.map((option, optionIndex) => (
            <button
              key={option.slug}
              type="button"
              role="tab"
              aria-selected={optionIndex === index}
              aria-label={option.company}
              data-active={optionIndex === index}
              onClick={() => setIndex(optionIndex)}
            />
          ))}
        </span>
        <span>
          {film.company} · {film.system} · <span className={styles.fiction}>fictional company</span>
        </span>
        <Link href="/work">See all three →</Link>
      </figcaption>
    </figure>
  );
}
