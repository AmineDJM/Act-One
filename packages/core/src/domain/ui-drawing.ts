import { z } from 'zod';

/**
 * An interface, redrawn.
 *
 * A capture shown whole is a slide about a product. Drawn back up from its
 * parts — the window, then the sidebar, the rows, the control that matters —
 * with a cursor that goes to that control and uses it, the same interface
 * reads as a product being used. The drawing is a reading of one capture:
 * where its parts are, as fractions of the capture, in its own colours, with
 * the words it shows.
 *
 * The words are the product's or they are nothing. Every text a reading
 * proposes is checked against what an OCR model reads at the same place in
 * the same pixels; a word that is not there is drawn as a neutral line, the
 * way a wireframe draws text, never as a word the product did not show. And
 * the scene that draws it ends on the real capture.
 */
export const UI_DRAWING_KINDS = [
  'window', 'sidebar', 'toolbar', 'panel', 'card', 'list', 'row', 'button', 'input', 'text', 'icon', 'avatar', 'toggle', 'chart', 'image',
] as const;
export const UiDrawingKind = z.enum(UI_DRAWING_KINDS);
export type UiDrawingKind = z.infer<typeof UiDrawingKind>;

const fraction = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const UiDrawingRect = z
  .object({ x: fraction, y: fraction, w: fraction, h: fraction })
  .refine((rect) => rect.w > 0 && rect.h > 0 && rect.x + rect.w <= 1.0001 && rect.y + rect.h <= 1.0001, { message: 'A part lies inside the capture.' });
export type UiDrawingRect = z.infer<typeof UiDrawingRect>;

export const UiDrawingNode = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  /** The part it sits in; null for a top-level part. */
  parent: z.string().nullable(),
  kind: UiDrawingKind,
  rect: UiDrawingRect,
  /** Its own fill, when it has one the eye reads as a surface; null when it is drawn by its parent's. */
  fill: hex.nullable(),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'pill']),
  /** The words it shows, as the capture shows them. Null for a part without words. */
  text: z.string().max(80).nullable(),
  /** Text colour, when it has text. */
  ink: hex.nullable(),
  /** Whether the words are set heavier than their neighbours: a title, a selected row. */
  strong: z.boolean(),
});
export type UiDrawingNode = z.infer<typeof UiDrawingNode>;

export const UiDrawing = z.object({
  /** The capture's own background. */
  background: hex,
  theme: z.enum(['light', 'dark']),
  /** Outermost first: a part is listed after the part it sits in. */
  nodes: z.array(UiDrawingNode).min(1).max(80),
  /** The control a person would use next, and how. Null when nothing invites a hand. */
  focus: z
    .object({
      nodeId: z.string(),
      action: z.enum(['click', 'type']),
      /** For `type`: words the capture already shows in that field, typed in. */
      typed: z.string().max(60).nullable(),
    })
    .nullable(),
});
export type UiDrawing = z.infer<typeof UiDrawing>;

/** A line of text an OCR model read, in capture pixels. */
export type OcrLine = { text: string; box: { x0: number; y0: number; x1: number; y1: number }; score: number };

export type DrawingCheck = {
  drawing: UiDrawing;
  /** Words the reading proposed that the capture shows where it said. */
  confirmed: number;
  /** Words it proposed that are not there: drawn as neutral lines. */
  withdrawn: number;
};

/** Below this, an OCR line is noise rather than words. */
const OCR_MIN_SCORE = 0.5;
/** How alike the proposed words and the read ones must be. */
const SAME_WORDS = 0.8;

/**
 * The drawing with only the words the capture shows.
 *
 * A proposed text survives when an OCR line that overlaps its part — grown by
 * a quarter, since a reading places a part a little loosely — says the same,
 * by edit distance over the letters and digits, or contains it; what does
 * not becomes null. The typed words of the
 * focus are held to the same rule, and a focus on a part that is not in the
 * drawing is dropped.
 */
export function checkDrawingText(drawing: UiDrawing, lines: readonly OcrLine[], size: { width: number; height: number }): DrawingCheck {
  const read = lines.filter((line) => line.score >= OCR_MIN_SCORE && line.text.trim().length > 0);
  let confirmed = 0;
  let withdrawn = 0;
  const nodes = drawing.nodes.map((node) => {
    if (node.text === null || node.text.trim().length === 0) return { ...node, text: null };
    const box = grown(node.rect, size, 0.25);
    const match = read.find((line) => overlaps(box, line.box) && sameWords(node.text!, line.text));
    if (!match) {
      withdrawn += 1;
      return { ...node, text: null };
    }
    confirmed += 1;
    return node;
  });
  const ids = new Set(nodes.map((node) => node.id));
  let focus = drawing.focus && ids.has(drawing.focus.nodeId) ? drawing.focus : null;
  if (focus?.typed) {
    const field = nodes.find((node) => node.id === focus!.nodeId)!;
    const box = grown(field.rect, size, 0.25);
    if (!read.some((line) => overlaps(box, line.box) && sameWords(focus!.typed!, line.text))) focus = { ...focus, typed: null };
  }
  return { drawing: { ...drawing, nodes, focus }, confirmed, withdrawn };
}

function grown(rect: UiDrawingRect, size: { width: number; height: number }, by: number): OcrLine['box'] {
  const dx = rect.w * size.width * by;
  const dy = rect.h * size.height * by;
  return {
    x0: rect.x * size.width - dx,
    y0: rect.y * size.height - dy,
    x1: (rect.x + rect.w) * size.width + dx,
    y1: (rect.y + rect.h) * size.height + dy,
  };
}

function overlaps(a: OcrLine['box'], b: OcrLine['box']): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

const letters = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/** Whether two strings say the same words: near in edit distance over their letters, or one inside the other. */
export function sameWords(proposed: string, read: string): boolean {
  const a = letters(proposed);
  const b = letters(read);
  if (a.length === 0 || b.length === 0) return false;
  if (b.includes(a) && a.length >= Math.min(3, b.length)) return true;
  const longest = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / longest >= SAME_WORDS;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}
