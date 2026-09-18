import 'server-only';
import { z } from 'zod';
import {
  AppError,
  BRAND_COMPONENTS,
  BrandComponentKey,
  CornerStyle,
  Iconography,
  ImageTreatment,
  ImageryStyle,
  LayoutDensity,
  MotionStyle,
  VisualStyle,
  applyBrandSignal,
  can,
  componentOfField,
  fontFor,
  pendingBrandSignals,
  type BrandSignal,
  type BrandSystem,
  type Project,
} from '@act-one/core';
import type { Session } from './auth.ts';
import { getStore } from './store.ts';

/**
 * The brand, as a person reads, edits and confirms it.
 *
 * Every brand belongs to a project. This module answers the Brand page:
 * which projects have DNA and in what state, the DNA of the one being
 * looked at as eight components, and the readings waiting for a decision.
 * An edit marks its component as a person's; a confirmation records who
 * and when; a signal is accepted or dismissed, never applied on its own.
 */
export type BrandStatus = 'NOT MEASURED' | 'MEASURED' | 'NEEDS REVIEW' | 'CONFIRMED';

export type BrandProjectRow = {
  id: string;
  name: string;
  host: string;
  brandId: string | null;
  status: BrandStatus;
  tone: 'quiet' | 'active' | 'ready' | 'attention';
  pending: number;
};

export type BrandComponentView = {
  key: BrandComponentKey;
  label: string;
  /** Measured by us; edited by a person; or confirmed as part of the whole. */
  state: 'measured' | 'edited' | 'confirmed';
  summary: string;
  pending: number;
};

export type BrandOverview = {
  projects: BrandProjectRow[];
  selected: {
    project: Project;
    brand: BrandSystem;
    components: BrandComponentView[];
    signals: BrandSignal[];
    inheritedFrom: { name: string; projectName: string | null } | null;
  } | null;
};

export function brandStatusOf(brand: BrandSystem | null): { status: BrandStatus; tone: BrandProjectRow['tone']; pending: number } {
  if (!brand) return { status: 'NOT MEASURED', tone: 'quiet', pending: 0 };
  const pending = pendingBrandSignals(brand).length;
  if (pending > 0) return { status: 'NEEDS REVIEW', tone: 'attention', pending };
  if (brand.confirmedByUser) return { status: 'CONFIRMED', tone: 'ready', pending: 0 };
  return { status: 'MEASURED', tone: 'active', pending: 0 };
}

export async function loadBrandOverview(session: Session, projectId: string | null): Promise<BrandOverview> {
  const store = getStore();
  const [projects, brands] = await Promise.all([store.projects.list(session.organizationId), store.brands.list(session.organizationId)]);
  const byId = new Map(brands.map((brand) => [brand.id, brand] as const));

  const rows: BrandProjectRow[] = projects.map((project) => {
    const brand = project.brandId ? (byId.get(project.brandId) ?? null) : null;
    const { status, tone, pending } = brandStatusOf(brand);
    return { id: project.id, name: project.name, host: hostOf(project.websiteUrl), brandId: brand?.id ?? null, status, tone, pending };
  });

  // The project asked for, else the one that needs a person most, else the newest with DNA.
  const wanted = projectId ? rows.find((row) => row.id === projectId) : null;
  const chosen =
    wanted ??
    rows.find((row) => row.status === 'NEEDS REVIEW') ??
    rows.find((row) => row.status === 'MEASURED') ??
    rows.find((row) => row.brandId !== null) ??
    null;
  const project = chosen ? (projects.find((candidate) => candidate.id === chosen.id) ?? null) : null;
  const brand = project?.brandId ? (byId.get(project.brandId) ?? null) : null;
  if (!project || !brand) return { projects: rows, selected: null };

  const parent = brand.parentBrandId ? (byId.get(brand.parentBrandId) ?? null) : null;
  const parentProject = parent?.projectId ? (projects.find((candidate) => candidate.id === parent.projectId) ?? null) : null;

  return {
    projects: rows,
    selected: {
      project,
      brand,
      components: componentsOf(brand),
      signals: pendingBrandSignals(brand),
      inheritedFrom: parent ? { name: parent.name, projectName: parentProject?.name ?? null } : null,
    },
  };
}

