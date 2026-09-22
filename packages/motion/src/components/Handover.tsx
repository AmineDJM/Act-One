import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneHandover } from '@act-one/core';
import { EASINGS } from '../easing.ts';

/**
 * What happens at the boundary between two scenes.
 *
 * FOUND BY READING THE REFERENCES. A model watching the three films this
 * system is asked to match listed their boundaries, and most of them are not
 * cuts: "camera pans down to new UI layout", "camera zooms into white space of
 * a message", "button scales to fill screen with blue", "text 'change'
 * dissolves into flame logo". One of those films changes scene nineteen times
 * and hard-cuts almost never — it is a single space the camera travels
 * through. Meanwhile the scene language had a `handover` on every scene, with
 * a mechanism, a duration and the ids of the objects that survive, and NOTHING
 * READ IT. Ten declared transitions, ten butt cuts.
 *
 * THE SHAPE THAT KEEPS THE TIMELINE HONEST. A transition needs two scenes on
 * screen at once, and there are two ways to get that: start the incoming scene
 * early, or let the outgoing one run late. Only the second leaves the timeline
 * alone. The sound is placed against the cumulative scene durations, so a
 * transition that pulled each scene forward would slide every cue in the film
 * against the picture by a growing amount — the kind of defect that is
 * inaudible on the first cut and unfixable by the tenth.
 *
 * WHAT IS DELIBERATELY NOT HERE. No morph. `morph` is in the vocabulary
 * because the reference films do it, and doing it honestly means matching
 * shapes between two renders rather than cross-fading them and calling it a
 * morph. It falls back to a dissolve and the film says `morph` in the graph,
 * so the gap is visible rather than disguised.
 */

export type HandoverSide = {
  mechanism: SceneHandover['mechanism'];
  /** How long the two scenes are both on screen. */
  seconds: number;
  /** For the outgoing side: how long it plays normally first. */
  holdSeconds?: number;
};

/** How long a mechanism overlaps, given what the scene asked for. */
export function handoverOverlap(handover: SceneHandover): number {
  // A cut is a cut. Asking for a cut with a duration is asking for a dissolve,
  // and quietly giving one would be the renderer overruling the director.
  if (handover.mechanism === 'cut') return 0;
  if (handover.mechanism === 'field_change') return 0;
  if (handover.durationSeconds <= 0) return 0;
  return Math.min(handover.durationSeconds, 1.5);
}

/** The style an arriving scene carries at `p` through its entrance, 0..1. */
function arriving(mechanism: HandoverSide['mechanism'], p: number): React.CSSProperties {
  const eased = EASINGS.out_quint(p);
  switch (mechanism) {
    case 'scale_through': {
      /*
       * IN-OUT, NOT OUT-QUINT, AND THIS ONE HAD TO BE MEASURED TO BE SEEN.
       *
       * out_quint front-loads hard: two fifths of the way through the window
       * it is ninety percent arrived. On a 0.55s handover that put the whole
       * transition inside the first tenth of a second, so an authored scene
       * change rendered as a hard cut — and a film compared against a
       * reference twice came back with "slideshow format" both times while
       * this mechanism was, on paper, already being used.
       *
       * A transition needs to be visible for the duration it was given. This
       * is the one mechanism where the travel IS the point: the previous scene
       * pushes into the frame and this one opens out of it, which only reads
       * if the opening takes time. The other mechanisms keep the snappier
       * curve, because for them arrival is the point and travel is not.
       */
      const opening = EASINGS.in_out_cubic(p);
      return { opacity: opening, transform: `scale(${(0.82 + 0.18 * opening).toFixed(4)})` };
    }
    case 'camera_carry':
      // The move continues: this scene is already travelling when it arrives.
      return { opacity: eased, transform: `translateX(${((1 - eased) * 7).toFixed(3)}%)` };
    case 'mask_reveal':
      // Wiped in, rather than faded: the edge is the event.
      return { clipPath: `inset(0 ${((1 - eased) * 100).toFixed(2)}% 0 0)` };
    case 'match_move':
      return { opacity: eased, transform: `scale(${(1.04 - 0.04 * eased).toFixed(4)})` };
    default:
      // object_handoff, morph, fade, sound_bridge: the carried objects are
      // drawn in both scenes, so a dissolve is what makes them continuous.
      return { opacity: eased };
  }
}

/** The style a leaving scene carries at `p` through its exit, 0..1. */
function leaving(mechanism: HandoverSide['mechanism'], p: number): React.CSSProperties {
  const eased = EASINGS.in_out_cubic(p);
  switch (mechanism) {
    case 'scale_through':
      // Pushed through and past: this is the "zoom into the white space" the
      // reference films use to change scene without cutting.
      return { opacity: 1 - eased, transform: `scale(${(1 + 0.5 * eased).toFixed(4)})` };
    case 'camera_carry':
      return { opacity: 1 - eased, transform: `translateX(${(-6 * eased).toFixed(3)}%)` };
    case 'mask_reveal':
      // Stays put and stays lit: the incoming wipe is doing the work, and
      // fading the outgoing as well would show the canvas through the seam.
      return {};
    case 'match_move':
      return { opacity: 1 - eased, transform: `scale(${(1 + 0.06 * eased).toFixed(4)})` };
    default:
      return { opacity: 1 - eased };
  }
}

export const Handover: React.FC<{
  incoming: HandoverSide | null;
  outgoing: HandoverSide | null;
  children: React.ReactNode;
}> = ({ incoming, outgoing, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  let style: React.CSSProperties = {};

  if (incoming && seconds < incoming.seconds) {
    style = arriving(incoming.mechanism, Math.max(0, Math.min(1, seconds / incoming.seconds)));
  }

  if (outgoing) {
    const hold = outgoing.holdSeconds ?? 0;
    if (seconds >= hold) {
      const p = Math.max(0, Math.min(1, (seconds - hold) / outgoing.seconds));
      // Composed rather than replaced: a scene can still be arriving when it
      // starts to leave, which happens whenever two short scenes meet.
      const exit = leaving(outgoing.mechanism, p);
      style = {
        ...style,
        ...exit,
        ...(style.opacity !== undefined && exit.opacity !== undefined
          ? { opacity: Number(style.opacity) * Number(exit.opacity) }
          : {}),
        ...(style.transform && exit.transform
          ? { transform: `${style.transform} ${exit.transform}` }
          : {}),
      };
    }
  }

  return <AbsoluteFill style={{ ...style, willChange: 'transform, opacity' }}>{children}</AbsoluteFill>;
};
