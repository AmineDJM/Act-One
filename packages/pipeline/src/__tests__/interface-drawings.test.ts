import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { pythonBinary } from '@act-one/film-ir';
import { LocalFsStorageProvider, ScriptedLlmProvider, type StorageProvider } from '@act-one/providers';
import { INTERFACE_DRAWING_VERSION } from '@act-one/research';
import type { StageContext } from '../context.ts';
import { readInterfaces } from '../stages/interface-drawings.ts';

/**
 * The captures a launch film draws back up, read once and held to their pixels.
 *
 * A real local store; a scripted model; and, where the analyzer's OCR model
 * is installed, the real OCR over a capture whose words are known.
 */
const ORG = 'org_test';

function board(specs: { type: Scene['visualType']; seconds: number; asset: string }[]): Storyboard {
  const scenes = specs.map((spec, index) => ({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: 0, duration: spec.seconds, purpose: 'the product',
    narration: '', onScreenText: [], visualType: spec.type, assetRefs: [spec.asset], momentIds: [],
    motionRecipe: { name: 'product_zoom', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'none', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'linear' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
  })) as unknown as Scene[];
  return resequence({ id: 'sbd_1', projectId: 'prj_1', scenes, handovers: {} } as unknown as Storyboard);
}

/** A small interface: a sidebar with two rows and a search field, in a typeface the OCR model reads well. */
async function capture(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520">
    <rect width="900" height="520" fill="#ffffff"/><rect width="200" height="520" fill="#f2f3f5"/>
    <text x="24" y="80" font-family="DejaVu Sans" font-size="26" fill="#1b1f24">Inbox</text>
    <text x="24" y="130" font-family="DejaVu Sans" font-size="26" fill="#1b1f24">Archive</text>
    <rect x="260" y="20" width="420" height="50" rx="25" fill="#f6f7f9" stroke="#c9ccd1"/>
    <text x="290" y="54" font-family="DejaVu Sans" font-size="24" fill="#5c6473">Search invoices</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

const READING = {
  background: '#ffffff',
  theme: 'light',
  nodes: [
    { id: 'win', parent: null, kind: 'window', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#ffffff', radius: 'none', text: null, ink: null, strong: false },
    { id: 'side', parent: 'win', kind: 'sidebar', rect: { x: 0, y: 0, w: 0.22, h: 1 }, fill: '#f2f3f5', radius: 'none', text: null, ink: null, strong: false },
    { id: 'r1', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.1, w: 0.2, h: 0.08 }, fill: null, radius: 'sm', text: 'Inbox', ink: '#1b1f24', strong: true },
    // The model misread this row: the capture says "Archive".
    { id: 'r2', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.2, w: 0.2, h: 0.08 }, fill: null, radius: 'sm', text: 'Settings', ink: '#1b1f24', strong: false },
    { id: 'search', parent: 'win', kind: 'input', rect: { x: 0.29, y: 0.04, w: 0.47, h: 0.1 }, fill: '#f6f7f9', radius: 'pill', text: 'Search invoices', ink: '#5c6473', strong: false },
  ],
  focus: { nodeId: 'search', action: 'click', typed: null },
};

async function setup(): Promise<{ storage: StorageProvider; context: StageContext; workDir: string; bytes: Uint8Array }> {
  const storage = new LocalFsStorageProvider({ root: await mkdtemp(path.join(tmpdir(), 'act-one-drawings-store-')) });
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-drawings-work-'));
  const bytes = await capture();
  for (const id of ['ast_a', 'ast_b', 'ast_c']) await storage.put(`org/${ORG}/${id}.png`, bytes);
  const context = {
    organizationId: ORG,
    project: { id: 'prj_1' },
    registry: { storage: () => storage },
    store: {
      assets: {
        getMany: async (_org: string, ids: string[]) => ids.map((id) => ({ id, storageKey: `org/${ORG}/${id}.png`, contentType: 'image/png' })),
      },
    },
  } as unknown as StageContext;
  return { storage, context, workDir, bytes };
}

const keyFor = (bytes: Uint8Array) => `org/${ORG}/interface-drawings/v${INTERFACE_DRAWING_VERSION}/${createHash('sha256').update(bytes).digest('hex')}.json`;

const ocrInstalled = (() => {
  try {
    execFileSync(pythonBinary(), ['-c', 'import rapidocr_onnxruntime, cv2'], { stdio: 'ignore', timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
})();

describe('reading captures for the launch look', () => {
  const film = board([
    { type: 'product_ui', seconds: 2.6, asset: 'ast_a' },
    // Too short to be drawn before it is shown.
    { type: 'product_ui', seconds: 1.8, asset: 'ast_b' },
    { type: 'product_ui', seconds: 3, asset: 'ast_c' },
  ]);

  it('serves a capture read before from storage, and asks nothing', async () => {
    const { storage, context, workDir, bytes } = await setup();
    await storage.put(keyFor(bytes), new TextEncoder().encode(JSON.stringify({ drawing: READING, confirmed: 2, withdrawn: 1 })));
    const llm = new ScriptedLlmProvider([]);
    const read = await readInterfaces(context, film, { scenes: 2, budgetUsd: 0.05, llm, workDir });
    expect([...read.drawings.keys()]).toEqual(['ast_a', 'ast_c']);
    expect(llm.calls).toHaveLength(0);
    expect(read.costUsd).toBe(0);
  });

  it('stops at the film’s budget, and without a model shows the captures as captured', async () => {
    const { context, workDir } = await setup();
    const spent = await readInterfaces(context, film, { scenes: 2, budgetUsd: 0.005, llm: new ScriptedLlmProvider([]), workDir });
    expect(spent.drawings.size).toBe(0);
    expect(spent.notes.join(' ')).toMatch(/budget for reading captures is spent/);
    const none = await readInterfaces(context, film, { scenes: 2, budgetUsd: 0.05, llm: null, workDir });
    expect(none.notes.join(' ')).toMatch(/no model/);
  });

  it.skipIf(!ocrInstalled)('keeps the words the capture shows, withdraws the one it does not, and reads a picture once', async () => {
    const { storage, context, workDir, bytes } = await setup();
    const llm = new ScriptedLlmProvider([{ respond: READING }]);
    const read = await readInterfaces(context, board([{ type: 'product_ui', seconds: 3, asset: 'ast_a' }]), { scenes: 1, budgetUsd: 0.05, llm, workDir });
    const drawing = read.drawings.get('ast_a')!;
    const texts = Object.fromEntries(drawing.nodes.map((node) => [node.id, node.text]));
    expect(texts).toMatchObject({ r1: 'Inbox', r2: null, search: 'Search invoices' });
    expect(llm.calls).toHaveLength(1);
    expect(await storage.exists(keyFor(bytes))).toBe(true);
    // The same pixels under another asset: served from the reading already kept.
    const again = await readInterfaces(context, board([{ type: 'product_ui', seconds: 3, asset: 'ast_c' }]), { scenes: 1, budgetUsd: 0.05, llm, workDir });
    expect(again.drawings.get('ast_c')).toEqual(drawing);
    expect(llm.calls).toHaveLength(1);
  }, 120_000);
});
