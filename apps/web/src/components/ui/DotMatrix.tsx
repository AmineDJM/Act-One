/**
 * The dot matrix.
 *
 * A field of dots whose size follows a shape — a wave, a radial bloom, a
 * quiet drift — drawn once as SVG on the server. It is the product's
 * recurring signature: a project's cover, an empty state, the corner of a
 * panel while something is being made. Seeded, so a project's cover is its
 * own and stays the same on every visit; subtle, so it never competes with
 * the content in front of it.
 */
export type DotMatrixShape = 'wave' | 'radial' | 'drift' | 'orbit';

export function DotMatrix({
  seed = 'act-one',
  shape = 'wave',
  width = 320,
  height = 200,
  cell = 14,
  color = 'var(--accent-text)',
  opacity = 0.55,
  className,
}: {
  seed?: string;
  shape?: DotMatrixShape;
  width?: number;
  height?: number;
  /** Grid pitch in SVG units. */
  cell?: number;
  color?: string;
  opacity?: number;
  className?: string;
}) {
  const random = mulberry(hash(seed));
  // Each seed picks its own centre and phase, so no two covers are the same field.
  const cx = 0.25 + random() * 0.5;
  const cy = 0.3 + random() * 0.4;
  const phase = random() * Math.PI * 2;
  const frequency = 1.6 + random() * 1.4;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const dots: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns;
      const y = (row + 0.5) / rows;
      const size = sizeFor(shape, x, y, { cx, cy, phase, frequency });
      if (size <= 0.04) continue;
      const r = Math.max(0.35, Math.min(cell * 0.42, size * cell * 0.46));
      dots.push(
        `<circle cx="${((column + 0.5) * cell).toFixed(1)}" cy="${((row + 0.5) * cell).toFixed(1)}" r="${r.toFixed(2)}" fill-opacity="${(0.25 + size * 0.75).toFixed(2)}"/>`,
      );
    }
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      style={{ color, opacity, display: 'block' }}
      dangerouslySetInnerHTML={{ __html: `<g fill="currentColor">${dots.join('')}</g>` }}
    />
  );
}

function sizeFor(
  shape: DotMatrixShape,
  x: number,
  y: number,
  p: { cx: number; cy: number; phase: number; frequency: number },
): number {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  switch (shape) {
    case 'radial':
      return clamp(1 - distance * 1.9);
    case 'orbit': {
      const ring = Math.abs(distance - 0.32);
      return clamp(1 - ring * 6) * 0.9 + clamp(1 - distance * 4) * 0.4;
    }
    case 'drift':
      return clamp(0.15 + 0.85 * (0.5 + 0.5 * Math.sin(x * 4 + p.phase) * Math.cos(y * 3 - p.phase)) - y * 0.35);
    case 'wave':
    default: {
      const wave = 0.5 + 0.5 * Math.sin((x * p.frequency + y * 0.8) * Math.PI + p.phase);
      return clamp(wave * (1 - distance * 0.9) + 0.05);
    }
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hash(input: string): number {
  let h = 2166136261;
  for (const char of input) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
