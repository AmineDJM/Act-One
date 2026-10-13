/**
 * Whether a picture shows a mark at all.
 *
 * A logo that reaches a film blank is worse than no logo: the end card holds
 * an empty disc where the brand should be, and nobody notices until the
 * customer does. A copied sprite icon with its symbol left behind, a
 * transparent placeholder and a flat rectangle all decode as valid pictures;
 * what they lack is ink. Read from the decoded pixels — straight RGBA, as
 * sharp's raw output gives them — so it holds for any format.
 */
export type MarkReading = {
  /** Share of pixels with real coverage (alpha above 1/16). */
  coverage: number;
  /** Largest channel spread among the covered pixels, 0–255. */
  spread: number;
  /** Whether the coverage has a shape: some pixels covered and some not. */
  shaped: boolean;
};

export function readMark(rgba: Uint8Array, width: number, height: number): MarkReading {
  const pixels = width * height;
  if (pixels <= 0 || rgba.length < pixels * 4) return { coverage: 0, spread: 0, shaped: false };
  let covered = 0;
  const low = [255, 255, 255];
  const high = [0, 0, 0];
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3]! <= 16) continue;
    covered += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = rgba[offset + channel]!;
      if (value < low[channel]!) low[channel] = value;
      if (value > high[channel]!) high[channel] = value;
    }
  }
  const spread = covered === 0 ? 0 : Math.max(high[0]! - low[0]!, high[1]! - low[1]!, high[2]! - low[2]!);
  return { coverage: covered / pixels, spread, shaped: covered > 0 && covered < pixels };
}

/**
 * A mark is something drawn: at least half a percent of the picture covered,
 * and either a shape against transparency or more than one colour. A picture
 * covered edge to edge in a single flat colour is a swatch, not a logo.
 */
export function showsAMark(reading: MarkReading): boolean {
  if (reading.coverage < 0.005) return false;
  return reading.shaped || reading.spread >= 12;
}
