import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REAL_PRODUCT_VISUAL_TYPES, UiDrawing, type Storyboard } from '@act-one/core';
import { readTextInImage } from '@act-one/film-ir';
import type { LlmProvider } from '@act-one/providers';
import { INTERFACE_DRAWING_VERSION, readInterfaceDrawing } from '@act-one/research';
import type { StageContext } from '../context.ts';

/**
 * The captures the launch look draws back up, read.
 *
 * The first product beats long enough to be drawn (the film's introduction to
 * the product, where building the interface teaches what it is), one reading
 * per distinct capture, kept in storage under the capture's hash so the same
 * picture is never paid for twice — by this film's next render, its cuts, or
 * another film of the same product. A reading is one cheap model call that
 * is then held to an OCR model's reading of the same pixels; the calls a film
 * makes stop at its budget, and a capture that is not read is shown as it is.
 */
export type InterfaceDrawings = {
  drawings: Map<string, UiDrawing>;
  costUsd: number;
  notes: string[];
};

/** The shortest beat that is drawn before it is shown; the launch look holds the same line. */
export const DRAWN_BEAT_MIN_SECONDS = 2.2;
/** What one reading is expected to cost before any has been paid for: a fast-tier call with one image. */
const READING_ESTIMATE_USD = 0.01;
const READABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

type Kept = { drawing: UiDrawing | null; confirmed: number; withdrawn: number };

export async function readInterfaces(
  context: StageContext,
  storyboard: Storyboard,
  options: { scenes: number; budgetUsd: number; llm: LlmProvider | null; workDir: string },
): Promise<InterfaceDrawings> {
  const result: InterfaceDrawings = { drawings: new Map(), costUsd: 0, notes: [] };
  if (options.scenes <= 0) return result;

  const firstPictures = storyboard.scenes
    .filter((scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.duration >= DRAWN_BEAT_MIN_SECONDS)
    .map((scene) => scene.assetRefs[0])
    .filter((id): id is string => typeof id === 'string');
  const wanted = [...new Set(firstPictures)].slice(0, options.scenes);
  if (wanted.length === 0) return result;

  const assets = await context.store.assets.getMany(context.organizationId, wanted);
  const storage = context.registry.storage();
  let calls = 0;
  for (const asset of assets) {
    if (!READABLE.has(asset.contentType)) continue;
    let bytes: Uint8Array;
    try {
      bytes = await storage.get(asset.storageKey);
    } catch {
      continue;
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `org/${context.organizationId}/interface-drawings/v${INTERFACE_DRAWING_VERSION}/${hash}.json`;

    const kept = await storage
      .get(key)
      .then((stored) => parseKept(new TextDecoder().decode(stored)))
      .catch(() => null);
    if (kept) {
      if (kept.drawing) result.drawings.set(asset.id, kept.drawing);
      continue;
    }

    if (!options.llm) {
      result.notes.push('no model to read captures with; they are shown as captured');
      break;
    }
    const expected = calls > 0 ? result.costUsd / calls : READING_ESTIMATE_USD;
    if (result.costUsd + expected > options.budgetUsd + 1e-9) {
      result.notes.push(`the film's budget for reading captures is spent ($${result.costUsd.toFixed(3)} of $${options.budgetUsd.toFixed(2)})`);
      break;
    }

    const file = path.join(options.workDir, `interface-${hash.slice(0, 16)}.png`);
    try {
      await writeFile(file, bytes);
      // The pixels' words first: without them nothing a model proposes can be checked, so nothing is asked.
      const ocr = await readTextInImage(file, context.signal ? { signal: context.signal } : {});
      const reading = await readInterfaceDrawing(options.llm, bytes, ocr, {
        tier: 'fast',
        call: { organizationId: context.organizationId, projectId: context.project.id, ...(context.signal ? { signal: context.signal } : {}) },
      });
      calls += 1;
      result.costUsd += reading?.costUsd ?? READING_ESTIMATE_USD;
      const record: Kept = reading ? { drawing: reading.drawing, confirmed: reading.confirmed, withdrawn: reading.withdrawn } : { drawing: null, confirmed: 0, withdrawn: 0 };
      // An unusable reading is kept too: asking again about the same pixels would get the same answer and the same bill.
      await storage.put(key, new TextEncoder().encode(JSON.stringify(record)), { contentType: 'application/json' }).catch(() => undefined);
      if (record.drawing) {
        result.drawings.set(asset.id, record.drawing);
        result.notes.push(`${asset.id}: drawn from ${record.drawing.nodes.length} parts, ${record.confirmed} words found in the capture, ${record.withdrawn} withdrawn`);
      } else {
        result.notes.push(`${asset.id}: the reading did not hold up against the capture; shown as captured`);
      }
    } catch (error) {
      if (context.signal?.aborted) throw error;
      result.notes.push(`${asset.id}: not read (${(error as Error).message.slice(0, 160)}); shown as captured`);
    } finally {
      await rm(file, { force: true }).catch(() => undefined);
    }
  }
  return result;
}

function parseKept(text: string): Kept | null {
  try {
    const value = JSON.parse(text) as { drawing?: unknown; confirmed?: unknown; withdrawn?: unknown };
    if (value.drawing === null) return { drawing: null, confirmed: 0, withdrawn: 0 };
    const drawing = UiDrawing.safeParse(value.drawing);
    if (!drawing.success) return null;
    return { drawing: drawing.data, confirmed: Number(value.confirmed) || 0, withdrawn: Number(value.withdrawn) || 0 };
  } catch {
    return null;
  }
}
