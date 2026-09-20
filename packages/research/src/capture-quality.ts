import sharp from 'sharp';

/**
 * Whether a capture can carry a scene.
 *
 * Measured from the pixels, before anything is stored or shown to a model. Two
 * failures are cheap to detect and expensive to ship: a blank capture (a page
 * that had not painted, a wall the clean-capture CSS did not hide) and, for
 * imagery that is supposed to be the product, a photograph. Software is flat —
 * long runs of identical pixels, a few hundred distinct colours. A photograph
 * is neither, and a photograph staged as an interface is the one thing this
 * product promised never to do.
 */
export type CaptureAssessment = {
  width: number;
  height: number;
  /** Share of pixels in the single most common coarse colour. */
  dominantShare: number;
  /** Share of horizontally adjacent pixel pairs that are near-identical. */
  flatness: number;
  /** Distinct colours after quantising each channel to 5 bits. */
  distinctColours: number;
  verdict: 'filmable' | 'blank' | 'photograph' | 'too_small';
};

export type AssessOptions = {
  /** What the capture is supposed to be. A page may contain photography; an interface may not be one. */
  expect: 'interface' | 'page';
};

const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
const BLANK_DOMINANT_SHARE = 0.965;

export async function assessCapture(
  bytes: Uint8Array,
  options: AssessOptions = { expect: 'page' },
): Promise<CaptureAssessment> {
  const image = sharp(Buffer.from(bytes));
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Downscaled for speed: the statistics are about composition, and a 480px
  // wide thumbnail composes the same as the 3200px original.
  const { data, info } = await image
    .resize({ width: Math.min(480, Math.max(1, width)), withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stats = measure(data, info.width, info.height, info.channels);

  let verdict: CaptureAssessment['verdict'] = 'filmable';
  if (width < MIN_WIDTH || height < MIN_HEIGHT) verdict = 'too_small';
  else if (stats.dominantShare >= BLANK_DOMINANT_SHARE || stats.distinctColours <= 3) verdict = 'blank';
  else if (options.expect === 'interface' && looksPhotographic(stats)) verdict = 'photograph';

  return { width, height, ...stats, verdict };
}

/**
 * Photographs: little flatness and many colours. Interfaces are flat even when
 * they carry a gradient; a very smooth photograph can slip through, and a busy
 * interface with a large hero photograph inside it can be refused — both are
 * the safe direction, because the model check that follows sees the image.
 */
function looksPhotographic(stats: { flatness: number; distinctColours: number }): boolean {
  if (stats.flatness < 0.25) return true;
  return stats.flatness < 0.45 && stats.distinctColours > 2500;
}

export function measure(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Pick<CaptureAssessment, 'dominantShare' | 'flatness' | 'distinctColours'> {
  const histogram = new Map<number, number>();
  let flatPairs = 0;
  let pairs = 0;
  const total = width * height;
  if (total === 0) return { dominantShare: 1, flatness: 1, distinctColours: 0 };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const r = data[i]!;
      const g = data[i + 1] ?? r;
      const b = data[i + 2] ?? r;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      histogram.set(key, (histogram.get(key) ?? 0) + 1);

      if (x > 0) {
        const j = i - channels;
        const delta =
          Math.abs(r - data[j]!) + Math.abs(g - (data[j + 1] ?? r)) + Math.abs(b - (data[j + 2] ?? r));
        if (delta <= 6) flatPairs += 1;
        pairs += 1;
      }
    }
  }

  let dominant = 0;
  for (const count of histogram.values()) dominant = Math.max(dominant, count);

  return {
    dominantShare: dominant / total,
    flatness: pairs === 0 ? 1 : flatPairs / pairs,
    distinctColours: histogram.size,
  };
}

/**
 * A small JPEG for a vision call. The model reads composition, not pixels, and
 * a request carrying a 4K PNG is slow for nothing.
 */
/**
 * The largest picture a renderer will actually decode.
 *
 * A full-page capture of a long marketing site, taken at device scale on a
 * retina viewport, comes back 3200 by 11632 \u2014 thirty-seven megapixels, a
 * hundred and fifty megabytes once decoded. Chromium refuses it, the shot
 * that was meant to show the product renders empty, and the only trace is
 * one line in a browser console that nothing reads:
 *
 *   EncodingError: The source image cannot be decoded.
 *
 * Which is how a film with five shots of real material comes out looking
 * like a film with none. Nothing downstream needs more than a 4K frame, so
 * anything larger is brought down to fit before it is stored.
 */
const MAX_RENDERABLE_EDGE = 4096;
const MAX_RENDERABLE_PIXELS = 12_000_000;

export async function fitForRender(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; resized: boolean; width: number; height: number }> {
  const image = sharp(Buffer.from(bytes));
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) return { bytes, resized: false, width, height };

  const edge = Math.max(width, height);
  const scale = Math.min(
    edge > MAX_RENDERABLE_EDGE ? MAX_RENDERABLE_EDGE / edge : 1,
    width * height > MAX_RENDERABLE_PIXELS ? Math.sqrt(MAX_RENDERABLE_PIXELS / (width * height)) : 1,
  );
  if (scale >= 1) return { bytes, resized: false, width, height };

  const target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  const out = await image.resize(target).png({ compressionLevel: 9 }).toBuffer();
  return { bytes: new Uint8Array(out), resized: true, ...target };
}

export async function previewForModel(bytes: Uint8Array, maxWidth = 1024): Promise<string> {
  const jpeg = await sharp(Buffer.from(bytes))
    .resize({ width: maxWidth, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 78 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/**
 * The top of a tall capture, at a viewport's shape.
 *
 * The homepage is captured full-page for brand measurement. As a film shot
 * that is a scroll of footer; the fold is what a visitor sees, so the fold is
 * what the film shows. Captures already at or wider than the shape are
 * returned untouched.
 */
export async function cropToFold(
  bytes: Uint8Array,
  aspect = 1.6,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const image = sharp(Buffer.from(bytes));
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const foldHeight = Math.round(width / aspect);
  if (width === 0 || height <= foldHeight) return { bytes, width, height };
  const cropped = await image.extract({ left: 0, top: 0, width, height: foldHeight }).png().toBuffer();
  return { bytes: new Uint8Array(cropped), width, height: foldHeight };
}
