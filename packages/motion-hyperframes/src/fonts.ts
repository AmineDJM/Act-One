import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Fonts, exactly as the Remotion engine bundles them.
 *
 * The same four families at the same weights, from the same @fontsource
 * packages, so the design engine's line-breaking metrics hold in both engines
 * and a headline measured to fit two lines still fits two lines. Copied into
 * the render project and declared with `font-display: block`, because the
 * render must never fetch a face or draw a frame in a fallback one.
 *
 * Kept in step with packages/motion/src/fonts.ts by a test that reads its
 * imports: a family added there and not here would render in a fallback face
 * with nothing failing.
 */
export const BUNDLED_FONTS = [
  { family: 'Inter', packageName: '@fontsource/inter', weights: [400, 500, 600, 700] },
  { family: 'JetBrains Mono', packageName: '@fontsource/jetbrains-mono', weights: [400, 500] },
  { family: 'Space Grotesk', packageName: '@fontsource/space-grotesk', weights: [500, 700] },
  { family: 'Source Serif 4', packageName: '@fontsource/source-serif-4', weights: [400, 600] },
] as const;

export const BUNDLED_FAMILIES: readonly string[] = BUNDLED_FONTS.map((font) => font.family);

export type FontBundle = {
  /** `@font-face` rules pointing at `fonts/<file>`, relative to the project root. */
  css: string;
  /** File names written under `fonts/`. */
  files: string[];
};

const require = createRequire(import.meta.url);

/** Copies every face into `<projectDir>/fonts` and returns the rules that declare them. */
export async function bundleFonts(projectDir: string): Promise<FontBundle> {
  const fontsDir = path.join(projectDir, 'fonts');
  await mkdir(fontsDir, { recursive: true });

  const rules: string[] = [];
  const files = new Set<string>();
  for (const font of BUNDLED_FONTS) {
    for (const weight of font.weights) {
      const cssPath = require.resolve(`${font.packageName}/${weight}.css`);
      const css = await readFile(cssPath, 'utf8');
      for (const face of parseFontFaces(css)) {
        const source = path.join(path.dirname(cssPath), 'files', face.file);
        await copyFile(source, path.join(fontsDir, face.file));
        files.add(face.file);
        rules.push(
          [
            '@font-face {',
            `  font-family: "${face.family}";`,
            `  font-style: ${face.style};`,
            `  font-weight: ${face.weight};`,
            '  font-display: block;',
            `  src: url(fonts/${face.file}) format("woff2");`,
            ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
            '}',
          ].join('\n'),
        );
      }
    }
  }
  return { css: rules.join('\n'), files: [...files].sort() };
}

type FontFace = { family: string; style: string; weight: string; file: string; unicodeRange: string | null };

/**
 * The faces in one @fontsource stylesheet, keeping only the woff2 source.
 *
 * Parsed rather than copied through, because the rules point at `./files/`
 * relative to the package and every one of them has to point at the project's
 * own copy instead.
 */
export function parseFontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1] ?? '';
    const family = /font-family:\s*['"]?([^;'"]+)['"]?\s*;/.exec(body)?.[1]?.trim();
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal';
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim();
    const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(body)?.[1]?.trim();
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
    if (!family || !weight || !file) continue;
    // The file name is written into a stylesheet and a path; nothing but a plain name is accepted.
    if (!/^[a-z0-9-]+\.woff2$/i.test(file)) continue;
    faces.push({ family, style, weight, file, unicodeRange });
  }
  return faces;
}
