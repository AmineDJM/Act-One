import { TITLE_SAFE_INSET, VERTICAL_CHROME_BOTTOM, type AspectRatio, type CaptionCue } from '@act-one/core';
import type { FilmTokens } from './tokens.ts';

/**
 * Captions burned into the picture, set as the Remotion engine sets them.
 *
 * Deterministic, never written by the agent: the cue timing comes from where
 * the words actually fall in the recording, and a caption is an accessibility
 * and legibility commitment, not a composition. The rules are the other
 * engine's, number for number — inside the EBU R 95 safe area, above the
 * platform furniture on a vertical frame, one plate per line at a contrast that
 * holds over any picture, no animation, one word marked in the brand's accent.
 */
export function captionsMarkup(cues: readonly CaptionCue[], tokens: FilmTokens, aspect: AspectRatio, trackIndex: number): string {
  const vertical = aspect === '9:16' || aspect === '4:5';
  const height = tokens.frame.height;
  const width = tokens.frame.width;
  const sizePx = Math.round(height * (vertical ? 0.038 : 0.03));
  const bottom = Math.round(height * (vertical ? VERTICAL_CHROME_BOTTOM : TITLE_SAFE_INSET));
  const side = Math.round(width * TITLE_SAFE_INSET);
  const pad = Math.round(sizePx * 0.32);

  return cues
    .filter((cue) => cue.end > cue.start)
    .map((cue, index) => {
      const lines = (cue.lines.length > 0 ? cue.lines : [cue.text])
        .map((line) => `<span class="ao-caption-line">${marked(line, cue.emphasis)}</span>`)
        .join('');
      return [
        `<div id="ao-caption-${index + 1}" class="clip ao-caption" data-start="${round(cue.start)}" data-duration="${round(cue.end - cue.start)}" data-track-index="${trackIndex}"`,
        ` style="padding-bottom:${bottom}px;padding-left:${side}px;padding-right:${side}px;">`,
        `<div class="ao-caption-block" style="gap:${Math.round(sizePx * 0.16)}px;font-size:${sizePx}px;--ao-caption-pad:${Math.round(pad * 0.55)}px ${pad}px;">${lines}</div>`,
        '</div>',
      ].join('');
    })
    .join('\n');
}

/** The stylesheet the caption markup relies on. */
export const CAPTION_CSS = `
.ao-caption { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; pointer-events: none; }
.ao-caption-block { display: flex; flex-direction: column; align-items: center; }
.ao-caption-line { font-family: var(--ao-body-family); font-weight: 600; line-height: 1.25; letter-spacing: 0; color: #FFFFFF; background-color: rgba(0, 0, 0, 0.78); padding: var(--ao-caption-pad); border-radius: var(--ao-radius-sm); text-align: center; text-wrap: balance; }
.ao-caption-emphasis { color: var(--ao-accent-text); }
`;

/** The line, escaped, with its one word marked the first time it appears. */
function marked(line: string, emphasis: string | null): string {
  if (!emphasis) return escapeHtml(line);
  const at = line.indexOf(emphasis);
  if (at < 0) return escapeHtml(line);
  return `${escapeHtml(line.slice(0, at))}<span class="ao-caption-emphasis">${escapeHtml(emphasis)}</span>${escapeHtml(line.slice(at + emphasis.length))}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Microsecond precision: a cue boundary written to the millisecond can move by a frame. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
