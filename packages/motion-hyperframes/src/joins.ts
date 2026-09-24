import type { Handover } from '@act-one/core';
import type { ScenePacket } from './types.ts';

/**
 * The joins between scenes, as tweens on the film's own timeline.
 *
 * A join belongs to the pair of scenes, not to either, which is why no scene
 * writes one: the agent composes what stands in a beat, and the film moves the
 * whole beat in and out. The numbers are the Remotion engine's, from
 * packages/motion/src/handover.tsx, property for property — an arrival settles
 * on `out_quint`, a departure accelerates away on `in_cubic`, and where that
 * file shapes one property differently (the opacity of a scale-through falls
 * with the square of the curve) the tween's ease is composed the same way.
 */
type TweenSpec = {
  from: Record<string, string | number>;
  to: Record<string, string | number>;
  /** An expression for the ease, over `inCubic` or `outQuint`. */
  ease: string;
};

const IN_CUBIC = 'inCubic';
const OUT_QUINT = 'outQuint';

function departure(kind: Handover): TweenSpec[] {
  switch (kind) {
    case 'scale_through':
      return [
        { from: { scale: 1 }, to: { scale: 1.9 }, ease: IN_CUBIC },
        // opacity = 1 − t²: the frame keeps pushing until the beat is past the lens.
        { from: { opacity: 1 }, to: { opacity: 0 }, ease: `function (l) { var t = ${IN_CUBIC}(l); return t * t; }` },
        { from: { filter: 'blur(0px)' }, to: { filter: 'blur(9px)' }, ease: IN_CUBIC },
      ];
    case 'camera_carry':
      return [{ from: { xPercent: 0, scale: 1, opacity: 1 }, to: { xPercent: -34, scale: 0.94, opacity: 0.15 }, ease: IN_CUBIC }];
    case 'morph':
      return [{ from: { scale: 1, opacity: 1, filter: 'blur(0px)' }, to: { scale: 0.72, opacity: 0, filter: 'blur(6px)' }, ease: IN_CUBIC }];
    case 'mask_reveal':
      return [{ from: { clipPath: 'inset(0% 0% 0% 0%)' }, to: { clipPath: 'inset(0% 0% 100% 0%)' }, ease: IN_CUBIC }];
    case 'field_change':
      return [{ from: { opacity: 1 }, to: { opacity: 0 }, ease: IN_CUBIC }];
    case 'object_handoff':
      return [
        { from: { yPercent: 0 }, to: { yPercent: -12 }, ease: IN_CUBIC },
        // opacity = 1 − min(1, 1.4t): everything but the anchor clears early.
        { from: { opacity: 1 }, to: { opacity: 0 }, ease: `function (l) { return Math.min(1, ${IN_CUBIC}(l) * 1.4); }` },
      ];
    case 'cut':
      return [];
  }
}

function arrival(kind: Handover): TweenSpec[] {
  switch (kind) {
    case 'scale_through':
      return [{ from: { scale: 0.82, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: OUT_QUINT }];
    case 'camera_carry':
      return [{ from: { xPercent: 26, opacity: 0 }, to: { xPercent: 0, opacity: 1 }, ease: OUT_QUINT }];
    case 'morph':
      return [{ from: { scale: 1.1, opacity: 0, filter: 'blur(7px)' }, to: { scale: 1, opacity: 1, filter: 'blur(0px)' }, ease: OUT_QUINT }];
    case 'field_change':
      return [{ from: { opacity: 0 }, to: { opacity: 1 }, ease: OUT_QUINT }];
    case 'object_handoff':
      return [{ from: { yPercent: 9, opacity: 0 }, to: { yPercent: 0, opacity: 1 }, ease: OUT_QUINT }];
    case 'mask_reveal':
    case 'cut':
      return [];
  }
}

export type HostTiming = { hostId: string; fromSeconds: number; toSeconds: number };

/**
 * The statements that add every join to the film timeline `tl`.
 *
 * Arrivals render their first state immediately, because a scene that arrives
 * through a join must be mounted already transformed; departures do not, so
 * they never overwrite the arrival that precedes them on the same element.
 */
export function joinStatements(packets: readonly ScenePacket[], hosts: ReadonlyMap<string, HostTiming>): string[] {
  const lines = [
    `var ${IN_CUBIC} = ActOne.ease("in_cubic");`,
    `var ${OUT_QUINT} = ActOne.ease("out_quint");`,
  ];
  for (const packet of packets) {
    const host = hosts.get(packet.frameId);
    if (!host) throw new Error(`No host for ${packet.frameId}.`);
    const selector = JSON.stringify(`#${host.hostId}`);
    if (packet.timing.arrives) {
      for (const spec of arrival(packet.timing.arrives.through)) {
        lines.push(tween(selector, spec, packet.timing.arrives.seconds, host.fromSeconds, true));
      }
    }
    if (packet.timing.leaves) {
      const at = host.toSeconds - packet.timing.leaves.seconds;
      for (const spec of departure(packet.timing.leaves.through)) {
        lines.push(tween(selector, spec, packet.timing.leaves.seconds, at, false));
      }
    }
  }
  return lines;
}

function tween(selector: string, spec: TweenSpec, duration: number, at: number, immediate: boolean): string {
  const to = { ...spec.to };
  return `tl.fromTo(${selector}, ${JSON.stringify(spec.from)}, Object.assign(${JSON.stringify(to)}, { duration: ${round(duration)}, ease: ${spec.ease}, immediateRender: ${immediate} }), ${round(at)});`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