export function componentsOf(brand: BrandSystem): BrandComponentView[] {
  const pendingByComponent = new Map<BrandComponentKey, number>();
  for (const signal of pendingBrandSignals(brand)) {
    const key = componentOfField(signal.field);
    pendingByComponent.set(key, (pendingByComponent.get(key) ?? 0) + 1);
  }
  return BRAND_COMPONENTS.map((component) => ({
    key: component.key,
    label: component.label,
    state: brand.overrides.includes(component.key) ? 'edited' : brand.confirmedByUser ? 'confirmed' : 'measured',
    summary: summaryOf(brand, component.key),
    pending: pendingByComponent.get(component.key) ?? 0,
  }));
}

function summaryOf(brand: BrandSystem, key: BrandComponentKey): string {
  switch (key) {
    case 'logo':
      return [brand.logo ? `${brand.logo.format.toUpperCase()} mark` : 'no mark found', brand.faviconUrl ? 'favicon' : null].filter(Boolean).join(' · ');
    case 'colors':
      return [brand.primaryColor, brand.secondaryColor, ...brand.accentColors.slice(0, 2)].join(' · ');
    case 'typography':
      return `${fontFor(brand, 'display').family} / ${fontFor(brand, 'body').family}`;
    case 'layout':
      return `${brand.layoutDensity} · ${brand.cornerRadiusPx}px ${brand.cornerStyle} · ${brand.visualStyle}`;
    case 'iconography':
      return brand.iconography === 'none' ? 'not established' : brand.iconography;
    case 'imagery':
      return [brand.imageryStyle === 'none' ? 'not established' : brand.imageryStyle.replace('_', ' '), brand.imageTreatment !== 'none' ? brand.imageTreatment.replace('_', ' ') : null].filter(Boolean).join(' · ');
    case 'communication':
      return brand.communication.tagline || brand.communication.positioning || brand.tone;
    case 'motion':
      return brand.motionPersonality || brand.motionStyle;
  }
}

// --- editing ------------------------------------------------------------------

const list = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is six hex digits, like #5b6cff.');

/** What a person may set on each component. Everything else stays as measured. */
export const BrandComponentPatch = z.discriminatedUnion('component', [
  z.object({ component: z.literal('logo'), logoUrl: z.string().url().nullable().optional(), faviconUrl: z.string().url().nullable().optional() }),
  z.object({
    component: z.literal('colors'),
    primaryColor: hex.optional(),
    secondaryColor: hex.optional(),
    accentColors: z.array(hex).max(6).optional(),
    allowsGradient: z.boolean().optional(),
    allowsGlow: z.boolean().optional(),
  }),
  z.object({
    component: z.literal('typography'),
    display: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(120).optional(),
    mono: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    component: z.literal('layout'),
    layoutDensity: LayoutDensity.optional(),
    cornerStyle: CornerStyle.optional(),
    cornerRadiusPx: z.number().min(0).max(64).optional(),
    visualStyle: VisualStyle.optional(),
  }),
  z.object({ component: z.literal('iconography'), iconography: Iconography }),
  z.object({
    component: z.literal('imagery'),
    imageryStyle: ImageryStyle.optional(),
    imageTreatment: ImageTreatment.optional(),
    imagerySubjects: list(12).optional(),
  }),
  z.object({
    component: z.literal('communication'),
    language: z.string().trim().max(12).optional(),
    tone: z.string().trim().min(1).max(240).optional(),
    vocabulary: list(24).optional(),
    positioning: z.string().trim().max(300).optional(),
    claims: list(12).optional(),
    naming: z.string().trim().max(240).optional(),
    tagline: z.string().trim().max(160).optional(),
    wordsToAvoid: list(24).optional(),
  }),
  z.object({ component: z.literal('motion'), motionStyle: MotionStyle.optional(), motionPersonality: z.string().trim().max(240).optional() }),
]);
export type BrandComponentPatch = z.infer<typeof BrandComponentPatch>;

