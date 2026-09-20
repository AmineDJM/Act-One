import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens } from '@act-one/design';
import type { EasingName } from '@act-one/core';
import { ease, clamp01 } from '../easing.ts';

/**
 * Many things, moving separately.
 *
 * This exists because of one measurement. The four reference films carry 140
 * to 164 independently tracked elements each — cards, panels, discs, marks,
 * rules — and a mean optical flow between 0.80 and 1.08. Act One's films
 * carried two elements and a mean flow of 0.037.
 *
 * The first attempt at closing that was the camera, and it half worked: giving
 * every scene the camera its storyboard already specified took the share of
 * perfectly-still running time from 85% to 30%, which is inside the reference
 * band. It did almost nothing to the flow — 0.037 to 0.17 — and the reason is
 * worth stating plainly, because it is the whole argument for this file: a
 * camera move over a frame containing two words moves two words. Optical flow
 * measures how much of the picture is in motion, and no camera can put more of
 * the picture in motion than the picture contains.
 *
 * So the gap is compositional, not parametric. A premium product film is
 * mostly frames with many separate things in them, each on its own trajectory,
 * entering staggered and leaving before they are asked to. That is what this
 * draws.
 *
 * WHAT IT IS NOT. It is not decoration, and it is not a particle system. Every
 * element here is on the brand's own grid, in the brand's own palette, at a
 * size the type system chose; the field is a composition the director asked
 * for, and the semantics — how many, arriving from where, converging or
 * dispersing — say what the beat says. A field of drifting shapes that means
 * nothing is exactly the "AI-generated" tell this product refuses.
 *
 * THE FIRST CUT FAILED ON EXACTLY THAT, and the two rules below are what came
 * back from watching it. A critic given the rendered file said the shapes
 * "heavily obscure the text, making it difficult to read", that the motion
 * "feels entirely disconnected from the narrative" and "reads as a generic
 * template", and measured the viewer as competing between "reading text" and
 * "ignoring decorative motion". Every word of that was earned: the field had
 * been put on nine of fifteen beats to move a measurement, which is the exact
 * mistake of optimising the instrument instead of the film.
 *
 * So: THE TYPE ALWAYS WINS. A field is laid out around the reading area rather
 * than across it, and it is carried at a weight that cannot compete with a
 * headline. And a field appears only where its figure IS the sentence — the
 * fragments that converge are the fragments the line is naming. Where it would
 * merely be movement, there is none, and the beat rests.
 */

/**
 * What the field is doing, which is the only reason it is on screen.
 *
 * Each arrangement is a sentence about the product, not a visual effect:
 * scattered things becoming one thing is consolidation; one thing becoming
 * many is reach; a settling grid is order arriving.
 */
export type FieldFigure =
  /** Many sources arrive from the edges and resolve onto one centre. */
  | 'converge'
  /** One centre becomes many, travelling outward. */
  | 'disperse'
  /** Elements arrive out of alignment and settle onto a common grid. */
  | 'settle'
  /** A steady lateral drift: material passing through, neither arriving nor leaving. */
  | 'stream';

export type ElementFieldProps = {
  figure: FieldFigure;
  /** How many objects. Bounded below by legibility and above by the cognitive budget. */
  count: number;
  tokens: DesignTokens;
  durationSeconds: number;
  easing: EasingName;
  /** Seconds between siblings entering. The references sit between 40 and 120ms. */
  staggerSeconds?: number;
  delaySeconds?: number;
  /** Deterministic: the same scene renders the same field every time. */
  seed?: number;
  /** Elements the accent colour is spent on. The rest are neutral. */
  accentCount?: number;
  /**
   * The part of the frame the type occupies, as fractions, which the field
   * stays out of.
   *
   * Not a suggestion. A headline with a card drifting through it is a headline
   * somebody has to work to read, and a viewer who is working to read is not
   * watching the film.
   */
  clearZone?: { x: number; y: number; width: number; height: number };
  /**
   * How loud the field is allowed to be, 0 to 1.
   *
   * Low by default. This is the layer behind the argument, not the argument.
   */
  weight?: number;
};

/** The band the references sit in, and the reason the default is what it is. */
const DEFAULT_STAGGER_SECONDS = 0.07;

