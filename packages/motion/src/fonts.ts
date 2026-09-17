/**
 * Fonts.
 *
 * Self-hosted, bundled into the render, never fetched at render time. Three
 * reasons, in order of how badly each bites:
 *
 *  1. A render host without network access silently falls back to a system
 *     face. The film still renders, so nothing fails — it just looks wrong,
 *     which is the worst kind of defect because it ships.
 *  2. Our line-breaking metrics are calibrated against these exact families.
 *     A fallback face breaks differently, so text that was measured to fit
 *     overflows.
 *  3. Webfont latency inside a headless browser produces the classic flash of
 *     unstyled text — which, at 30fps, means the first few frames of a scene
 *     are set in the wrong typeface.
 *
 * These imports are side-effectful: they inject @font-face rules and are
 * bundled by webpack alongside the woff2 files.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';

/**
 * Families available to the design engine's `renderFamily` substitution.
 * Anything not in this list will fall back, so the brand extractor must only
 * ever substitute into these.
 */
export const BUNDLED_FAMILIES = [
  'Inter',
  'JetBrains Mono',
  'Space Grotesk',
  'Source Serif 4',
] as const;

export type BundledFamily = (typeof BUNDLED_FAMILIES)[number];

export function isBundled(family: string): family is BundledFamily {
  return (BUNDLED_FAMILIES as readonly string[]).includes(family);
}

/**
 * Blocks the first frame until faces are ready.
 *
 * Remotion renders frame 0 as soon as the component mounts. Without this, a
 * film's opening frames can be set in the fallback face even when the fonts
 * are bundled.
 */
export async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await document.fonts.ready;
}
