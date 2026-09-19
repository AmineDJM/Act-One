import { z } from 'zod';
import { AspectRatio } from './render.ts';

/**
 * How the film is cut, which is a different question from what it shows.
 *
 * Every film in this system used to be one shape: sixteen by nine, around a
 * minute, cut to be watched on purpose on a page. That is one of the two
 * things people mean by "a video" now, and it is the smaller one.
 *
 * The other is the feed. A reel, a short, a TikTok — vertical, under
 * forty-five seconds, watched muted, scrolled past by default, and the first
 * second decides everything. It is not the long film cropped: a crop of a
 * sixteen-by-nine master puts the composition's centre where a thumb is and
 * the safe area under the caption bar, and it reads instantly as a repurposed
 * landscape film, which is the single most recognisable sign that nobody cut
 * it on purpose.
 *
 * So this is decided before anything is written, and it travels through every
 * stage: the concept is written to a different length, the storyboard is
 * planned to a different rhythm, the master is composed in its own frame, and
 * the captions are in the picture rather than beside it.
 */
export const FilmCut = z.enum(['feature', 'short']);
export type FilmCut = z.infer<typeof FilmCut>;

export type CutSpec = {
  title: string;
  /** One line, on the control. */
  blurb: string;
  /** Where it is watched, on the control's second line. */
  suits: string;
  /** The frame the master itself is composed in. */
  aspect: AspectRatio;
  /** The band the film is cut to. A choice outside it is not offered. */
  seconds: [number, number];
  defaultSeconds: number;
  /**
   * Scene lengths, as a multiple of the creative system's own pacing.
   *
   * A short is not the long film played faster — it holds fewer ideas — but
   * each shot does hold for less time, because a viewer who has not chosen to
   * watch gives a shot about half the patience of one who has.
   */
  pace: number;
  /**
   * How long the opening has to earn the rest.
   *
   * In a feed this is the whole game: a hook that arrives at three seconds
   * arrives after the decision has been made.
   */
  hookSeconds: number;
  /**
   * Whether the captions go into the picture.
   *
   * In a feed, always: most playback is muted, so the captions are the words
   * rather than an accessibility track, and they are composed with the frame.
   */
  captionsBurned: boolean;
  /** Handed to every writing agent verbatim, so they all cut to the same film. */
  direction: string;
};

export const FILM_CUTS: Record<FilmCut, CutSpec> = {
  feature: {
    title: 'Classic film',
    blurb: 'Landscape, around a minute, watched on purpose.',
    suits: 'A homepage, YouTube, a launch post, a room with a projector.',
    aspect: '16:9',
    seconds: [20, 120],
    defaultSeconds: 60,
    pace: 1,
    hookSeconds: 3,
    captionsBurned: false,
    direction:
      'This film is watched by somebody who chose to watch it, in a landscape frame, with sound. ' +
      'It can open on an image and let it breathe, it can hold a shot, and it can build to ' +
      'something. Compose for the whole frame and let the argument have room.',
  },
  short: {
    title: 'Reel or Short',
    blurb: 'Vertical, under forty seconds, watched muted in a feed.',
    suits: 'Instagram Reels, TikTok, YouTube Shorts, LinkedIn video.',
    aspect: '9:16',
    seconds: [8, 45],
    defaultSeconds: 24,
    pace: 0.62,
    hookSeconds: 1,
    captionsBurned: true,
    direction:
      'This is a different medium from a classic film, not a shorter one. It is scrolled past by ' +
      'default, in a vertical frame, with the sound off, and the viewer leaves at any moment at ' +
      'no cost. The first second decides whether there is a second one, so it opens on the ' +
      'strongest thing in the film rather than building to it — no title card before the idea, ' +
      'no logo before the hook, no establishing shot. Every shot earns its place, and every beat ' +
      'carries its meaning in the picture and in the words on it, because the voice is not ' +
      'heard. Something is happening at all times, and the something may be stillness: a held ' +
      'reaction, a beat of quiet before a payoff or a static frame against a dense run are ' +
      'among the strongest things in the form. What fails is a frame where nothing is happening ' +
      'and nothing was meant to be. Higher information density, shorter pauses, shorter shots, ' +
      'an earlier emotional peak and a tighter ending than a classic film. Composed natively ' +
      'for a phone — subjects framed for a vertical screen, and the top and bottom of the frame ' +
      'left to the platform. And still premium: this is attention engineering, not decoration. ' +
      'A cut on a metronome, a zoom on every beat and a caption on every word are what this ' +
      'format looks like when somebody confuses retention with noise.',
  },
};

/** The frame a master of this cut is composed in. */
export function cutAspect(cut: FilmCut): AspectRatio {
  return FILM_CUTS[cut].aspect;
}

/**
 * The runtime this film is cut to.
 *
 * The customer's own choice wins where it fits the cut, and is pulled into the
 * band where it does not — a sixty-second reel is not a reel, and a request
 * for one is a request made before the cut was chosen rather than an
 * instruction to break it.
 */
export function cutSeconds(cut: FilmCut, requested?: number | null): number {
  const spec = FILM_CUTS[cut];
  if (requested == null || !Number.isFinite(requested)) return spec.defaultSeconds;
  return Math.min(spec.seconds[1], Math.max(spec.seconds[0], Math.round(requested)));
}

/** Whether a requested runtime is one this cut can actually deliver. */
export function cutHolds(cut: FilmCut, seconds: number): boolean {
  const [min, max] = FILM_CUTS[cut].seconds;
  return seconds >= min && seconds <= max;
}

/**
 * The lengths offered for this cut, from the standard ladder.
 *
 * Always at least the cut's own default, so a control can never come up empty
 * because somebody's plan caps the runtime below the ladder's first rung.
 */
export function cutDurationChoices(
  cut: FilmCut,
  ladder: readonly number[],
  maxSeconds: number,
): number[] {
  const spec = FILM_CUTS[cut];
  const offered = ladder.filter(
    (seconds) => seconds <= maxSeconds && cutHolds(cut, seconds),
  );
  if (offered.length > 0) return offered;
  return [Math.min(maxSeconds, spec.defaultSeconds)];
}
