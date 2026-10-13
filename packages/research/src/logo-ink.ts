import sharp from 'sharp';
import type { BrandLogo, BrandSystem } from '@act-one/core';
import { readMark, showsAMark } from '@act-one/design';

/**
 * The brand's logos, without the ones that draw nothing.
 *
 * Inline marks arrive as data URLs and can be drawn here, at no cost and with
 * no request, so the brand that is stored — and every film made from it, on
 * either engine — never names an empty picture as its logo. A logo at an
 * address is drawn by the render, which checks it the same way before it
 * goes on screen.
 */
export async function keepDrawnLogos(brand: BrandSystem): Promise<BrandSystem> {
  const kept: BrandLogo[] = [];
  for (const logo of brand.logoVariants ?? []) {
    if (await drawsOrIsElsewhere(logo)) kept.push(logo);
  }
  const logo = brand.logo && (await drawsOrIsElsewhere(brand.logo)) ? brand.logo : (kept[0] ?? null);
  return { ...brand, logo, logoVariants: kept };
}

async function drawsOrIsElsewhere(logo: BrandLogo): Promise<boolean> {
  return !logo.url?.startsWith('data:') || dataUrlDrawsAMark(logo.url);
}

export async function dataUrlDrawsAMark(dataUrl: string): Promise<boolean> {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return false;
  try {
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const bytes = /;base64$/i.test(header) ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
    const { data, info } = await sharp(bytes, { limitInputPixels: 8_000 * 8_000, density: 96 })
      .resize(256, 256, { fit: 'inside' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return info.channels === 4 && showsAMark(readMark(data, info.width, info.height));
  } catch {
    return false;
  }
}
