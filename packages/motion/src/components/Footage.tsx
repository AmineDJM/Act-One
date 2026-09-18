import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CameraRecipe, EasingName } from '@act-one/core';
import type { DesignTokens } from '@act-one/design';
import { ease, exitProgress, interpolate, progress } from '../easing.ts';

/**
 * Moving footage, held in the frame.
 *
 * The one thing in this film that was not drawn: a generated shot, or a 3D
 * render, playing rather than sitting still. Everything around it is
 * deterministic, so this is deliberately the quietest component in the set —
 * the picture is doing the work and anything laid over it is competing with
 * the only shot in the film that has texture.
 *
 * OffthreadVideo rather than Video, because a render needs the frame that
 * belongs to this frame. The browser's own video element gives whatever it has
 * decoded by the time the screenshot is taken, which in a headless render is a
 * different frame each run and sometimes a black one.
 *
 * The camera still moves over it. A generated clip is usually four seconds of
 * near-static motion, and cutting to it without a push reads as a screensaver
 * dropped into the middle of the film.
 */
export const Footage: React.FC<{
  src: string;
  tokens: DesignTokens;
  camera: CameraRecipe;
  durationSeconds: number;
  easing?: EasingName;
  delaySeconds?: number;
  /** Plays muted. A generated shot's own audio is never part of our mix. */
  children?: React.ReactNode;
}> = ({ src, tokens, camera, durationSeconds, easing, delaySeconds, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = ease(easing ?? 'out_quint', progress(frame, fps, { delaySeconds: delaySeconds ?? 0, durationSeconds: 0.6 }));
  const camT = ease(camera.easing, progress(frame, fps, { durationSeconds }));
  const exit = exitProgress(frame, fps, durationSeconds, 0.35);

  // A static camera still breathes, for the same reason a held photograph does.
  const fromScale = camera.move === 'static' ? 1.0 : camera.fromScale;
  const toScale = camera.move === 'static' ? 1.03 : camera.toScale;
  const scale = interpolate(camT, fromScale, toScale);
  const x = interpolate(camT, camera.fromX, camera.toX) * tokens.frame.width;
  const y = interpolate(camT, camera.fromY, camera.toY) * tokens.frame.height;

  return (
    <AbsoluteFill style={{ backgroundColor: tokens.canvas, overflow: 'hidden', opacity: (1 - exit) * Math.min(1, entrance * 1.4) }}>
      <OffthreadVideo
        src={src}
        muted
        /*
         * The clip is almost always shorter than the shot it fills, because the
         * engine's minimum is four seconds and a beat is often less. Holding
         * the last frame is right and looping is not: a four-second loop inside
         * a six-second shot visibly restarts, and a viewer reads a restart as a
         * glitch rather than as a choice.
         */
        pauseWhenBuffering
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          transformOrigin: 'center',
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
