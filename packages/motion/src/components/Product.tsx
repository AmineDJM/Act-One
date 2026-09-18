import React from 'react';
import { Img, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens } from '@act-one/design';
import { stageProduct } from '@act-one/design';
import type { CameraRecipe, EasingName } from '@act-one/core';
import { ease, exitProgress, interpolate, progress, staggered } from '../easing.ts';

/**
 * Product cinematography.
 *
 * The rule the whole system is built around: this only ever renders real
 * captured imagery. There is no code path here that draws a plausible-looking
 * interface, because the moment one exists somebody will use it.
 *
 * Treating a screenshot as a physical object — perspective, depth, a real
 * shadow, a lens-like push — is what separates this from a screen recording
 * with a zoom on it. The restraint is that each shot does ONE of those things.
 */
export type ProductWindowProps = {
  src: string;
  tokens: DesignTokens;
  camera: CameraRecipe;
  durationSeconds: number;
  delaySeconds?: number;
  easing?: EasingName;
  /** Browser chrome around the capture. Off for in-app screens. */
  chrome?: boolean;
  label?: string;
  /** Width over height of the capture. Staged at its own shape, so nothing is cropped away. */
  aspect?: number;
};

export const ProductWindow: React.FC<ProductWindowProps> = ({
  src,
  tokens,
  camera,
  durationSeconds,
  delaySeconds,
  easing,
  chrome = true,
  label,
  aspect = 16 / 9,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = ease(
    easing ?? 'out_quint',
    staggered(0, frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 1, staggerSeconds: 0 }),
  );
  // The camera move runs for the whole scene, independent of the entrance.
  const camT = ease(camera.easing, progress(frame, fps, { durationSeconds }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.35);

  // The chrome bar is part of the object: the box is sized so image plus bar
  // fit the stage, rather than the bar eating the bottom of the image.
  const chromeShare = chrome ? 0.052 : 0;
  const box = stageProduct(tokens.grid, aspect / (1 + chromeShare * aspect), {
    inset: chrome ? 0.86 : 0.92,
  });
  const scale = interpolate(camT, camera.fromScale, camera.toScale) * interpolate(entrance, 0.965, 1);
  const x = interpolate(camT, camera.fromX, camera.toX) * tokens.frame.width * 0.08;
  const y =
    interpolate(camT, camera.fromY, camera.toY) * tokens.frame.height * 0.08 +
    interpolate(entrance, tokens.frame.height * 0.025, 0);

  const chromeHeight = chrome ? Math.round(box.width * chromeShare) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        opacity: entrance * (1 - exit),
        borderRadius: tokens.radius.lg,
        overflow: 'hidden',
        background: tokens.surface,
        boxShadow: tokens.shadow?.soft,
        // Depth of field is applied to the frame, not the image, so the edge
        // stays crisp while the content softens — the way a real lens behaves.
        filter: camera.depthOfField > 0 ? `blur(${(1 - camT) * camera.depthOfField * 3}px)` : undefined,
      }}
    >
      {chrome && (
        <div
          style={{
            height: chromeHeight,
            background: tokens.surfaceRaised,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: chromeHeight * 0.6,
            gap: chromeHeight * 0.32,
            borderBottom: `1px solid ${tokens.line}`,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: chromeHeight * 0.22,
                height: chromeHeight * 0.22,
                borderRadius: '50%',
                background: tokens.line,
              }}
            />
          ))}
          {label && (
            <div
              style={{
                marginLeft: chromeHeight * 0.8,
                fontFamily: `${tokens.type.mono.family}, monospace`,
                fontSize: chromeHeight * 0.34,
                color: tokens.onCanvas.muted,
                letterSpacing: '0.02em',
              }}
            >
              {label}
            </div>
          )}
        </div>
      )}
      <Img
        src={src}
        style={{
          width: '100%',
          height: `calc(100% - ${chromeHeight}px)`,
          objectFit: 'cover',
          objectPosition: 'top center',
          display: 'block',
        }}
      />
    </div>
  );
};