export async function updateBrandComponent(session: Session, brandId: string, patch: BrandComponentPatch): Promise<BrandSystem> {
  if (!can(session.actor, 'brand:edit')) throw new AppError('forbidden', 'Your role cannot edit the brand.');
  const store = getStore();
  const brand = await store.brands.get(session.organizationId, brandId);
  if (!brand) throw new AppError('not_found', 'Brand not found.');

  const next = changeFor(brand, patch);
  // The component is the person's from here. A later reading may propose
  // against it; it never writes over it.
  const overrides = brand.overrides.includes(patch.component) ? brand.overrides : [...brand.overrides, patch.component];
  return store.brands.update(session.organizationId, brandId, { ...next, overrides });
}

function changeFor(brand: BrandSystem, patch: BrandComponentPatch): Partial<BrandSystem> {
  switch (patch.component) {
    case 'logo': {
      const next: Partial<BrandSystem> = {};
      if (patch.faviconUrl !== undefined) next.faviconUrl = patch.faviconUrl;
      if (patch.logoUrl !== undefined) {
        next.logo = patch.logoUrl
          ? { ...(brand.logoVariants.find((variant) => variant.url === patch.logoUrl) ?? brand.logo ?? { assetId: null, url: null, background: 'any', format: 'unknown', aspectRatio: 1 }), url: patch.logoUrl }
          : null;
      }
      return next;
    }
    case 'colors': {
      const { component: _component, ...rest } = patch;
      return rest;
    }
    case 'typography': {
      const typography = [...brand.typography];
      for (const role of ['display', 'body', 'mono'] as const) {
        const family = patch[role];
        if (!family) continue;
        const index = typography.findIndex((font) => font.role === role);
        const font = { ...(index >= 0 ? typography[index]! : fontFor(brand, role)), family, renderFamily: family, source: 'user' as const };
        if (index >= 0) typography[index] = font;
        else typography.push(font);
      }
      return { typography };
    }
    case 'layout': {
      const { component: _component, ...rest } = patch;
      return rest;
    }
    case 'iconography':
      return { iconography: patch.iconography };
    case 'imagery': {
      const { component: _component, ...rest } = patch;
      return rest;
    }
    case 'communication': {
      const { component: _component, tone, ...words } = patch;
      const communication = { ...brand.communication };
      for (const [key, value] of Object.entries(words)) {
        if (value !== undefined) (communication as Record<string, unknown>)[key] = value;
      }
      return { communication, ...(tone !== undefined ? { tone } : {}) };
    }
    case 'motion': {
      const { component: _component, ...rest } = patch;
      return rest;
    }
  }
}

/** The whole DNA, confirmed by a person: every component ticked, who and when recorded. */
export async function confirmBrand(session: Session, brandId: string): Promise<BrandSystem> {
  if (!can(session.actor, 'brand:edit')) throw new AppError('forbidden', 'Your role cannot confirm the brand.');
  const store = getStore();
  const brand = await store.brands.get(session.organizationId, brandId);
  if (!brand) throw new AppError('not_found', 'Brand not found.');
  return store.brands.update(session.organizationId, brandId, { confirmedByUser: true, confirmedAt: new Date().toISOString() });
}

/** A reading, decided: accepted into the brand, or dismissed and never proposed again. */
export async function reviewBrandSignal(session: Session, brandId: string, signalId: string, decision: 'accepted' | 'dismissed'): Promise<BrandSystem> {
  if (!can(session.actor, 'brand:edit')) throw new AppError('forbidden', 'Your role cannot review brand signals.');
  const store = getStore();
  const brand = await store.brands.get(session.organizationId, brandId);
  if (!brand) throw new AppError('not_found', 'Brand not found.');
  const signal = brand.signals.find((candidate) => candidate.id === signalId);
  if (!signal) throw new AppError('not_found', 'That signal is no longer here.');
  if (signal.status !== 'pending') return brand;

  const decidedAt = new Date().toISOString();
  const signals = brand.signals.map((candidate) => (candidate.id === signalId ? { ...candidate, status: decision, decidedAt } : candidate));
  const change = decision === 'accepted' ? applyBrandSignal(brand, signal) : {};
  return store.brands.update(session.organizationId, brandId, { ...change, signals });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