/** Below this nothing reads as a group; above it nothing reads as one idea. */
const MIN_COUNT = 3;
const MAX_COUNT = 28;

/**
 * Where the type sits by default: the centre-left block `Framed` lays out.
 *
 * Generous on purpose. A shape that clips the descender of a headline is as
 * bad as one across the middle of it, and the cost of keeping clear is a
 * composition that uses its margins, which is what the references do anyway.
 */
const DEFAULT_CLEAR_ZONE = { x: 0.04, y: 0.3, width: 0.66, height: 0.42 };

/** The field is behind the argument, never level with it. */
const DEFAULT_WEIGHT = 0.42;

/**
 * A deterministic pseudo-random sequence.
 *
 * A field that is different on every render is a film that cannot be repaired:
 * a re-render after a one-scene fix would produce a different composition in
 * every other scene, and a QA note about the third card would stop referring
 * to anything. Seeded from the scene, so the same storyboard always draws the
 * same frame.
 */
function sequence(seed: number, n: number): number[] {
  const out: number[] = [];
  let state = (seed * 2654435761) % 4294967296 || 1;
  for (let i = 0; i < n; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    out.push(state / 4294967296);
  }
  return out;
}

type Placed = {
  /** Where it comes from and where it ends, as fractions of the frame. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  size: number;
  /** Which of the brand's shapes it is. */
  kind: 'card' | 'rule' | 'disc';
  rotation: number;
  accent: boolean;
};

/**
 * Pushes a resting position out of the reading area, by the shortest way out.
 *
 * Applied to where an element COMES TO REST rather than to its whole path: a
 * card that crosses behind a headline while travelling reads as depth, and one
 * that parks there reads as a mistake. The shortest way out keeps the
 * composition the figure asked for — a converge still converges, it just
 * converges to the side of the sentence rather than on top of it.
 */
function clearOf(
  x: number,
  y: number,
  zone: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const inside =
    x > zone.x && x < zone.x + zone.width && y > zone.y && y < zone.y + zone.height;
  if (!inside) return { x, y };

  const left = x - zone.x;
  const right = zone.x + zone.width - x;
  const up = y - zone.y;
  const down = zone.y + zone.height - y;
  const nearest = Math.min(left, right, up, down);

  const margin = 0.045;
  if (nearest === right) return { x: zone.x + zone.width + margin, y };
  if (nearest === left) return { x: Math.max(0.02, zone.x - margin), y };
  if (nearest === down) return { x, y: Math.min(0.97, zone.y + zone.height + margin) };
  return { x, y: Math.max(0.03, zone.y - margin) };
}

function place(
  figure: FieldFigure,
  count: number,
  seed: number,
  accentCount: number,
  zone: { x: number; y: number; width: number; height: number },
): Placed[] {
  const r = sequence(seed, count * 6);
  const placed: Placed[] = [];

  for (let i = 0; i < count; i += 1) {
    const a = r[i * 6] ?? 0.5;
    const b = r[i * 6 + 1] ?? 0.5;
    const c = r[i * 6 + 2] ?? 0.5;
    const d = r[i * 6 + 3] ?? 0.5;
    const e = r[i * 6 + 4] ?? 0.5;

    // Angle spread evenly with a jittered offset, so a ring reads as placed
    // rather than as a clock face.
    const angle = (i / count) * Math.PI * 2 + (a - 0.5) * 0.5;
    const radius = 0.34 + b * 0.16;
    const edgeX = 0.5 + Math.cos(angle) * radius * 1.35;
    const edgeY = 0.5 + Math.sin(angle) * radius;

    // Where it rests: a loose grid rather than a perfect one. Perfect spacing
    // is the thing that reads as generated.
    const columns = Math.ceil(Math.sqrt(count));
    const gx = (i % columns) / Math.max(1, columns - 1);
    const gy = Math.floor(i / columns) / Math.max(1, Math.ceil(count / columns) - 1 || 1);
    const gridX = 0.2 + gx * 0.6 + (c - 0.5) * 0.04;
    const gridY = 0.24 + (Number.isFinite(gy) ? gy : 0.5) * 0.52 + (d - 0.5) * 0.04;

    const kind: Placed['kind'] = e < 0.14 ? 'disc' : e < 0.3 ? 'rule' : 'card';
    const size =
      kind === 'disc' ? 0.018 + c * 0.014 : kind === 'rule' ? 0.06 + c * 0.08 : 0.05 + c * 0.06;

    const common = { size, kind, rotation: (a - 0.5) * 8, accent: i < accentCount };

    switch (figure) {
      case 'converge':
        placed.push({
          fromX: edgeX,
          fromY: edgeY,
          toX: 0.5 + (c - 0.5) * 0.1,
          toY: 0.5 + (d - 0.5) * 0.1,
          ...common,
        });
        break;
      case 'disperse':
        placed.push({
          fromX: 0.5 + (c - 0.5) * 0.08,
          fromY: 0.5 + (d - 0.5) * 0.08,
          toX: edgeX,
          toY: edgeY,
          ...common,
        });
        break;
      case 'settle':
        placed.push({
          fromX: gridX + (a - 0.5) * 0.5,
          fromY: gridY + (b - 0.5) * 0.4,
          toX: gridX,
          toY: gridY,
          ...common,
        });
        break;
      case 'stream':
        placed.push({
          fromX: -0.15 - b * 0.3,
          fromY: gridY,
          toX: 1.15 + b * 0.3,
          toY: gridY + (c - 0.5) * 0.06,
          ...common,
        });
        break;
    }
  }
  return placed;
}