/**
 * A crop that pushes into one region of a capture.
 *
 * This is how a feature gets pointed at without an arrow or a circle drawn on
 * the screen — the frame simply moves to where the answer is.
 */
export const ProductZoom: React.FC<{
  src: string;
  tokens: DesignTokens;
  /** Region of interest in normalised coordinates. */
  focus: { x: number; y: number; width: number; height: number };
  durationSeconds: number;
  easing?: EasingName;
  delaySeconds?: number;
}> = ({ src, tokens, focus, durationSeconds, easing, delaySeconds }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ease(easing ?? 'in_out_quart', progress(frame, fps, { delaySeconds, durationSeconds }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.3);

  const box = stageProduct(tokens.grid, 16 / 9, { inset: 0.94 });
  const targetScale = Math.min(3, 1 / Math.max(0.2, Math.max(focus.width, focus.height)));
  const scale = interpolate(t, 1.02, targetScale);
  // Translate so the focus region ends up centred, in the image's own space.
  const originX = (focus.x + focus.width / 2) * 100;
  const originY = (focus.y + focus.height / 2) * 100;

  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderRadius: tokens.radius.lg,
        overflow: 'hidden',
        boxShadow: tokens.shadow?.soft,
        opacity: 1 - exit,
      }}
    >
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
          transformOrigin: `${originX}% ${originY}%`,
          display: 'block',
        }}
      />
    </div>
  );
};

/**
 * Several captures held in depth, drifting as one coordinated space.
 *
 * Capped at three planes: beyond that it stops reading as depth and starts
 * reading as clutter, which is the failure mode of every "spatial UI" template.
 */
export const SpatialCards: React.FC<{
  srcs: string[];
  tokens: DesignTokens;
  durationSeconds: number;
  easing?: EasingName;
}> = ({ srcs, tokens, durationSeconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = progress(frame, fps, { durationSeconds });
  // The whole group settles toward the camera as it arrives, which is what
  // makes three planes read as one space rather than three cards.
  const settle = ease(easing ?? 'out_expo', progress(frame, fps, { durationSeconds: 1.4 }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.4);
  const planes = srcs.slice(0, 3);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        perspective: tokens.frame.width * 1.4,
        transform: `scale(${0.96 + settle * 0.04})`,
        opacity: 1 - exit,
      }}
    >
      {planes.map((src, index) => {
        const depth = index - (planes.length - 1) / 2;
        const enter = ease(easing ?? 'out_expo', staggered(index, frame, fps, { durationSeconds: 0.9, staggerSeconds: 0.12 }));
        const width = tokens.grid.safe.width * (0.62 - Math.abs(depth) * 0.06);
        return (
          <div
            key={src}
            style={{
              position: 'absolute',
              left: tokens.frame.width / 2 - width / 2 + depth * width * 0.44,
              top: tokens.frame.height / 2 - (width * 0.5625) / 2 + depth * tokens.frame.height * 0.03,
              width,
              height: width * 0.5625,
              borderRadius: tokens.radius.lg,
              overflow: 'hidden',
              background: tokens.surface,
              boxShadow: tokens.shadow?.soft,
              transform:
                `translateZ(${-Math.abs(depth) * 220}px) ` +
                `rotateY(${depth * -9 + (drift - 0.5) * 3}deg) ` +
                `translateY(${interpolate(enter, 60, 0)}px)`,
              opacity: enter * (1 - Math.abs(depth) * 0.18),
              zIndex: 10 - Math.abs(depth),
              filter: Math.abs(depth) > 0 ? `blur(${Math.abs(depth) * 1.6}px)` : undefined,
            }}
          >
            <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        );
      })}
    </div>
  );
};

/**
 * A cursor moving to a target and clicking.
 *
 * Real interaction recordings are jittery and off-tempo. Replaying the *path*
 * with our own easing keeps the action honest while letting it land on the cut.
 */
