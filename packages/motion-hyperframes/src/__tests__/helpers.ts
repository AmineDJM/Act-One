import {
  BrandSystem as BrandSystemSchema,
  Scene as SceneSchema,
  Storyboard as StoryboardSchema,
  type BrandSystem,
  type HandoverPlan,
  type MotionRecipeName,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { neutralRamp, resolveTokens, type DesignTokens } from '@act-one/design';
import type { StagedAsset } from '../assets.ts';
import type { SceneTokens } from '../author.ts';
import { authoringCanvas } from '../canvas.ts';
import { buildPackets } from '../packets.ts';
import { filmTokens } from '../tokens.ts';
import type { ScenePacket } from '../types.ts';

/** A fictional brand, dark, as the reference films use. */
export const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_test', organizationId: 'org_test', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#3d7bfd', secondaryColor: '#9ab8ff', accentColors: [], primaryCandidates: ['#3d7bfd'],
  neutrals: neutralRamp('#3d7bfd', 9, 0.05), canvasDark: '#07080d', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

export function design(): DesignTokens {
  return resolveTokens(brand, { aspect: '16:9', quality: 'hd', theme: 'dark' });
}

export function sceneTokens(): SceneTokens {
  const tokens = design();
  return { film: filmTokens(tokens), design: tokens };
}

export type SceneSpec = {
  recipe?: MotionRecipeName;
  text?: string[];
  duration?: number;
  assets?: string[];
  visualType?: Scene['visualType'];
  params?: Record<string, string | number | boolean>;
};

export function scene(index: number, spec: SceneSpec = {}): Scene {
  return SceneSchema.parse({
    id: `scn_${index}`, storyboardId: 'sbd_test', index,
    startTime: 0, duration: spec.duration ?? 3,
    purpose: `beat ${index + 1}`, visualType: spec.visualType ?? 'kinetic_typography',
    motionRecipe: { name: spec.recipe ?? 'word_reveal', params: spec.params ?? {} }, cameraRecipe: {},
    onScreenText: spec.text ?? ['Forty unmatched rows.'], narration: 'A line the voice reads.',
    assetRefs: spec.assets ?? [], generativeNeeds: [], status: 'ready', notes: '',
  });
}

/** Scenes laid end to end, as `resequence` would lay them. */
export function storyboard(scenes: Scene[], handovers: Record<string, HandoverPlan> = {}): Storyboard {
  let at = 0;
  const timed = scenes.map((candidate) => {
    const placed = { ...candidate, startTime: Number(at.toFixed(3)) };
    at += candidate.duration;
    return placed;
  });
  return StoryboardSchema.parse({
    id: 'sbd_test', projectId: 'prj_test', conceptId: 'cpt_test', treatmentId: 'trt_test',
    version: 1, handovers, language: 'en', scenes: timed,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

export function image(id: string, overrides: Partial<StagedAsset> = {}): StagedAsset {
  return { id, path: `assets/${id}.png`, kind: 'image', format: 'png', width: 1600, height: 1000, durationSeconds: null, bytes: 12_345, ...overrides };
}

export function clip(id: string, overrides: Partial<StagedAsset> = {}): StagedAsset {
  return { id, path: `assets/${id}.mp4`, kind: 'video', format: 'mp4', width: 1280, height: 720, durationSeconds: 5, bytes: 98_765, ...overrides };
}

export function packetsFor(
  board: Storyboard,
  options: { staged?: StagedAsset[]; logo?: StagedAsset | null; cta?: string; tagline?: string } = {},
): ScenePacket[] {
  return buildPackets({
    storyboard: board,
    brandName: brand.name,
    canvas: authoringCanvas('16:9'),
    staged: new Map((options.staged ?? []).map((asset) => [asset.id, asset])),
    logo: options.logo ?? null,
    cta: options.cta ?? 'northwind.example',
    tagline: options.tagline ?? 'Close the books while you sleep.',
    design: design(),
  });
}

/** One packet, for the scene at `index` of a one- or many-scene board. */
export function packet(spec: SceneSpec = {}, options: Parameters<typeof packetsFor>[1] = {}): ScenePacket {
  return packetsFor(storyboard([scene(0, spec)]), options)[0]!;
}
