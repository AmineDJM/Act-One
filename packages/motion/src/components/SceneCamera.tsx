import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAMERA_DRIVEN_RECIPES, type CameraRecipe, type MotionRecipeName } from '@act-one/core';
import { ease, interpolate } from '../easing.ts';

/**
 * A camera over the whole frame, for the scenes that never had one.
 *
 * `cameraRecipe` was reaching exactly four components — the two that show a
 * product capture, the one that plays footage, and the depth transition. Every
 * typographic scene, every statistic, every quote and every logo reveal was
 * rendered inside a static frame, and the storyboard's camera move for those
 * scenes was written, stored, checked by QA and then thrown away at the point
 * of drawing.
 *
 * The consequence is the whole measurement. A typographic beat animates its
 * words in over about six hundred milliseconds and then holds, perfectly
 * still, for the remaining three or four seconds. Measured across a film that
 * is mostly typographic, that is ninety per cent of the running time with
 * nothing moving — against ten to forty-eight per cent in the reference films
 * — and a mean optical flow of 0.037 against their 0.80 to 1.08. Act One's
 * films were not badly animated. For most of their duration they were not
 * animated at all.
 *
 * So the camera is applied here, once, around whatever the scene drew. Scenes
 * whose own component already consumes the recipe are skipped, because two
 * cameras on one shot is a dolly on a dolly.
 *
 * WHY A CAMERA AND NOT MORE ANIMATION. A camera moves every pixel in the
 * frame, including the ones that have finished arriving. It is the cheapest
 * honest way to make a held frame stop being held, it is what the references
 * do — between a half and two thirds of their motion is explained by a single
 * camera move — and it cannot break a layout, because the composition inside
 * it is unchanged.
 */

/**
 * How far a camera may travel, as a fraction of the frame.
 *
 * Bounded rather than free. A camera move large enough to be felt is the point
 * of this component; one large enough to be noticed is a different film, and
 * one that pushes past the safe area puts type off the edge of the screen. The
 * ceiling is what a 1.18 scale allows before an element on the safe margin
 * leaves the frame.
 */
export const MAX_CAMERA_SCALE = 1.18;
export const MAX_CAMERA_TRAVEL = 0.06;

export type SceneCameraProps = {
  camera: CameraRecipe;
  recipe: MotionRecipeName;
  durationSeconds: number;
  children: React.ReactNode;
};

/** Whether this scene's own body already moves the camera itself. */
export function bodyDrivesCamera(recipe: MotionRecipeName): boolean {
  return CAMERA_DRIVEN_RECIPES.includes(recipe);
}

export const SceneCamera: React.FC<SceneCameraProps> = ({
  camera,
  recipe,
  durationSeconds,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (bodyDrivesCamera(recipe)) return <>{children}</>;

  /*
   * The move runs across the whole shot rather than easing to a stop early.
   *
   * A camera that settles at seventy per cent of the shot gives the last thirty
   * per cent back to stillness, which is the problem this exists to solve. The
   * easing still shapes it — a shot can arrive rather than stop — but the
   * motion is live until the cut.
   */
  const t = durationSeconds > 0 ? Math.min(1, frame / fps / durationSeconds) : 0;
  const eased = ease(camera.easing, t);

  const scale = clampScale(interpolate(eased, camera.fromScale, camera.toScale));
  const x = clampTravel(interpolate(eased, camera.fromX, camera.toX));
  const y = clampTravel(interpolate(eased, camera.fromY, camera.toY));

  const still = scale === 1 && x === 0 && y === 0;
  if (still) return <>{children}</>;

  return (
    <AbsoluteFill
      style={{
        transform: `translate(${(x * 100).toFixed(4)}%, ${(y * 100).toFixed(4)}%) scale(${scale.toFixed(5)})`,
        // A camera that scales up must not reveal the edge of what it is
        // filming: the canvas behind it is the same colour, so a fraction of
        // over-scan costs nothing and guarantees no seam.
        transformOrigin: 'center center',
        willChange: 'transform',
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1 / MAX_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, value));
}

function clampTravel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_CAMERA_TRAVEL, Math.min(MAX_CAMERA_TRAVEL, value));
}
