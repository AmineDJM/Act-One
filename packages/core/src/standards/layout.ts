import type { Standard } from './standard.ts';

/**
 * Composition law.
 *
 * Safe areas are one of the few parts of screen design with a real broadcast
 * standard behind them, and the numbers are not arbitrary: they are what
 * survives being played somewhere you did not choose.
 */
export const LAYOUT_STANDARDS = {
  titleSafe: {
    id: 'layout.title_safe',
    rule: 'Text stays inside 90% of the frame — a 5% inset on every edge.',
    source: 'EBU R 95 / SMPTE ST 2046-1',
    clause: 'R 95 text safe area',
    authority: 'normative',
    because:
      'Overscan, platform chrome and player controls all eat the edge of a frame, ' +
      'and none of them tell you in advance.',
  },
  actionSafe: {
    id: 'layout.action_safe',
    rule: 'Anything that must be seen stays inside 93% — a 3.5% inset.',
    source: 'EBU R 95 / SMPTE ST 2046-1',
    clause: 'R 95 graphics safe area',
    authority: 'normative',
    because: 'The looser of the two areas: a logo may touch it, a caption may not.',
  },
  platformChrome: {
    id: 'layout.platform_chrome',
    rule: 'Vertical cuts keep copy clear of the bottom third and the right edge.',
    source: 'Platform guidance (TikTok, Instagram, YouTube Shorts)',
    authority: 'guidance',
    because:
      'Captions, handles, the follow button and the action rail sit there. The exact boxes move ' +
      'between app versions, so the margin is generous rather than pixel-fitted.',
  },
  grid: {
    id: 'layout.grid',
    rule: 'One grid for the whole film. Margins do not move between scenes.',
    source: 'Müller-Brockmann, Grid Systems in Graphic Design',
    authority: 'convention',
    because:
      'A margin that shifts by a few pixels between cuts reads as carelessness to people ' +
      'who could not tell you what changed.',
  },
  baseline: {
    id: 'layout.baseline',
    rule: 'Vertical positions land on a baseline derived from the frame, not on round pixel values.',
    source: 'Müller-Brockmann, and the 8pt grid convention',
    authority: 'convention',
    because:
      'Deriving the rhythm from frame height is what makes a 1080p render and a 4K render ' +
      'of the same film identical rather than merely similar.',
  },
  opticalCenter: {
    id: 'layout.optical_center',
    rule: 'Centred content sits slightly above the geometric centre.',
    source: 'Long-standing typographic practice',
    authority: 'convention',
    because:
      'The eye reads the centre of a frame as higher than it is. Geometrically centred text ' +
      'looks like it is sliding off the bottom.',
  },
  thirds: {
    id: 'layout.thirds',
    rule: 'A subject that is not centred sits near a third, not near the middle.',
    source: 'Photographic and cinematographic convention',
    authority: 'convention',
    because:
      'The failure mode is the accidental near-centre: close enough to look like a miss ' +
      'rather than a choice.',
  },
} as const satisfies Record<string, Standard>;

/**
 * EBU R 95 safe areas as fractions inset from each edge.
 *
 * These are the floors. Act One's own margins are more generous — a film that
 * only just clears title safe looks cramped even where nothing is cut off —
 * but nothing may go inside these.
 */
export const TITLE_SAFE_INSET = 0.05;
export const ACTION_SAFE_INSET = 0.035;

/**
 * Extra bottom margin for vertical formats, on top of title safe.
 *
 * Platform UI is the reason vertical safe areas are not symmetrical: the caption
 * block, the handle and the action rail all occupy the lower right of the frame.
 */
export const VERTICAL_CHROME_BOTTOM = 0.14;
export const VERTICAL_CHROME_RIGHT = 0.02;

/** How far above the geometric centre optically centred content sits. */
export const OPTICAL_CENTER_RISE = 0.04;

/** Rule-of-thirds positions, and the dead zone around the centre to avoid. */
export const THIRDS = [1 / 3, 2 / 3] as const;
export const NEAR_CENTER_DEAD_ZONE = 0.06;

/** True when a box sits inside an inset fraction of a frame. */
export function withinInset(
  box: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  inset: number,
  tolerancePx = 1,
): boolean {
  const left = frame.width * inset - tolerancePx;
  const top = frame.height * inset - tolerancePx;
  return (
    box.x >= left &&
    box.y >= top &&
    box.x + box.width <= frame.width - left &&
    box.y + box.height <= frame.height - top
  );
}
