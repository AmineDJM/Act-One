import { createContext, useContext } from 'react';

/**
 * Where a scene's beat sits inside the time it is mounted, and how it leaves.
 *
 * A scene is mounted early when it arrives through a join and held late when
 * it leaves through one, and its components count time from the mount. Their
 * entrances belong to the mount — a scene that arrives through a join is
 * already composing itself as it comes in — but their exits belong to the
 * beat. A scene that leaves by a cut clears over its tail and is gone on the
 * frame its beat ends; one that leaves through a join is carried out whole by
 * the join, so it does not clear at all. Timed from the mount instead, an
 * arriving scene emptied the frame early by the length of its join, and a
 * leaving one had faded before the join could move it.
 */
export type SceneClock = {
  /** Seconds from the mount to the beat's first frame. */
  beatStartSeconds: number;
  beatSeconds: number;
  /** How long the scene is mounted: its beat, and any time joins hold it before and after. */
  mountedSeconds: number;
  /** False when a join carries the scene out. */
  leavesByCut: boolean;
};

const SceneClockContext = createContext<SceneClock | null>(null);

export const SceneClockProvider = SceneClockContext.Provider;

/** The clock of the scene being drawn; null for a component drawn outside a film. */
export function useSceneClock(): SceneClock | null {
  return useContext(SceneClockContext);
}

/**
 * The same clock seen from inside a nested sequence that starts `offsetSeconds`
 * after the mount: the part of a shot that holds to the scene's end.
 */
export function clockFrom(clock: SceneClock, offsetSeconds: number): SceneClock {
  return {
    beatStartSeconds: clock.beatStartSeconds - offsetSeconds,
    beatSeconds: clock.beatSeconds,
    mountedSeconds: Math.max(0, clock.mountedSeconds - offsetSeconds),
    leavesByCut: clock.leavesByCut,
  };
}
