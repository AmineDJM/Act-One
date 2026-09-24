import type { EasingName } from '@act-one/core';

/**
 * Act One's easing curves, in the browser.
 *
 * The Remotion engine evaluates every curve per frame from the definitions in
 * packages/motion/src/easing.ts. A scene written for HyperFrames names the
 * same curves — `ActOne.ease('out_quint')` — and gets the same numbers, so a
 * word that settled on a long quintic tail in one engine settles on the same
 * tail in the other. GSAP accepts a plain function as an ease, which is what
 * these are: no plugin, nothing fetched, deterministic under seek.
 *
 * The parameters live here once; a test evaluates this script and compares it
 * with the Remotion engine's functions at many points.
 */
type Curve =
  | { kind: 'linear' }
  | { kind: 'bezier'; points: [number, number, number, number] }
  | { kind: 'spring'; stiffness: number; damping: number; mass: number };

export const EASING_CURVES: Record<EasingName, Curve> = {
  linear: { kind: 'linear' },
  out_quint: { kind: 'bezier', points: [0.22, 1, 0.36, 1] },
  in_out_quart: { kind: 'bezier', points: [0.77, 0, 0.175, 1] },
  out_expo: { kind: 'bezier', points: [0.16, 1, 0.3, 1] },
  spring_soft: { kind: 'spring', stiffness: 90, damping: 17, mass: 1 },
  spring_tight: { kind: 'spring', stiffness: 220, damping: 26, mass: 1 },
  anticipate: { kind: 'bezier', points: [0.68, -0.35, 0.265, 1] },
  in_cubic: { kind: 'bezier', points: [0.55, 0.055, 0.675, 0.19] },
  in_quint: { kind: 'bezier', points: [0.64, 0, 0.78, 0] },
};

/** The source of `vendor/act-one-motion.js`, loaded before every scene's own script. */
export function motionRuntimeSource(): string {
  const table = Object.entries(EASING_CURVES)
    .map(([name, curve]) => {
      switch (curve.kind) {
        case 'linear':
          return `    ${name}: function (t) { return t <= 0 ? 0 : t >= 1 ? 1 : t; }`;
        case 'bezier':
          return `    ${name}: cubicBezier(${curve.points.join(', ')})`;
        case 'spring':
          return `    ${name}: spring(${curve.stiffness}, ${curve.damping}, ${curve.mass})`;
      }
    })
    .join(',\n');

  return `/* Act One motion runtime: the engine's easing curves, for GSAP. Generated; do not edit. */
(function () {
  'use strict';
  function cubicBezier(x1, y1, x2, y2) {
    var ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
    var ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
    function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
    function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
    function derivativeX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 6; i += 1) {
        var dx = sampleX(t) - x;
        if (Math.abs(dx) < 1e-6) break;
        var d = derivativeX(t);
        if (Math.abs(d) < 1e-6) break;
        t -= dx / d;
      }
      return sampleY(t);
    };
  }
  function spring(stiffness, damping, mass) {
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var omega = Math.sqrt(stiffness / mass);
      var zeta = damping / (2 * Math.sqrt(stiffness * mass));
      var time = t * 4;
      if (zeta < 1) {
        var omegaD = omega * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * omega * time) * (Math.cos(omegaD * time) + ((zeta * omega) / omegaD) * Math.sin(omegaD * time));
      }
      return 1 - Math.exp(-omega * time) * (1 + omega * time);
    };
  }
  var EASES = {
${table}
  };
  function ease(name) {
    return Object.prototype.hasOwnProperty.call(EASES, name) ? EASES[name] : EASES.out_quint;
  }
  window.ActOne = Object.freeze({ ease: ease, names: Object.freeze(Object.keys(EASES)) });
})();
`;
}
