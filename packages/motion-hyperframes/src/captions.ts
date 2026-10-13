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
export type CaptionStyle = 'plate' | 'pill';

/** The captions' composition id: mounted for the whole film on its own track, above the scenes. */
export const CAPTIONS_COMPOSITION_ID = 'ao-captions';

/** One element per cue, set for the frame; hidden until its timeline shows it. */
export function captionsMarkup(cues: readonly CaptionCue[], tokens: FilmTokens, aspect: AspectRatio, style: CaptionStyle = 'plate'): string {
  const vertical = aspect === '9:16' || aspect === '4:5';
  const height = tokens.frame.height;
  const width = tokens.frame.width;
  // A pill is set a step smaller than a plate: it is read against a designed field, not over any picture.
  // A square film is watched in a feed, on a phone: its pill keeps the plate's size.
  const pill = vertical ? 0.034 : aspect === '1:1' ? 0.03 : 0.026;
  const sizePx = Math.round(height * (style === 'pill' ? pill : vertical ? 0.038 : 0.03));
  const bottom = Math.round(height * (vertical ? VERTICAL_CHROME_BOTTOM : TITLE_SAFE_INSET));
  const side = Math.round(width * TITLE_SAFE_INSET);
  const pad = Math.round(sizePx * 0.32);

  return timedCues(cues)
    .map((cue, index) => {
      const lines = (cue.lines.length > 0 ? cue.lines : [cue.text])
        .map((line) => `<span class="ao-caption-line">${marked(line, cue.emphasis)}</span>`)
        .join('');
      return [
        `<div id="ao-caption-${index + 1}" class="ao-caption" data-cue-start="${round(cue.start)}" data-cue-end="${round(cue.end)}"`,
        ` style="padding-bottom:${bottom}px;padding-left:${side}px;padding-right:${side}px;">`,
        `<div class="ao-caption-block" style="gap:${Math.round(sizePx * 0.16)}px;font-size:${sizePx}px;--ao-caption-pad:${Math.round(pad * 0.55)}px ${pad}px;">${lines}</div>`,
        '</div>',
      ].join('');
    })
    .join('\n');
}

/**
 * The captions as a composition of their own, on the film's clock.
 *
 * Laid in the film's page, each cue was a clip holding other elements, which
 * HyperFrames reads as structure that belongs in a composition — nine
 * warnings on a narrated film. Here each cue is shown and hidden by the
 * composition's timeline, exactly for its words: a plate cuts in and out, as
 * the Remotion engine sets it; the launch look's pill lifts in over four
 * frames, which reads as set rather than switched on.
 */
export function captionsComposition(
  cues: readonly CaptionCue[],
  tokens: FilmTokens,
  aspect: AspectRatio,
  style: CaptionStyle,
  durationSeconds: number,
): string | null {
  const timed = timedCues(cues);
  if (timed.length === 0) return null;
  const rise = Math.round(tokens.frame.height * 0.008);
  const statements = timed.flatMap((cue, index) => {
    const id = JSON.stringify(`#ao-caption-${index + 1}`);
    const block = JSON.stringify(`#ao-caption-${index + 1} .ao-caption-block`);
    return [
      `tl.set(${id}, { visibility: "visible" }, ${round(cue.start)});`,
      ...(style === 'pill'
        ? [`tl.fromTo(${block}, { opacity: 0, y: ${rise} }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out", immediateRender: false }, ${round(cue.start)});`]
        : []),
      `tl.set(${id}, { visibility: "hidden" }, ${round(cue.end)});`,
    ];
  });
  return [
    '<template>',
    `<style>\n#root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }\n${captionCss(style)}\n.ao-caption { visibility: hidden; }\n</style>`,
    `<div id="root" data-composition-id="${CAPTIONS_COMPOSITION_ID}" data-width="${tokens.frame.width}" data-height="${tokens.frame.height}">`,
    captionsMarkup(timed, tokens, aspect, style),
    '</div>',
    '<script>',
    'const tl = gsap.timeline({ paused: true });',
    ...statements,
    `tl.set({}, {}, ${round(durationSeconds)});`,
    'window.__timelines = window.__timelines || {};',
    `window.__timelines[${JSON.stringify(CAPTIONS_COMPOSITION_ID)}] = tl;`,
    '</script>',
    '</template>',
  ].join('\n');
}

function timedCues(cues: readonly CaptionCue[]): CaptionCue[] {
  return cues.filter((cue) => cue.end > cue.start);
}

/** The stylesheet the caption markup relies on. */
export function captionCss(style: CaptionStyle): string {
  return style === 'pill' ? PILL_CAPTION_CSS : CAPTION_CSS;
}

/**
 * Captions as the launch look sets them: each line a dark pill low in the
 * frame. The same safe area, the same size rules less a step, the same
 * contrast floor — white on a near-black at three quarters — as the plate.
 */
const PILL_CAPTION_CSS = `
.ao-caption { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; pointer-events: none; }
.ao-caption-block { display: flex; flex-direction: column; align-items: center; }
.ao-caption-line { font-family: var(--ao-body-family); font-weight: 500; line-height: 1.3; letter-spacing: 0.01em; color: #FFFFFF; background-color: rgba(10, 12, 20, 0.78); padding: 0.4em 1.1em; border-radius: 999px; text-align: center; text-wrap: balance; }
.ao-caption-emphasis { color: #FFFFFF; font-weight: 700; }
`;

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
