import { parseCssColor } from '@act-one/design';
import { unsafeRequestReason } from '../browser/request-guard.ts';
import { captureElement, visualSimilarity, type ElementCapture } from '../capture/element-capture.ts';
import { bakeSvg, LOGO_MARKER, probeLogo, type RawLogoCandidate } from '../probes/logo-probe.ts';
import type { Logo } from '../schema.ts';
import { sanitizeSvg, SvgRejected } from '../svg/sanitize-svg.ts';
import { CAPTURE_PIXEL_BUDGET, type StageContext } from './context.ts';

const MAX_SVG_TEXT = 1_000_000;
/** Below this the vector does not look like what the page drew, and the capture is the truer logo. */
export const FIDELITY_FLOOR = 0.9;

export type LogoResult = { logo: Logo | null; alternates: Logo[] };

export async function extractLogo(context: StageContext, siteName: string): Promise<LogoResult> {
  const { page, deadline } = context;
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const candidates = await deadline.within(page.evaluate(probeLogo, { siteName, maxCandidates: 6 }), 10_000, 'logo');

  const primary = candidates.find((candidate) => candidate.marker !== null && candidate.score >= 2) ?? null;
  const logo = primary ? await buildLogo(context, primary) : null;

  const alternates: Logo[] = [];
  for (const candidate of candidates) {
    // An alternate is another rendition of the brand's own mark (the favicon,
    // a footer lockup), so it needs real evidence of being the brand's.
    if (alternates.length >= 2 || candidate === primary) continue;
    if (candidate.kind !== 'favicon-svg' && candidate.score < 3) continue;
    // A second copy of the same mark (a sticky header, a mobile menu) is not an alternate.
    if (primary && candidate.kind === primary.kind && candidate.src && candidate.src === primary.src) continue;
    const built = await buildLogo(context, candidate);
    if (built) alternates.push(built);
  }
  if (!logo && candidates.length > 0) context.warnings.push('No candidate was convincing enough to be called the logo.');
  return { logo, alternates };
}

