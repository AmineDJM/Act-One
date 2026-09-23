import { parseCssColor } from '@act-one/design';
import { captureElement } from '../capture/element-capture.ts';
import { COMPONENT_MARKER, probeComponents, type RawComponent } from '../probes/components-probe.ts';
import type { CapturedStyle, ComponentCapture } from '../schema.ts';
import { CAPTURE_PIXEL_BUDGET, type StageContext } from './context.ts';

/** Device pixels per CSS pixel, by what is being captured: small things get more. */
const SCALE: Record<RawComponent['kind'], number> = { hero: 2, card: 3, button: 4 };

export async function extractComponents(context: StageContext): Promise<ComponentCapture[]> {
  const { page, deadline, request } = context;
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const found = await deadline.within(page.evaluate(probeComponents, request.captures), 15_000, 'components');

  const captures: ComponentCapture[] = [];
  for (const component of found) {
    const outcome = await captureElement(
      page,
      context.cdp,
      {
        selector: `[${COMPONENT_MARKER}="${component.marker}"]`,
        transparent: true,
        scale: SCALE[component.kind],
        maxPixels: CAPTURE_PIXEL_BUDGET,
        maxHeight: component.kind === 'hero' ? Math.round(request.viewport.height * 1.25) : 1_200,
      },
      deadline,
    );
    if (!outcome.ok) {
      context.warnings.push(`The ${component.kind} "${component.label.slice(0, 40)}" was not captured: ${outcome.reason}.`);
      continue;
    }
    const { capture } = outcome;
    /*
     * A panel whose content is drawn by something the isolation had to hide —
     * a canvas laid over it, an animation still to start — comes back as a
     * frame around nothing. Kept, it would put an empty box in a film.
     */
    if (component.kind !== 'button' && capture.visibleCoverage < 0.12) {
      context.warnings.push(`The ${component.kind} "${component.label.slice(0, 40)}" came back nearly empty and was not kept.`);
      continue;
    }
    const asset = context.assets.add('capture-png', 'image/png', capture.png, {
      width: capture.pixelWidth,
      height: capture.pixelHeight,
    });
    if (!asset) {
      context.warnings.push(`The ${component.kind} capture was over the size budget.`);
      continue;
    }
    captures.push({
      assetId: asset.id,
      kind: component.kind,
      label: component.label.slice(0, 200),
      rect: positive(capture.rect),
      clip: positive(capture.clip),
      scale: capture.scale,
      pixelWidth: capture.pixelWidth,
      pixelHeight: capture.pixelHeight,
      transparent: capture.transparent,
      opaqueCoverage: capture.opaqueCoverage,
      cropped: capture.cropped,
      style: capturedStyle(component.style),
      score: Math.round(component.score * 100) / 100,
      reasons: component.reasons.slice(0, 12),
    });
  }

  const viewport = await captureViewport(context);
  if (viewport) captures.push(viewport);
  return captures;
}

/**
 * The first screen, as a visitor sees it, opaque, at twice the density:
 * the plate a product window in the film is built from.
 */
async function captureViewport(context: StageContext): Promise<ComponentCapture | null> {
  const { page, cdp, deadline, request } = context;
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const { width, height } = request.viewport;
    const shot = await deadline.within(
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 2 },
        captureBeyondViewport: false,
        fromSurface: true,
      }),
      15_000,
      'viewport',
    );
    const png = Buffer.from(shot.data, 'base64');
    const asset = context.assets.add('capture-png', 'image/png', png, { width: width * 2, height: height * 2 });
    if (!asset) return null;
    return {
      assetId: asset.id,
      kind: 'viewport',
      label: (await page.title().catch(() => '')).slice(0, 200),
      rect: { x: 0, y: 0, width, height },
      clip: { x: 0, y: 0, width, height },
      scale: 2,
      pixelWidth: width * 2,
      pixelHeight: height * 2,
      transparent: false,
      opaqueCoverage: 1,
      cropped: false,
      style: null,
      score: 0,
      reasons: ['the first screen as a visitor sees it'],
    };
  } catch (error) {
    if (deadline.signal.aborted) throw error;
    context.warnings.push(`The first screen was not captured: ${(error as Error).message.slice(0, 160)}`);
    return null;
  }
}

function capturedStyle(raw: RawComponent['style']): CapturedStyle {
  const hex = (css: string): string | null => (css ? (parseCssColor(css)?.hex8 ?? null) : null);
  return {
    background: hex(raw.background),
    color: hex(raw.color),
    borderColor: hex(raw.borderColor),
    borderWidthPx: Math.max(0, raw.borderWidth),
    borderRadiusPx: Math.max(0, raw.borderRadius),
    boxShadow: raw.boxShadow ? raw.boxShadow.slice(0, 600) : null,
    fontFamily: raw.fontFamily.slice(0, 400),
    fontWeight: Math.min(1000, Math.max(1, Math.round(Number.parseFloat(raw.fontWeight) || 400))),
    fontSizePx: Math.max(0.1, Number.parseFloat(raw.fontSize) || 16),
    textTransform: raw.textTransform.slice(0, 20),
    paddingPx: raw.padding.map((value) => Math.max(0, value)) as [number, number, number, number],
  };
}

function positive(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x, y: rect.y, width: Math.max(0.01, rect.width), height: Math.max(0.01, rect.height) };
}
