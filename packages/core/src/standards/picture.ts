import type { Standard } from './standard.ts';

/**
 * What has to be on the screen.
 *
 * Every other standard in this folder makes something better once it is
 * there: contrast, measure, safe area, pacing, loudness. None of them asks
 * the first question, and so nothing did — a film shipped as thirty seconds
 * of white Helvetica sliding onto a black frame, one line at a time, and it
 * passed type, layout, colour, motion, pacing, sync and delivery, because
 * every one of those checks was true of it.
 *
 * The product is sold as "give us your product, we make the film". A film
 * with no picture in it is a slide deck played at thirty frames a second,
 * whatever else is right about it.
 *
 * There is already a ceiling on generated footage, at 45% of runtime, and
 * that ceiling was the only thing anybody had written about the visual mix.
 * A rule that says "not too much of this" and nothing about "at least some
 * of anything" is a rule that is satisfied perfectly by an empty frame.
 */
export const PICTURE_STANDARDS = {
  substance: {
    id: 'picture.substance',
    rule: 'A film carries picture. Typography on a bare canvas is a title card, and a film made only of title cards is not a film.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Type on black is what a film looks like when every other stage failed quietly — no ' +
      'capture, no footage, no 3D — and it is the one outcome that looks deliberate. It is ' +
      'the cheapest thing the renderer can fall back to, which is exactly why it has to be ' +
      'the thing that is checked for.',
  },
  typeRun: {
    id: 'picture.type_run',
    rule: 'No unbroken run of typography-only shots longer than eight seconds in a film, or four in a short.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A title card is a beat. Four of them in a row is a reading exercise, and the viewer ' +
      'who came to see a product has been shown a paragraph instead.',
  },
} as const satisfies Record<string, Standard>;

/**
 * The least picture a film can carry and still be one.
 *
 * Deliberately low. A restrained, typographic launch film with one strong
 * product shot in it is a real and good film, and this floor is not an
 * opinion about how much picture is right — it is the line below which
 * something has gone wrong rather than been decided.
 */
export const MIN_PICTURE_SHARE = { feature: 0.3, short: 0.2 } as const;

/** The longest a film may go without showing anything but words. */
export const MAX_TYPE_ONLY_RUN_SECONDS = { feature: 8, short: 4 } as const;
