'use client';

import { useRef, useState } from 'react';
import styles from './film-card.module.css';

/**
 * A reference film on the marketing site.
 *
 * Shows a real frame and plays the real film. A product whose whole claim is
 * film craft cannot show a coloured rectangle where the work should be — the
 * page either proves it or it argues against itself.
 *
 * Plays on hover on a pointer device and on tap everywhere else. Never
 * autoplays on load: three films starting at once is a worse first impression
 * than a still frame, and it is bandwidth somebody did not ask to spend.
 */
export function FilmCard({
  slug,
  company,
  kind,
  concept,
  idea,
  system,
  duration,
}: {
  slug: string;
  company: string;
  kind: string;
  concept: string;
  idea: string;
  system: string;
  duration: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = () => {
    // A rejected play() is normal — a browser may refuse until a real gesture,
    // and reduced-motion users get the poster, which is the correct outcome.
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
      <button
        type="button"
        className={styles.frame}
        onMouseEnter={play}
        onMouseLeave={stop}
        onFocus={play}
        onBlur={stop}
        onClick={() => (playing ? stop() : play())}
        aria-label={`${playing ? 'Stop' : 'Play'} the ${company} reference film`}
      >
        <video
          ref={video}
          src={`/work/${slug}.mp4`}
          poster={`/work/${slug}.png`}
          muted
          loop
          playsInline
          preload="none"
          tabIndex={-1}
          aria-hidden="true"
        />
        <span className={styles.badge} data-playing={playing}>
          {playing ? 'Playing' : `▶ ${duration}`}
        </span>
      </button>

      <figcaption>
        <h3>{concept}</h3>
        <p className={styles.idea}>{idea}</p>
        <p className={styles.meta}>
          {/* Each line is one grid item; a bare text node beside <strong> becomes
              its own item and breaks "Northwind · AI agent" across two rows. */}
          <span>
            <strong>{company}</strong> · {kind}
          </span>
          <span>{system} · fictional company</span>
        </p>
      </figcaption>
    </figure>
  );
}
