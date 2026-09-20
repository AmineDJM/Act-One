import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens, TypeToken } from '@act-one/design';
import { applyCase, breakLines, fitToLines, measureText } from '@act-one/design';
import type { EasingName } from '@act-one/core';
import { ease, exitProgress, interpolate, staggered } from '../easing.ts';

/**
 * Typography components.
 *
 * Text is rendered by the browser at its real size and broken by our own
 * metrics, so what the fitting code promised at storyboard time is what the
 * frame actually contains. Text is only ever scaled DOWN, and only as far as
 * it must go to say the whole line — never up, and never past the floor,
 * which produces the slightly-different-size-every-scene look that reads as
 * automated.
 */
export type TypeProps = {
  text: string;
  token: TypeToken;
  color: string;
  tokens: DesignTokens;
  maxWidth: number;
  maxLines?: number;
  align?: 'left' | 'center' | 'right';
  easing?: EasingName;
  delaySeconds?: number;
  staggerSeconds?: number;
  durationSeconds: number;
};

/**
 * The lines, and the size that lets them all be said.
 *
 * Breaking at the intended size and keeping the first three lines is how a
 * customer's film came to read "Draft a candidate update from" — a sentence
 * stopped mid-phrase, on screen, as though that were the whole of it. A
 * headline a step smaller and complete beats one at the intended size with
 * its last words missing: the second is not a typographic compromise, it is
 * the film saying something other than what was written.
 */
function useFitted(props: TypeProps): { lines: string[]; sizePx: number } {
  return React.useMemo(() => {
    const fitted = fitToLines(applyCase(props.text, props.token), {
      family: props.token.family,
      fontSizePx: props.token.sizePx,
      tracking: props.token.tracking,
      weight: props.token.weight,
      maxWidthPx: props.maxWidth,
      maxLines: props.maxLines ?? 3,
    });
    return { lines: fitted.lines, sizePx: fitted.fontSizePx };
  }, [props.text, props.token, props.maxWidth, props.maxLines]);
}

function useLines(props: TypeProps): string[] {
  return useFitted(props).lines;
}

function baseStyle(props: TypeProps, sizePx?: number): React.CSSProperties {
  return {
    fontFamily: `${props.token.family}, system-ui, sans-serif`,
    fontSize: sizePx ?? props.token.sizePx,
    fontWeight: props.token.weight,
    lineHeight: props.token.lineHeight,
    letterSpacing: `${props.token.tracking}em`,
    color: props.color,
    textAlign: props.align ?? 'left',
    // Kerning and ligatures on: the difference is small per glyph and obvious
    // across a headline.
    fontKerning: 'normal',
    fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
    textRendering: 'geometricPrecision',
    margin: 0,
  };
}

/**
 * Lines rise and fade in sequence, each masked by the line above it.
 * The mask is what makes it read as typesetting rather than as a fade.
 */
