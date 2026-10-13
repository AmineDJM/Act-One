import { describe, expect, it } from 'vitest';
import { checkDrawingText, sameWords, UiDrawing, type OcrLine } from '../index.ts';

/**
 * A redrawn interface says only what its capture says.
 *
 * The capture is 1000 × 600; the OCR lines are where a reader of those pixels
 * found words. The reading proposes words for its parts; only the ones found
 * at the same place survive.
 */
const SIZE = { width: 1000, height: 600 };
const line = (text: string, x0: number, y0: number, x1: number, y1: number, score = 0.95): OcrLine => ({ text, box: { x0, y0, x1, y1 }, score });

function drawing(): UiDrawing {
  return UiDrawing.parse({
    background: '#ffffff',
    theme: 'light',
    nodes: [
      { id: 'win', parent: null, kind: 'window', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#ffffff', radius: 'md', text: null, ink: null, strong: false },
      { id: 'side', parent: 'win', kind: 'sidebar', rect: { x: 0, y: 0, w: 0.2, h: 1 }, fill: '#f2f3f5', radius: 'none', text: null, ink: null, strong: false },
      { id: 'r1', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.1, w: 0.18, h: 0.05 }, fill: null, radius: 'sm', text: 'Inbox', ink: '#1b1f24', strong: true },
      // Proposed, but the capture says "Archive" here: withdrawn.
      { id: 'r2', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.16, w: 0.18, h: 0.05 }, fill: null, radius: 'sm', text: 'Settings', ink: '#1b1f24', strong: false },
      // Read a little loosely by the model, and with a different case: kept.
      { id: 'search', parent: 'win', kind: 'input', rect: { x: 0.3, y: 0.02, w: 0.4, h: 0.06 }, fill: '#f6f7f9', radius: 'pill', text: 'search invoices', ink: '#5c6473', strong: false },
    ],
    focus: { nodeId: 'search', action: 'type', typed: 'March' },
  });
}

describe('a redrawn interface’s words', () => {
  const ocr = [line('Inbox', 14, 62, 70, 86), line('Archive', 14, 98, 84, 122), line('Search invoices…', 310, 14, 520, 44)];

  it('are the ones the capture shows where the reading put them, and no others', () => {
    const checked = checkDrawingText(drawing(), ocr, SIZE);
    const texts = Object.fromEntries(checked.drawing.nodes.map((node) => [node.id, node.text]));
    expect(texts).toMatchObject({ r1: 'Inbox', r2: null, search: 'search invoices' });
    expect({ confirmed: checked.confirmed, withdrawn: checked.withdrawn }).toEqual({ confirmed: 2, withdrawn: 1 });
  });

  it('never borrow a word from elsewhere in the capture', () => {
    // "Inbox" exists, but at the far right of the capture, not in the row.
    const checked = checkDrawingText(drawing(), [line('Inbox', 900, 500, 960, 520)], SIZE);
    expect(checked.drawing.nodes.find((node) => node.id === 'r1')!.text).toBeNull();
  });

  it('do not trust an OCR line read with little confidence', () => {
    const checked = checkDrawingText(drawing(), [line('Inbox', 14, 62, 70, 86, 0.3)], SIZE);
    expect(checked.confirmed).toBe(0);
  });

  it('type only what the field already holds', () => {
    expect(checkDrawingText(drawing(), ocr, SIZE).drawing.focus).toEqual({ nodeId: 'search', action: 'type', typed: null });
    const holding = [...ocr, line('March', 320, 14, 380, 44)];
    expect(checkDrawingText(drawing(), holding, SIZE).drawing.focus?.typed).toBe('March');
  });

  it('match by letters and digits, forgiving a slip but not a different word', () => {
    expect(sameWords('Recent files', 'Recent fles')).toBe(true);
    expect(sameWords('Q3 revenue', 'Q3 Revenue:')).toBe(true);
    expect(sameWords('Settings', 'Archive')).toBe(false);
    expect(sameWords('', 'Archive')).toBe(false);
  });

  it('are refused when a part lies outside the capture', () => {
    const outside = { ...drawing(), nodes: [{ ...drawing().nodes[0]!, rect: { x: 0.8, y: 0, w: 0.4, h: 1 } }] };
    expect(UiDrawing.safeParse(outside).success).toBe(false);
  });
});
