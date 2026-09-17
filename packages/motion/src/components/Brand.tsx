import React from 'react';
import { Img, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens } from '@act-one/design';
import { applyCase, breakLines } from '@act-one/design';
import type { EasingName } from '@act-one/core';
import { ease, exitProgress, interpolate, progress, staggered } from '../easing.ts';

/**
 * Brand lockups and endings.
 *
 * The last three seconds are what the viewer remembers, and they are where
 * automated films most obviously fall apart: a logo scaled to an arbitrary
 * size, dropped in the middle, with a URL in the wrong typeface.
 *
 * So the mark is optically sized against cap height rather than to a fixed
 * fraction of the frame, and the CTA sits on the same grid as every other
 * scene in the film.
 */
export const LogoReveal: React.FC<{
  logoUrl: string | null;
  wordmark: string;
  tokens: DesignTokens;
  durationSeconds: number;
  easing?: EasingName;
}> = ({ logoUrl, wordmark, tokens, durationSeconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease(easing ?? 'out_expo', progress(frame, fps, { durationSeconds: 1.1 }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.5);

  // Optical sizing: a wordmark and an icon at the same pixel height look
  // wildly different in weight, so the mark is sized against cap height.
  const markHeight = tokens.type.display.sizePx * 0.9;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space(2),
          opacity: t,
          transform: `translateY(${interpolate(t, tokens.frame.height * 0.012, 0)}px)`,
        }}
      >
        {logoUrl ? (
          <Img
            src={logoUrl}
            style={{ height: markHeight, width: 'auto', display: 'block' }}
          />
        ) : (
          <div
            style={{
              fontFamily: `${tokens.type.display.family}, system-ui, sans-serif`,
              fontSize: tokens.type.display.sizePx * 0.62,
              fontWeight: 700,
              letterSpacing: `${tokens.type.display.tracking}em`,
              color: tokens.onCanvas.primary,
            }}
          >
            {wordmark}
          </div>
        )}
      </div>
    </div>
  );
};

export const CtaEndCard: React.FC<{
  headline: string;
  cta: string;
  logoUrl: string | null;
  wordmark: string;
  tokens: DesignTokens;
  durationSeconds: number;
  easing?: EasingName;
}> = ({ headline, cta, logoUrl, wordmark, tokens, durationSeconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exit = exitProgress(frame, fps, durationSeconds, 0.4);
  const { grid } = tokens;

  const lines = breakLines(headline, {
    family: tokens.type.statement.family,
    fontSizePx: tokens.type.statement.sizePx,
    tracking: tokens.type.statement.tracking,
    weight: tokens.type.statement.weight,
    maxWidthPx: grid.safe.width * 0.8,
    maxLines: 2,
  });

  const headlineT = ease(easing ?? 'out_quint', staggered(0, frame, fps, { durationSeconds: 0.8, staggerSeconds: 0 }));
  const ctaT = ease(easing ?? 'out_quint', staggered(1, frame, fps, { durationSeconds: 0.7, staggerSeconds: 0.22 }));
  const markT = ease(easing ?? 'out_quint', staggered(2, frame, fps, { durationSeconds: 0.7, staggerSeconds: 0.22 }));

  return (
    <div
      style={{
        position: 'absolute',
        left: grid.safe.x,
        top: grid.safe.y,
        width: grid.safe.width,
        height: grid.safe.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          fontFamily: `${tokens.type.statement.family}, system-ui, sans-serif`,
          fontSize: tokens.type.statement.sizePx,
          fontWeight: tokens.type.statement.weight,
          lineHeight: tokens.type.statement.lineHeight,
          letterSpacing: `${tokens.type.statement.tracking}em`,
          color: tokens.onCanvas.primary,
          opacity: headlineT,
          transform: `translateY(${interpolate(headlineT, tokens.frame.height * 0.015, 0)}px)`,
        }}
      >
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>

      <div
        style={{
          marginTop: tokens.space(3),
          fontFamily: `${tokens.type.caption.family}, monospace`,
          fontSize: tokens.type.caption.sizePx,
          letterSpacing: `${tokens.type.caption.tracking}em`,
          color: tokens.accent,
          opacity: ctaT,
        }}
      >
        {applyCase(cta, tokens.type.caption)}
      </div>

      <div style={{ marginTop: tokens.space(4), opacity: markT, display: 'flex', alignItems: 'center' }}>
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: tokens.type.statement.sizePx * 0.62, width: 'auto' }} />
        ) : (
          <div
            style={{
              fontFamily: `${tokens.type.display.family}, system-ui, sans-serif`,
              fontSize: tokens.type.statement.sizePx * 0.52,
              fontWeight: 700,
              color: tokens.onCanvas.primary,
              letterSpacing: `${tokens.type.display.tracking}em`,
            }}
          >
            {wordmark}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * A wipe that reveals the next scene through a moving edge.
 *
 * Used instead of a dissolve because a dissolve between two typographic frames
 * produces an unreadable mush in the middle, which is where most automated
 * films spend a third of their runtime.
 */
export const MaskReveal: React.FC<{
  children: React.ReactNode;
  tokens: DesignTokens;
  durationSeconds: number;
  direction?: 'left' | 'up';
  easing?: EasingName;
}> = ({ children, tokens, durationSeconds, direction = 'left', easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease(easing ?? 'out_expo', progress(frame, fps, { durationSeconds: Math.min(0.8, durationSeconds) }));
  const inset =
    direction === 'left' ? `inset(0 ${(1 - t) * 100}% 0 0)` : `inset(${(1 - t) * 100}% 0 0 0)`;

  return <div style={{ position: 'absolute', inset: 0, clipPath: inset, background: tokens.canvas }}>{children}</div>;
};

/** Depth transition: the outgoing frame recedes as the incoming one arrives. */
export const DepthTransition: React.FC<{
  children: React.ReactNode;
  tokens: DesignTokens;
  durationSeconds: number;
  easing?: EasingName;
}> = ({ children, tokens, durationSeconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease(easing ?? 'in_out_quart', progress(frame, fps, { durationSeconds }));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `scale(${interpolate(t, 1.06, 1)})`,
        opacity: Math.min(1, t * 3),
        background: tokens.canvas,
      }}
    >
      {children}
    </div>
  );
};