async function buildLogo(context: StageContext, candidate: RawLogoCandidate): Promise<Logo | null> {
  const { assets } = context;
  let raster: ElementCapture | null = null;
  if (candidate.marker) {
    const outcome = await captureElement(
      context.page,
      context.cdp,
      {
        selector: `[${LOGO_MARKER}="${candidate.marker}"]`,
        transparent: true,
        scale: 4,
        maxPixels: Math.min(CAPTURE_PIXEL_BUDGET, 6_000_000),
        maxHeight: 400,
      },
      context.deadline,
    );
    if (outcome.ok) raster = outcome.capture;
    else context.warnings.push(`The logo (${candidate.kind}) could not be captured: ${outcome.reason}.`);
  }

  const width = raster?.rect.width ?? candidate.rect?.width ?? 256;
  const height = raster?.rect.height ?? candidate.rect?.height ?? 256;
  let markup: string | null = null;
  let source: Logo['source'] = 'raster';

  if (candidate.kind === 'inline-svg' && candidate.marker) {
    const baked = await context.deadline.within(
      context.page.evaluate(bakeSvg, { mode: 'element' as const, marker: candidate.marker }),
      10_000,
      'logo:bake',
    );
    if ('markup' in baked) {
      markup = baked.markup;
      source = 'inline-svg';
    } else {
      context.warnings.push(`The inline logo could not be lifted: ${baked.error}.`);
    }
  } else if (
    candidate.src &&
    (candidate.kind === 'img-svg' || candidate.kind === 'favicon-svg' || (candidate.kind === 'css-background' && /\.svg(\?|#|$)|^data:image\/svg/i.test(candidate.src)))
  ) {
    const text = await svgText(context, candidate.src);
    if (text) {
      const baked = await context.deadline.within(
        context.page.evaluate(bakeSvg, {
          mode: 'markup' as const,
          markup: text,
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        }),
        10_000,
        'logo:bake',
      );
      if ('markup' in baked) {
        markup = baked.markup;
        source = candidate.kind === 'favicon-svg' ? 'favicon-svg' : 'svg-file';
      } else {
        context.warnings.push(`The logo file could not be read as svg: ${baked.error}.`);
      }
    }
  }

  let svgAssetId: string | null = null;
  let fidelity: number | null = null;
  if (markup) {
    try {
      const clean = sanitizeSvg(markup);
      if (clean.removed.length > 0) {
        context.logger.log('debug', 'svg_sanitised', { removed: clean.removed.slice(0, 10).join('; ') });
      }
      const stored = assets.add('logo-svg', 'image/svg+xml', Buffer.from(clean.svg, 'utf8'), {
        width: clean.width ?? width,
        height: clean.height ?? height,
      });
      svgAssetId = stored?.id ?? null;
      if (stored && raster) fidelity = await vectorFidelity(context, clean.svg, raster);
    } catch (error) {
      context.warnings.push(
        `The logo svg was refused: ${error instanceof SvgRejected ? error.message : (error as Error).message}`.slice(0, 300),
      );
    }
  }

  const png = raster ? assets.add('logo-png', 'image/png', raster.png, { width: raster.pixelWidth, height: raster.pixelHeight }) : null;
  if (!svgAssetId && !png) return null;
  if (fidelity !== null && fidelity < FIDELITY_FLOOR) {
    context.warnings.push(
      `The vector logo reproduces the page at ${Math.round(fidelity * 100)}%; the capture is the reliable version.`,
    );
  }

  return {
    source: svgAssetId ? source : 'raster',
    svgAssetId,
    pngAssetId: png?.id ?? null,
    cssWidth: Math.max(1, Math.round(width * 100) / 100),
    cssHeight: Math.max(1, Math.round(height * 100) / 100),
    backdrop: candidate.backdrop ? (parseCssColor(candidate.backdrop)?.hex8 ?? null) : null,
    vectorFidelity: fidelity === null ? null : Math.round(fidelity * 1000) / 1000,
    confidence: Math.max(0, Math.min(1, Math.round((candidate.score / 12) * 100) / 100)),
    reasons: candidate.reasons.slice(0, 12),
    label: candidate.label.slice(0, 200),
  };
}

/**
 * The text of an svg the page referenced: from the recorder when the browser
 * already fetched it, otherwise fetched once from inside the page, within the
 * same request guard and the same origin rules a visitor's browser applies.
 */
async function svgText(context: StageContext, src: string): Promise<string | null> {
  if (src.startsWith('data:')) return decodeSvgDataUrl(src);
  if (unsafeRequestReason(src)) {
    context.warnings.push('The logo points somewhere we do not fetch from.');
    return null;
  }
  const recorded = context.recorder.byUrl(src);
  if (recorded) return recorded.body.byteLength <= MAX_SVG_TEXT ? recorded.body.toString('utf8') : null;
  try {
    return await context.deadline.within(
      context.page.evaluate(
        async ({ url, limit }) => {
          const response = await fetch(url, { credentials: 'omit', redirect: 'follow' });
          if (!response.ok) return null;
          const text = await response.text();
          return text.length <= limit ? text : null;
        },
        { url: src, limit: MAX_SVG_TEXT },
      ),
      10_000,
      'logo:fetch',
    );
  } catch {
    context.warnings.push('The logo file could not be fetched from the page.');
    return null;
  }
}

function decodeSvgDataUrl(url: string): string | null {
  const match = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/is.exec(url);
  if (!match) return null;
  try {
    const text = /;base64/i.test(match[1] ?? '')
      ? Buffer.from(match[2] ?? '', 'base64').toString('utf8')
      : decodeURIComponent(match[2] ?? '');
    return text.length <= MAX_SVG_TEXT ? text : null;
  } catch {
    return null;
  }
}

/**
 * Draws the kept vector where the page drew the logo's size, captures it the
 * same way, and compares. A vector that lost a gradient, a clip path or a web
 * font in the lifting is caught here instead of in a film.
 */
async function vectorFidelity(context: StageContext, svg: string, reference: ElementCapture): Promise<number | null> {
  const { page } = context;
  const width = Math.max(1, Math.round(reference.rect.width));
  const height = Math.max(1, Math.round(reference.rect.height));
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  try {
    const mounted = await context.deadline.within(
      page.evaluate(
        ({ source, w, h }) =>
          new Promise<boolean>((resolve) => {
            document.getElementById('actone-svg-proof-holder')?.remove();
            const holder = document.createElement('div');
            holder.id = 'actone-svg-proof-holder';
            holder.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;background:transparent;margin:0;padding:0;';
            const image = new Image(w, h);
            image.id = 'actone-svg-proof';
            image.style.cssText = `display:block;width:${w}px;height:${h}px;`;
            image.addEventListener('load', () => resolve(true), { once: true });
            image.addEventListener('error', () => resolve(false), { once: true });
            image.src = source;
            holder.appendChild(image);
            document.body.appendChild(holder);
          }),
        { source: dataUrl, w: width, h: height },
      ),
      8_000,
      'logo:proof',
    );
    if (!mounted) {
      context.warnings.push('The vector logo could not be drawn back for comparison.');
      return null;
    }
    const outcome = await captureElement(
      page,
      context.cdp,
      { selector: '#actone-svg-proof', transparent: true, scale: reference.scale, maxPixels: CAPTURE_PIXEL_BUDGET, maxHeight: 400 },
      context.deadline,
    );
    if (!outcome.ok) return null;
    return await visualSimilarity(reference.png, outcome.capture.png);
  } finally {
    await page.evaluate(() => document.getElementById('actone-svg-proof-holder')?.remove()).catch(() => undefined);
  }
}