export const WordReveal: React.FC<TypeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, sizePx } = useFitted(props);
  const lineHeightPx = sizePx * props.token.lineHeight;
  const exit = exitProgress(frame, fps, props.durationSeconds);

  return (
    <div style={{ ...baseStyle(props, sizePx), opacity: 1 - exit }}>
      {lines.map((line, index) => {
        const t = ease(
          props.easing ?? 'out_quint',
          staggered(index, frame, fps, {
            delaySeconds: props.delaySeconds ?? 0,
            durationSeconds: 0.72,
            staggerSeconds: props.staggerSeconds ?? 0.06,
          }),
        );
        return (
          <div key={index} style={{ overflow: 'hidden', height: lineHeightPx }}>
            <div
              style={{
                transform: `translateY(${interpolate(t, lineHeightPx * 0.92, 0)}px)`,
                opacity: t,
              }}
            >
              {line}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Word-by-word, on the beat. The kinetic systems' signature. */
export const KineticHeadline: React.FC<TypeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, sizePx } = useFitted(props);
  const exit = exitProgress(frame, fps, props.durationSeconds, 0.18);

  let wordIndex = -1;

  return (
    <div style={{ ...baseStyle(props, sizePx), opacity: 1 - exit }}>
      {lines.map((line, lineNumber) => (
        <div key={lineNumber} style={{ display: 'flex', flexWrap: 'wrap', gap: `0 ${sizePx * 0.26}px`, justifyContent: props.align === 'center' ? 'center' : 'flex-start' }}>
          {line.split(' ').map((word) => {
            wordIndex += 1;
            const t = ease(
              props.easing ?? 'out_expo',
              staggered(wordIndex, frame, fps, {
                delaySeconds: props.delaySeconds ?? 0,
                durationSeconds: 0.34,
                staggerSeconds: props.staggerSeconds ?? 0.045,
              }),
            );
            return (
              <span
                key={`${lineNumber}-${wordIndex}`}
                style={{
                  display: 'inline-block',
                  opacity: t,
                  transform: `translateY(${interpolate(t, sizePx * 0.22, 0)}px)`,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/**
 * Editorial: the whole block arrives at once behind a wipe, with a rule.
 * Nothing staggers — the point is composure.
 */
export const EditorialHeadline: React.FC<TypeProps & { rule?: boolean }> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, sizePx } = useFitted(props);
  const t = ease(
    props.easing ?? 'out_expo',
    staggered(0, frame, fps, {
      delaySeconds: props.delaySeconds ?? 0,
      durationSeconds: 0.9,
      staggerSeconds: 0,
    }),
  );
  const exit = exitProgress(frame, fps, props.durationSeconds, 0.4);

  return (
    <div style={{ opacity: 1 - exit }}>
      {props.rule !== false && (
        <div
          style={{
            height: Math.max(1, Math.round(props.tokens.frame.height * 0.0015)),
            width: `${t * 100}%`,
            background: props.tokens.line,
            marginBottom: props.tokens.space(2),
          }}
        />
      )}
      <div style={{ ...baseStyle(props, sizePx), clipPath: `inset(0 ${(1 - t) * 100}% 0 0)` }}>
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
};

/** A figure and its caption. The figure counts up; the caption does not move. */
export const MetricReveal: React.FC<{
  value: string;
  caption: string;
  tokens: DesignTokens;
  durationSeconds: number;
  easing?: EasingName;
  delaySeconds?: number;
  align?: 'left' | 'center' | 'right';
}> = ({ value, caption, tokens, durationSeconds, easing, delaySeconds, align }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease(
    easing ?? 'out_quint',
    staggered(0, frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 1.1, staggerSeconds: 0 }),
  );
  const exit = exitProgress(frame, fps, durationSeconds, 0.3);

  // Count up only when the figure is genuinely numeric. Animating "Enterprise"
  // to "Enterprise" is the kind of detail that looks broken.
  const numeric = value.match(/^([^\d]*)([\d,.]+)(.*)$/);
  const display = numeric
    ? `${numeric[1]}${formatLike(numeric[2]!, Number(numeric[2]!.replace(/,/g, '')) * t)}${numeric[3]}`
    : value;

  return (
    <div style={{ opacity: 1 - exit, textAlign: align ?? 'left' }}>
      <div
        style={{
          fontFamily: `${tokens.type.display.family}, system-ui, sans-serif`,
          fontSize: tokens.type.display.sizePx,
          fontWeight: 700,
          letterSpacing: `${tokens.type.display.tracking}em`,
          lineHeight: 1,
          color: tokens.onCanvas.primary,
          // Tabular figures stop the number jittering as digits change width.
          fontVariantNumeric: 'tabular-nums',
          opacity: Math.min(1, t * 2),
        }}
      >
        {display}
      </div>
      <div
        style={{
          marginTop: tokens.space(1.5),
          fontFamily: `${tokens.type.caption.family}, monospace`,
          fontSize: tokens.type.caption.sizePx,
          fontWeight: tokens.type.caption.weight,
          letterSpacing: `${tokens.type.caption.tracking}em`,
          color: tokens.onCanvas.muted,
          opacity: ease('out_quint', staggered(1, frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 0.6, staggerSeconds: 0.25 })),
        }}
      >
        {applyCase(caption, tokens.type.caption)}
      </div>
    </div>
  );
};

function formatLike(original: string, value: number): string {
  const decimals = original.includes('.') ? (original.split('.')[1]?.length ?? 0) : 0;
  const rounded = value.toFixed(decimals);
  return original.includes(',') ? Number(rounded).toLocaleString('en-US', { minimumFractionDigits: decimals }) : rounded;
}

/** A customer quote, held still, with attribution. */
export const QuoteScene: React.FC<{
  quote: string;
  attribution: string;
  tokens: DesignTokens;
  maxWidth: number;
  durationSeconds: number;
  delaySeconds?: number;
}> = ({ quote, attribution, tokens, maxWidth, durationSeconds, delaySeconds }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease('out_expo', staggered(0, frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 1, staggerSeconds: 0 }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.4);
  const lines = breakLines(quote, {
    family: tokens.type.statement.family,
    fontSizePx: tokens.type.statement.sizePx,
    tracking: tokens.type.statement.tracking,
    weight: tokens.type.statement.weight,
    maxWidthPx: maxWidth,
  });

  return (
    <div style={{ opacity: (1 - exit) * t, maxWidth }}>
      <div
        style={{
          fontFamily: `${tokens.type.statement.family}, system-ui, sans-serif`,
          fontSize: tokens.type.statement.sizePx,
          fontWeight: tokens.type.statement.weight,
          lineHeight: tokens.type.statement.lineHeight,
          letterSpacing: `${tokens.type.statement.tracking}em`,
          color: tokens.onCanvas.primary,
        }}
      >
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
      <div
        style={{
          marginTop: tokens.space(2),
          fontFamily: `${tokens.type.caption.family}, monospace`,
          fontSize: tokens.type.caption.sizePx,
          letterSpacing: `${tokens.type.caption.tracking}em`,
          color: tokens.onCanvas.muted,
        }}
      >
        {applyCase(attribution, tokens.type.caption)}
      </div>
    </div>
  );
};

export { measureText };
