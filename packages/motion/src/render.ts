import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import {
  DEFAULT_FPS,
  dimensionsFor,
  type AspectRatio,
  type BrandSystem,
  type RenderQuality,
  type SceneGraph,
} from '@act-one/core';
import {
  compositionId,
  filmDurationInFrames,
  sceneCompositionId,
  scenesDurationInFrames,
  type FilmProps,
} from './composition.ts';

/**
 * Server-side rendering.
 *
 * Bundling is slow and the result is identical for every film, so it is cached
 * for the life of the worker process. A render worker that re-bundles per job
 * spends more time on webpack than on frames.
 */
let bundlePromise: Promise<string> | null = null;

export async function bundleFilm(
  options: { entryPoint?: string; outDir?: string } = {},
): Promise<string> {
  if (bundlePromise) return bundlePromise;

  const entryPoint = options.entryPoint ?? fileURLToPath(new URL('./entry.tsx', import.meta.url));

  bundlePromise = bundle({
    entryPoint,
    onProgress: () => undefined,
    // Remotion's default webpack config handles TSX; we only need to make sure
    // the workspace packages resolve, which they do via node_modules symlinks.
    webpackOverride: (config) => config,
    ...(options.outDir ? { outDir: options.outDir } : {}),
  });

  return bundlePromise;
}

/**
 * Where to find a browser Remotion can drive.
 *
 * Remotion renders with Chrome's *old* headless mode, which recent Chrome
 * binaries no longer ship — a full `chrome` binary fails to launch outright.
 * `chrome-headless-shell` is the standalone implementation of that mode and is
 * what a render host should provide. Resolution order is explicit option, then
 * environment, then Remotion's own bundled download.
 */
