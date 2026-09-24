import type { MotionRecipeName, VisualType } from '@act-one/core';
import { stageProduct, type DesignTokens } from '@act-one/design';

/**
 * The studio's layout primitives, shared by every scene.
 *
 * The Remotion engine places type with one component, `Framed`, and its
 * lockups with two more; a scene written for HyperFrames places its type in
 * the same boxes by class instead of rebuilding them with its own flexbox —
 * which is where written scenes most often went wrong when they had to: a
 * column where a row was meant, two classes fighting over one element, a
 * block at the top of the safe area that the other engine centres. Declared
 * once, on the film's own page, so no scene can drift from them.
 */
export type Placement = 'center_left' | 'center' | 'lower_third' | 'end_card' | 'lockup';

export const PLACEMENT_CLASS: Record<Placement, string> = {
  center_left: 'ao-frame ao-frame--center-left',
  center: 'ao-frame ao-frame--center',
  lower_third: 'ao-frame ao-frame--lower-third',
  end_card: 'ao-frame ao-frame--end-card',
  lockup: 'ao-lockup',
};

/** The rules behind the classes, numbers from the design tokens the Remotion engine lays out with. */
export function studioCss(design: DesignTokens): string {
  const { safe } = design.grid;
  return [
    // Border-box, as every element on a Remotion render page is: the lower third's padding lifts its words inside the safe area.
    `.ao-frame { position: absolute; box-sizing: border-box; left: ${px(safe.x)}; top: ${px(safe.y)}; width: ${px(safe.width)}; height: ${px(safe.height)}; margin: 0; padding: 0; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }`,
    `.ao-frame--center { align-items: center; }`,
    `.ao-frame--lower-third { justify-content: flex-end; padding-bottom: ${px(safe.height * 0.08)}; }`,
    `.ao-frame--end-card { align-items: stretch; }`,
    `.ao-lockup { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }`,
  ].join('\n');
}

const PRODUCT_RECIPES: ReadonlySet<MotionRecipeName> = new Set<MotionRecipeName>([
  'product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'product_zoom',
  'spatial_cards', 'image_wall', 'cursor_sequence', 'depth_transition',
]);

export function isProductRecipe(recipe: MotionRecipeName): boolean {
  return PRODUCT_RECIPES.has(recipe);
}

/** Where a capture's surface stands, and how tall its window bar is (0 when it has none). */
export type ProductWindowBox = { x: number; y: number; width: number; height: number; barHeightPx: number };

/**
 * The Remotion `ProductWindow`'s box, computed the way it computes it.
 *
 * The capture at its recorded aspect (16:9 when none was recorded), inside
 * 86% of the safe area with a bar sized to 5.2% of the surface width, or 92%
 * with none for a bare frame or a 3D surface.
 */
export function productWindowBox(
  scene: { recipe: MotionRecipeName; visualType: VisualType; params: Record<string, string | number | boolean> },
  design: DesignTokens,
): ProductWindowBox {
  const chrome = scene.visualType !== 'product_ui_3d' && scene.params['frame'] !== 'bare';
  const recorded = Number(scene.params['aspect']);
  const aspect = Number.isFinite(recorded) && recorded > 0.5 && recorded < 3 ? recorded : 16 / 9;
  const chromeShare = chrome ? 0.052 : 0;
  const box = stageProduct(design.grid, aspect / (1 + chromeShare * aspect), { inset: chrome ? 0.86 : 0.92 });
  return { x: box.x, y: box.y, width: box.width, height: box.height, barHeightPx: chrome ? Math.round(box.width * chromeShare) : 0 };
}

function px(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}