export const CursorSequence: React.FC<{
  src: string;
  tokens: DesignTokens;
  /** Normalised path points the cursor visits, in order. */
  path: { x: number; y: number }[];
  durationSeconds: number;
  easing?: EasingName;
}> = ({ src, tokens, path, durationSeconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = stageProduct(tokens.grid, 16 / 9, { inset: 0.9 });
  const exit = exitProgress(frame, fps, durationSeconds, 0.3);

  const points = path.length > 0 ? path : [{ x: 0.5, y: 0.5 }];
  const legDuration = durationSeconds / Math.max(1, points.length);
  const legIndex = Math.min(points.length - 1, Math.floor((frame / fps) / legDuration));
  const legT = ease(easing ?? 'out_quint', ((frame / fps) % legDuration) / legDuration);

  const from = points[Math.max(0, legIndex - 1)] ?? points[0]!;
  const to = points[legIndex] ?? points[0]!;
  const cursorX = interpolate(legT, from.x, to.x) * box.width;
  const cursorY = interpolate(legT, from.y, to.y) * box.height;
  // Click pulse at the end of each leg.
  const clickT = legT > 0.86 ? (legT - 0.86) / 0.14 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderRadius: tokens.radius.lg,
        overflow: 'hidden',
        boxShadow: tokens.shadow?.soft,
        opacity: 1 - exit,
      }}
    >
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {clickT > 0 && (
        <div
          style={{
            position: 'absolute',
            left: cursorX - box.width * 0.02,
            top: cursorY - box.width * 0.02,
            width: box.width * 0.04,
            height: box.width * 0.04,
            borderRadius: '50%',
            border: `2px solid ${tokens.accent}`,
            opacity: 1 - clickT,
            transform: `scale(${1 + clickT * 1.6})`,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: cursorX,
          top: cursorY,
          width: 0,
          height: 0,
          borderLeft: `${box.width * 0.009}px solid ${tokens.onCanvas.primary}`,
          borderTop: `${box.width * 0.006}px solid transparent`,
          borderBottom: `${box.width * 0.014}px solid transparent`,
          filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))',
        }}
      />
    </div>
  );
};

/**
 * A photograph, full frame.
 *
 * The library's real pictures — a founder, an office, a product on a table —
 * are shown the way a documentary would: the whole frame, one slow camera
 * move, nothing drawn on top of the picture except the words the scene
 * carries, in the caption size, sitting where the frame's grid puts them.
 * The restraint is the point; a photograph in a card with a drop shadow is
 * a slide.
 */
export const PhotoHold: React.FC<{
  src: string;
  tokens: DesignTokens;
  camera: CameraRecipe;
  durationSeconds: number;
  easing?: EasingName;
  delaySeconds?: number;
  children?: React.ReactNode;
}> = ({ src, tokens, camera, durationSeconds, easing, delaySeconds, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = ease(easing ?? 'out_quint', progress(frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 0.9 }));
  const camT = ease(camera.easing, progress(frame, fps, { durationSeconds }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.35);

  // A static camera still breathes: the quietest possible push keeps a held
  // photograph from reading as a paused video.
  const fromScale = camera.move === 'static' ? 1.0 : camera.fromScale;
  const toScale = camera.move === 'static' ? 1.03 : camera.toScale;
  const scale = interpolate(camT, fromScale, toScale);
  const x = interpolate(camT, camera.fromX, camera.toX) * tokens.frame.width;
  const y = interpolate(camT, camera.fromY, camera.toY) * tokens.frame.height;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: tokens.canvas, opacity: (1 - exit) * Math.min(1, entrance * 1.4) }}>
      <Img
        src={src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          transformOrigin: '50% 50%',
        }}
      />
      {children ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            // Only where the words sit: the picture stays the picture.
            background: `linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.0) 45%)`,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};
