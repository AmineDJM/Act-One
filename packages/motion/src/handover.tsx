import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Handover, HandoverPlan, SceneWindow } from '@act-one/core';
import { EASINGS } from './easing.ts';

/**
 * A beat arriving, and a beat leaving.
 *
 * The renderer used to mount each scene in a Sequence with a hard frame range
 * and no overlap, so scene N ended on the frame scene N+1 began. Two scenes
 * were never on screen together, which means no material could survive a
 * boundary and the only join the composition could physically produce was a
 * replacement. Every other kind of transition was unreachable, not unchosen.
 *
 * With the windows overlapping, both scenes render during the join and this
 * decides what each of them does with the time. The outgoing scene LEAVES —
 * accelerating away on an ease-in, which is the family Act One films had
 * almost none of and is exactly why nothing could ever get out of the way.
 */

/** Where a scene is in its own life: arriving, playing, or leaving. */
export type Phase = { arriving: number; leaving: number };

export function phaseOf(window: SceneWindow, fps: number, frame: number): Phase {
  const at = window.fromSeconds + frame / fps;
  const arriveEnd = window.fromSeconds + window.arriveSeconds;
  const departStart = window.toSeconds - window.departSeconds;
  return {
    arriving:
      window.arriveSeconds > 0 && at < arriveEnd
        ? 1 - (at - window.fromSeconds) / window.arriveSeconds
        : 0,
    leaving:
      window.departSeconds > 0 && at > departStart
        ? (at - departStart) / window.departSeconds
        : 0,
  };
}

/**
 * What the outgoing side of each mechanism does.
 *
 * `leaving` runs 0 to 1 across the overlap. Every one of these is a real exit
 * — the material goes somewhere — rather than a fade, because a fade is a
 * dissolve and a dissolve is a cut somebody softened.
 */
function departing(kind: Handover, leaving: number): React.CSSProperties {
  const t = EASINGS.in_cubic(leaving);
  switch (kind) {
    case 'scale_through':
      // The frame keeps pushing until this beat is past the lens.
      return { transform: `scale(${1 + t * 0.9})`, opacity: 1 - t * t, filter: `blur(${t * 9}px)` };
    case 'camera_carry':
      // Carried out of frame by the move the camera is already making.
      return { transform: `translateX(${-t * 34}%) scale(${1 - t * 0.06})`, opacity: 1 - t * 0.85 };
    case 'morph':
      return { transform: `scale(${1 - t * 0.28})`, opacity: 1 - t, filter: `blur(${t * 6}px)` };
    case 'mask_reveal':
      // Uncovered rather than faded: the next beat is behind this one.
      return { clipPath: `inset(0 0 ${t * 100}% 0)` };
    case 'field_change':
      /*
       * The field is handled at film level and keeps going; what leaves here
       * is only what was standing on it. Nothing scales, because the anchor
       * has to stay put while the world turns over underneath it.
       */
      return { opacity: 1 - t };
    case 'object_handoff':
      // Everything but the anchor clears. The anchor is drawn above this.
      return { transform: `translateY(${-t * 12}%)`, opacity: 1 - Math.min(1, t * 1.4) };
    case 'cut':
      return {};
  }
}

/** And what the incoming side does. Always an ease-out: arrival settles. */
function arrivingStyle(kind: Handover, arriving: number): React.CSSProperties {
  const t = EASINGS.out_quint(1 - arriving);
  switch (kind) {
    case 'scale_through':
      return { transform: `scale(${0.82 + t * 0.18})`, opacity: t };
    case 'camera_carry':
      return { transform: `translateX(${(1 - t) * 26}%)`, opacity: t };
    case 'morph':
      return { transform: `scale(${1.1 - t * 0.1})`, opacity: t, filter: `blur(${(1 - t) * 7}px)` };
    case 'mask_reveal':
      return {};
    case 'field_change':
      return { opacity: t };
    case 'object_handoff':
      return { transform: `translateY(${(1 - t) * 9}%)`, opacity: t };
    case 'cut':
      return {};
  }
}

/**
 * One scene, wrapped in whatever its joins are doing to it.
 *
 * A scene can be arriving through one mechanism and leaving through another,
 * which is why both are read independently rather than as one "transition
 * state". The two never overlap in practice — an overlap is capped at 45% of
 * either scene — but nothing here assumes that.
 */
export const Joined: React.FC<{
  window: SceneWindow;
  incoming: HandoverPlan | null;
  outgoing: HandoverPlan | null;
  children: React.ReactNode;
}> = ({ window: w, incoming, outgoing, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = phaseOf(w, fps, frame);

  const style: React.CSSProperties = {
    ...(phase.arriving > 0 && incoming ? arrivingStyle(incoming.kind, phase.arriving) : {}),
    ...(phase.leaving > 0 && outgoing ? departing(outgoing.kind, phase.leaving) : {}),
  };
  return (
    <div style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%', ...style }}>
      {children}
    </div>
  );
};

/**
 * The field, which belongs to the film rather than to any beat.
 *
 * Lifted out of the scenes so it can change UNDER them. A colour that belongs
 * to a scene can only change when the scene does, which forces a cut; a
 * colour that belongs to the film can turn over across four seconds while an
 * anchor stands still on top of it, and that is the whole of reference D's
 * chapter mechanism and half of reference C's pivot.
 */
export const Field: React.FC<{
  stops: readonly { atSeconds: number; colour: string; overSeconds: number }[];
  fallback: string;
}> = ({ stops, fallback }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = frame / fps;
  let colour = stops[0]?.colour ?? fallback;
  for (const stop of stops) {
    if (at >= stop.atSeconds + stop.overSeconds) {
      colour = stop.colour;
    } else if (at > stop.atSeconds) {
      const t = interpolate(at, [stop.atSeconds, stop.atSeconds + stop.overSeconds], [0, 1], {
        easing: EASINGS.in_out_quart,
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      colour = mix(colour, stop.colour, t);
      break;
    }
  }
  return <div style={{ position: 'absolute', inset: 0, backgroundColor: colour }} />;
};

/** Linear blend in sRGB. Close enough for two colours from one brand's ramp. */
function mix(from: string, to: string, t: number): string {
  const a = rgb(from);
  const b = rgb(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const channel = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function rgb(value: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = /rgba?\(([^)]+)\)/i.exec(value);
  if (!fn) return null;
  const parts = fn[1]!.split(',').map((part) => Number(part.trim()));
  return parts.length >= 3 ? [parts[0]!, parts[1]!, parts[2]!] : null;
}