export function resolveBrowserExecutable(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromEnv =
    process.env.ACT_ONE_CHROME_HEADLESS_SHELL ?? process.env.REMOTION_BROWSER_EXECUTABLE;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export type RenderFilmOptions = {
  props: FilmProps;
  aspect: AspectRatio;
  quality?: RenderQuality;
  fps?: number;
  outputPath: string;
  /** Concurrency; the worker sets this from its own CPU allowance. */
  concurrency?: number;
  /** Chromium executable, for environments with a preinstalled browser. */
  browserExecutable?: string;
  onProgress?: (progress: {
    renderedFrames: number;
    encodedFrames: number;
    progress: number;
  }) => void;
  signal?: AbortSignal;
  /** Frames-only mode: renders a single still for animatics and posters. */
  stillAtSeconds?: number;
};

export type RenderFilmResult = {
  outputPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  /**
   * Media the browser refused, by the url it was asked for.
   *
   * A picture Chromium cannot decode does not stop a render: the frame is
   * drawn without it, the encode finishes, and the only evidence is one line
   * in a tab log. A thirty-seven megapixel page capture failed exactly this
   * way, and the shot that was meant to show the customer's product came out
   * empty in a film that reported success.
   *
   * Reported here so the layer that knows which shots were REQUIRED to show
   * something can refuse the master. This one only knows what would not load.
   */
  undecodable: string[];
};

export async function renderFilm(options: RenderFilmOptions): Promise<RenderFilmResult> {
  const fps = options.fps ?? DEFAULT_FPS;
  const quality = options.quality ?? 'hd';
  const { width, height } = dimensionsFor(options.aspect, quality);

  const undecodable = new Set<string>();
  const serveUrl = await bundleFilm();
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const browserExecutable = resolveBrowserExecutable(options.browserExecutable);

  const composition = await selectComposition({
    serveUrl,
    id: compositionId(options.aspect),
    inputProps: options.props as unknown as Record<string, unknown>,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const resolved = {
    ...composition,
    width,
    height,
    fps,
    // The composition counts its frames at the default rate. A render asked
    // for at another rate keeps the film's length, not its frame count —
    // without this, 15 fps rendered every frame of a 30 fps count and the
    // film ran at half speed for twice as long.
    durationInFrames: filmDurationInFrames(options.props.storyboard, fps),
  };

  if (options.stillAtSeconds !== undefined) {
    await renderStill({
      composition: resolved,
      serveUrl,
      output: options.outputPath,
      inputProps: options.props as unknown as Record<string, unknown>,
      frame: Math.round(options.stillAtSeconds * fps),
      imageFormat: 'png',
      ...(browserExecutable ? { browserExecutable } : {}),
    });
    return {
      outputPath: options.outputPath,
      durationSeconds: 0,
      width,
      height,
      fps,
      undecodable: [],
    };
  }

  await renderMedia({
    composition: resolved,
    serveUrl,
    codec: 'h264',
    outputLocation: options.outputPath,
    inputProps: options.props as unknown as Record<string, unknown>,
    // CRF 18 is visually lossless for screen content at these bitrates, which
    // matters because UI captures show banding long before photographic footage.
    crf: quality === 'uhd' ? 16 : 18,
    /*
     * Explicit delivery colour, rather than whatever the browser happened to
     * hand the encoder.
     *
     * Left alone, these rendered as `yuvj420p` — deprecated full-range YUV. A
     * player that honours the range flag shows it correctly; one that does not
     * shows crushed blacks or grey ones, and a film that is almost entirely
     * near-black with white type is the worst possible case for getting that
     * wrong. Limited-range BT.709 is what HD delivery means everywhere else,
     * and what every platform re-encoding this file will assume.
     */
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    concurrency: options.concurrency ?? null,
    ...(browserExecutable ? { browserExecutable } : {}),
    onProgress: options.onProgress
      ? ({ renderedFrames, encodedFrames, progress }) =>
          options.onProgress!({ renderedFrames, encodedFrames, progress })
      : undefined,
    chromiumOptions: { gl: 'swangle' },
    onBrowserLog: ({ text }) => {
      const url = undecodableFrom(text);
      if (url) undecodable.add(url);
    },
  });

  return {
    outputPath: options.outputPath,
    durationSeconds: resolved.durationInFrames / fps,
    width,
    height,
    fps,
    undecodable: [...undecodable],
  };
}

/**
 * The url in a browser log line that means a picture would not load.
 *
 * Chromium says it several ways and none of them is structured, so this
 * matches the phrases rather than a shape. A line we do not recognise is not
 * a decode failure as far as this is concerned \u2014 better to miss one and have
 * the readiness pass catch an empty shot than to fail a master over a
 * warning about a font.
 */
export function undecodableFrom(text: string): string | null {
  if (
    !/EncodingError|cannot be decoded|Failed to load (?:resource|image)|ERR_FILE_NOT_FOUND/i.test(
      text,
    )
  ) {
    return null;
  }
  const url = /(https?:\/\/[^\s"']+|file:\/\/[^\s"']+)/.exec(text);
  // No url in the line still tells us something failed; name it so the count
  // is honest even when the address is not in the message.
  return url ? url[1]! : 'an image the film asked for';
}

/** Clears the cached bundle. Used when the worker reloads the motion package. */
export function resetBundle(): void {
  bundlePromise = null;
}

// ---------------------------------------------------------------------------

export type RenderScenesOptions = {
  scenes: readonly SceneGraph[];
  brand: BrandSystem;
  assetUrls?: Record<string, string>;
  aspect: AspectRatio;
  quality?: RenderQuality;
  fps?: number;
  outputPath: string;
  concurrency?: number;
  browserExecutable?: string;
  /** The canvas the director chose, rather than the one the brand defaults to. */
  theme?: 'dark' | 'light' | 'auto';
  onProgress?: (progress: {
    renderedFrames: number;
    encodedFrames: number;
    progress: number;
  }) => void;
};

/**
 * Renders a film composed of scene graphs.
 *
 * The same encoder settings and the same delivery colour as `renderFilm`,
 * because a film is a film however it was composed — a scene-graph master that
 * decoded differently from a storyboard master would be a second delivery
 * format nobody asked for. What differs is only which composition is selected
 * and what is handed to it.
 */
export async function renderScenes(options: RenderScenesOptions): Promise<RenderFilmResult> {
  const fps = options.fps ?? DEFAULT_FPS;
  const quality = options.quality ?? 'hd';
  const { width, height } = dimensionsFor(options.aspect, quality);

  const undecodable = new Set<string>();
  const serveUrl = await bundleFilm();
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const browserExecutable = resolveBrowserExecutable(options.browserExecutable);

  const inputProps = {
    scenes: options.scenes,
    brand: options.brand,
    assetUrls: options.assetUrls ?? {},
    ...(options.theme ? { theme: options.theme } : {}),
  } as unknown as Record<string, unknown>;

  const composition = await selectComposition({
    serveUrl,
    id: sceneCompositionId(options.aspect),
    inputProps,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const resolved = {
    ...composition,
    width,
    height,
    fps,
    durationInFrames: scenesDurationInFrames(options.scenes, fps),
  };

  await renderMedia({
    composition: resolved,
    serveUrl,
    codec: 'h264',
    outputLocation: options.outputPath,
    inputProps,
    crf: quality === 'uhd' ? 16 : 18,
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    concurrency: options.concurrency ?? null,
    ...(browserExecutable ? { browserExecutable } : {}),
    onProgress: options.onProgress
      ? ({ renderedFrames, encodedFrames, progress }) =>
          options.onProgress!({ renderedFrames, encodedFrames, progress })
      : undefined,
    chromiumOptions: { gl: 'swangle' },
    onBrowserLog: ({ text }) => {
      const url = undecodableFrom(text);
      if (url) undecodable.add(url);
    },
  });

  return {
    outputPath: options.outputPath,
    durationSeconds: resolved.durationInFrames / fps,
    width,
    height,
    fps,
    undecodable: [...undecodable],
  };
}
