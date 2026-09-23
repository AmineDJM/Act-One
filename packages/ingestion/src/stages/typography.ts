import { buildTypography, type PlatformFont } from '../fonts/build-typography.ts';
import { probeTypography, TYPE_MARKER, type RawTypeRole } from '../probes/typography-probe.ts';
import type { Typography } from '../schema.ts';
import type { StageContext } from './context.ts';

export async function extractTypography(context: StageContext): Promise<Typography | null> {
  const raw = await context.deadline.within(
    context.page.evaluate(probeTypography, { maxCandidates: 4_000, maxRules: 600 }),
    15_000,
    'typography',
  );
  const platformFonts = await readRenderedFonts(context, raw.samples.map((sample) => sample.role));
  // Font bodies still in flight are the ones this stage is about to need.
  await context.recorder.flush(8_000);
  const built = buildTypography({
    raw,
    platformFonts,
    stylesheets: context.recorder.byKind('stylesheet'),
    fonts: context.recorder.byKind('font'),
    documentUrl: context.pageUrl,
    assets: context.assets,
  });
  if (!built) return null;
  context.warnings.push(...built.warnings);
  return built.typography;
}

/**
 * Which font the renderer drew each sample with.
 *
 * The CSS stack says what the page asked for; this is what it got. A first
 * family that failed to load, a subset without a glyph, a system face standing
 * in for a web font — only the renderer knows, and the DevTools protocol lets
 * us ask it per element.
 */
async function readRenderedFonts(
  context: StageContext,
  roles: RawTypeRole[],
): Promise<Map<RawTypeRole, PlatformFont[]>> {
  const result = new Map<RawTypeRole, PlatformFont[]>();
  const { cdp, deadline } = context;
  try {
    await deadline.within(cdp.send('DOM.enable'), 5_000, 'typography:dom');
    await deadline.within(cdp.send('CSS.enable'), 10_000, 'typography:css');
    const { root } = await deadline.within(cdp.send('DOM.getDocument', { depth: 0 }), 5_000, 'typography:document');
    for (const role of roles) {
      const { nodeId } = await deadline.within(
        cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[${TYPE_MARKER}="${role}"]` }),
        5_000,
        'typography:query',
      );
      if (!nodeId) continue;
      let { fonts } = await deadline.within(
        cdp.send('CSS.getPlatformFontsForNode', { nodeId }),
        5_000,
        'typography:fonts',
      );
      if (fonts.length === 0) {
        // Content the browser skipped laying out (content-visibility, a
        // collapsed region) has drawn no glyphs yet; bring it into view once.
        await deadline.within(cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId }), 5_000, 'typography:scroll').catch(() => undefined);
        await context.page.waitForTimeout(150);
        ({ fonts } = await deadline.within(
          cdp.send('CSS.getPlatformFontsForNode', { nodeId }),
          5_000,
          'typography:fonts',
        ));
      }
      result.set(
        role,
        fonts.map((font) => ({
          familyName: font.familyName,
          postScriptName: font.postScriptName,
          isCustomFont: font.isCustomFont,
          glyphCount: font.glyphCount,
        })),
      );
    }
  } catch (error) {
    if (deadline.signal.aborted) throw error;
    context.warnings.push(`The renderer could not say which fonts it used: ${(error as Error).message.slice(0, 160)}`);
  } finally {
    await cdp.send('CSS.disable').catch(() => undefined);
    await cdp.send('DOM.disable').catch(() => undefined);
  }
  return result;
}
