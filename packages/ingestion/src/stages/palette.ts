import { buildPalette } from '../palette/build-palette.ts';
import { probePalette } from '../probes/palette-probe.ts';
import type { Palette } from '../schema.ts';
import type { StageContext } from './context.ts';

export async function extractPalette(context: StageContext): Promise<Palette | null> {
  const raw = await context.deadline.within(
    context.page.evaluate(probePalette, { maxElements: 8_000, maxTokens: 600 }),
    20_000,
    'palette',
  );
  const built = buildPalette(raw);
  if (!built) return null;
  context.warnings.push(...built.warnings);
  return built.palette;
}
