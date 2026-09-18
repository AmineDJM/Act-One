import type { Standard } from './standard.ts';

/**
 * Subtitling.
 *
 * Captions are the one part of a film that is read rather than watched, and
 * the craft of them is almost entirely published: the streaming platforms
 * write their limits down, the broadcasters write theirs down, and the
 * accessibility law says there must be any at all. There is very little to
 * invent here, which is exactly why it is worth getting right — a caption
 * that runs three lines, or sits on screen for a third of a second, or breaks
 * between an article and its noun, is recognisably amateur to people who have
 * never heard of a style guide.
 *
 * The numbers below are the published ones. Where a figure is ours it says so.
 */
export const CAPTION_STANDARDS = {
  required: {
    id: 'caption.required',
    rule: 'Every finished film ships a caption track.',
    source: 'W3C WCAG 2.2 / EN 301 549',
    clause: 'SC 1.2.2 Captions (Prerecorded), Level A',
    authority: 'normative',
    enforcement: 'designed_in',
    because:
      'It is the one Level A criterion a film with a voice-over can fail on its own, and in the ' +
      'European Union it is procurement law rather than advice.',
  },
  twoLines: {
    id: 'caption.two_lines',
    rule: 'At most two lines on screen at once.',
    source: 'Netflix Timed Text Style Guide; BBC Subtitle Guidelines',
    clause: 'TTSG line treatment',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'A third line pushes the eye off the picture entirely: the viewer stops watching the film ' +
      'and starts reading a page.',
  },
  lineLength: {
    id: 'caption.line_length',
    rule: 'Latin scripts: 42 characters a line. Full-width scripts: 16 characters.',
    source: 'Netflix Timed Text Style Guide (English; Japanese)',
    clause: 'TTSG character limitation',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Longer lines force a horizontal saccade wide enough that the viewer loses the frame. The ' +
      'two figures are the same limit measured in the width each script actually occupies.',
  },
  readingRate: {
    id: 'caption.reading_rate',
    rule: 'Latin scripts: at most 20 characters a second. Full-width scripts: 4.',
    source: 'Netflix Timed Text Style Guide (English; Japanese)',
    clause: 'TTSG reading speed, adult programming',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Captions that keep pace with fast speech are unreadable, and a viewer who falls behind ' +
      'does not catch up — they stop reading. The honest fix is fewer words, not a faster caption.',
  },
  minimumDuration: {
    id: 'caption.minimum_duration',
    rule: 'No caption is on screen for less than five sixths of a second.',
    source: 'Netflix Timed Text Style Guide',
    clause: 'TTSG minimum duration',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Below that the eye registers a flash rather than a word, and a run of them reads as a ' +
      'fault in the player.',
  },
  maximumDuration: {
    id: 'caption.maximum_duration',
    rule: 'No caption is on screen for more than seven seconds.',
    source: 'Netflix Timed Text Style Guide',
    clause: 'TTSG maximum duration',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'A caption that outstays the line it belongs to reads as frozen, and the viewer re-reads it ' +
      'looking for what they missed.',
  },
  gap: {
    id: 'caption.gap',
    rule: 'Consecutive captions are separated by at least two frames.',
    source: 'Netflix Timed Text Style Guide',
    clause: 'TTSG minimum gap',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Without a gap, two captions look like one caption changing, and the eye has nothing to ' +
      'tell it a new line has begun.',
  },
  lineBreak: {
    id: 'caption.line_break',
    rule: 'Lines break at a linguistic unit, never between an article, preposition or name and what it governs.',
    source: 'BBC Subtitle Guidelines',
    clause: 'Line breaks',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'A break in the wrong place makes the reader hold a fragment until the next line resolves ' +
      'it, which costs exactly the time captions do not have.',
  },
  safeArea: {
    id: 'caption.safe_area',
    rule: 'Captions sit inside the text safe area, and clear of the platform chrome on vertical cuts.',
    source: 'EBU R 95; platform guidance',
    clause: 'R 95 text safe area',
    authority: 'normative',
    enforcement: 'designed_in',
    because:
      'A caption is the one element on screen that cannot be cropped and still do its job, and ' +
      'the bottom of a vertical frame is where every app puts its own furniture.',
  },
  contrast: {
    id: 'caption.contrast',
    rule: 'Captions carry their own background, so they never depend on what is behind them.',
    source: 'BBC Subtitle Guidelines; W3C WCAG 2.2 SC 1.4.3',
    clause: 'Presentation; contrast minimum',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'The picture underneath changes every frame, so contrast measured against it is a measure ' +
      'of one moment. A plate behind the text is the only way to hold the ratio for all of them.',
  },
  format: {
    id: 'caption.format',
    rule: 'The sidecar track is WebVTT.',
    source: 'W3C WebVTT: The Web Video Text Tracks Format',
    authority: 'normative',
    enforcement: 'designed_in',
    because:
      'It is what a browser reads without a plugin, which is where these films are watched. ' +
      'EBU-TT-D is the broadcast equivalent and is a conversion away when one is asked for.',
  },
} as const satisfies Record<string, Standard>;

/**
 * Scripts, for the two figures that depend on one.
 *
 * Not a general script classifier: the only distinction the caption rules draw
 * is between characters that occupy one column and characters that occupy two,
 * which is where the published limits diverge.
 */
export type CaptionScript = 'latin' | 'full_width';

export const CAPTION_LIMITS: Record<
  CaptionScript,
  { charactersPerLine: number; charactersPerSecond: number }
> = {
  latin: { charactersPerLine: 42, charactersPerSecond: 20 },
  full_width: { charactersPerLine: 16, charactersPerSecond: 4 },
};

export const CAPTION_MAX_LINES = 2;
/** Five sixths of a second, as the guide states it. */
export const CAPTION_MIN_SECONDS = 5 / 6;
export const CAPTION_MAX_SECONDS = 7;
/** Two frames at 25fps, the slowest rate anything here renders at. */
export const CAPTION_MIN_GAP_SECONDS = 2 / 25;

/**
 * Languages written in full-width characters.
 *
 * Japanese, Chinese and Korean. The check is on the language rather than on
 * the text because a Japanese line containing a Latin product name is still a
 * Japanese line and still reads at the Japanese rate.
 */
const FULL_WIDTH_LANGUAGES = new Set(['ja', 'zh', 'ko', 'yue']);

export function captionScript(language: string | null | undefined): CaptionScript {
  const code = (language ?? '').slice(0, 2).toLowerCase();
  return FULL_WIDTH_LANGUAGES.has(code) ? 'full_width' : 'latin';
}

export function captionLimits(language: string | null | undefined) {
  return CAPTION_LIMITS[captionScript(language)];
}