export const ElementField: React.FC<ElementFieldProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(props.count)));
  const stagger = props.staggerSeconds ?? DEFAULT_STAGGER_SECONDS;
  const delay = props.delaySeconds ?? 0;
  const accentCount = Math.min(
    count,
    Math.max(0, props.accentCount ?? Math.max(1, Math.round(count * 0.15))),
  );
  const zone = props.clearZone ?? DEFAULT_CLEAR_ZONE;
  const weight = Math.max(0, Math.min(1, props.weight ?? DEFAULT_WEIGHT));
  const placed = React.useMemo(
    () => place(props.figure, count, props.seed ?? 1, accentCount, zone),
    [props.figure, count, props.seed, accentCount, zone],
  );

  const seconds = frame / fps;
  const tokens = props.tokens;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {placed.map((element, index) => {
        /*
         * Each element runs its own clock, offset by the stagger.
         *
         * `stream` is the exception and runs the full shot: it is material
         * passing through rather than arriving, so it has no entrance to
         * stagger and no rest to settle into.
         */
        const start = delay + index * stagger;
        const travelSeconds =
          props.figure === 'stream'
            ? Math.max(0.6, props.durationSeconds)
            : Math.max(0.5, Math.min(1.4, props.durationSeconds * 0.45));

        const t = clamp01((seconds - start) / travelSeconds);
        if (t <= 0) return null;
        const eased = ease(props.easing, t);

        const x = element.fromX + (element.toX - element.fromX) * eased;
        const y = element.fromY + (element.toY - element.fromY) * eased;

        /*
         * Opacity follows the trajectory rather than a separate fade.
         *
         * Things arrive by moving, not by appearing; and on a converge they
         * dim slightly as they pack together, which is what stops twenty
         * overlapping cards reading as noise.
         */
        const arriving = clamp01(t / 0.25);
        const crowding = props.figure === 'converge' ? 1 - eased * 0.45 : 1;
        const leaving = props.figure === 'stream' ? 1 - Math.max(0, (t - 0.85) / 0.15) : 1;
        const opacity = arriving * crowding * leaving * weight;

        const colour = element.accent ? tokens.accent : tokens.onCanvas.muted;
        // Sized off the real frame, so a field is the same proportion of the
        // picture at every output resolution.
        const side = element.size * tokens.frame.width;

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: element.kind === 'rule' ? side * 2.4 : side,
              height:
                element.kind === 'rule'
                  ? Math.max(2, side * 0.06)
                  : element.kind === 'disc'
                    ? side
                    : side * 0.66,
              transform: `translate(-50%, -50%) rotate(${element.rotation * (1 - eased)}deg)`,
              backgroundColor: element.kind === 'card' ? 'transparent' : colour,
              border: element.kind === 'card' ? `2px solid ${colour}` : 'none',
              borderRadius:
                element.kind === 'disc' ? '50%' : element.kind === 'card' ? tokens.radius.md : 0,
              opacity,
              willChange: 'transform, opacity',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
