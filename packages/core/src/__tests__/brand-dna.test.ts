import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  BrandSystem,
  applyBrandSignal,
  componentOfField,
  diffBrandSignals,
  inheritBrand,
  mergeBrandSignals,
  pendingBrandSignals,
  pickParentBrand,
  type BrandSystem as Brand,
} from '../index.ts';

/**
 * The brand as a project's own: what a fresh reading proposes, how a later
 * project starts from a confirmed one, and that nothing a person decided is
 * changed by a measurement.
 */
let counter = 0;
const newId = (prefix: 'bsg') => `${prefix}_${(counter += 1)}`;

type BrandInput = z.input<typeof BrandSystem>;

function brand(over: Partial<BrandInput> = {}): Brand {
  return BrandSystem.parse({
    id: 'brd_1',
    organizationId: 'org_1',
    name: 'Acme',
    primaryColor: '#2f6fed',
    secondaryColor: '#0a0a0c',
    typography: [
      { role: 'display', family: 'Söhne', renderFamily: 'Inter' },
      { role: 'body', family: 'Inter', renderFamily: 'Inter' },
    ],
    cornerRadiusPx: 8,
    sources: ['https://acme.example/', 'https://acme.example/pricing'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

describe('a stored brand comes up to the current shape', () => {
  it('fills every newer field with its default', () => {
    const legacy = brand();
    expect(legacy.projectId).toBeNull();
    expect(legacy.communication).toEqual({ language: '', vocabulary: [], positioning: '', claims: [], naming: '', tagline: '', wordsToAvoid: [] });
    expect(legacy.signals).toEqual([]);
    expect(legacy.overrides).toEqual([]);
    expect(legacy.iconography).toBe('none');
  });
});

describe('diffBrandSignals', () => {
  it('proposes what a reading measured differently, with the tolerance a person would use', () => {
    const current = brand();
    const measured = brand({
      primaryColor: '#ff5f5f',
      cornerRadiusPx: 9, // within two pixels: the same radius
      typography: [{ role: 'display', family: 'Geist', renderFamily: 'Geist' }, { role: 'body', family: 'Inter', renderFamily: 'Inter' }],
      communication: { language: 'en', vocabulary: [], positioning: '', claims: [], naming: '', tagline: 'Reconcile everything.', wordsToAvoid: [] },
    });
    const signals = diffBrandSignals(current, measured, { projectId: 'prj_2', sourceUrl: 'https://acme.example/', newId, now: '2026-02-01T00:00:00.000Z' });
    expect(signals.map((signal) => signal.field)).toEqual(['primaryColor', 'typography.display', 'communication.tagline']);
    expect(signals[0]).toMatchObject({ current: '#2f6fed', proposed: '#ff5f5f', status: 'pending', projectId: 'prj_2', sourceUrl: 'https://acme.example/' });
    expect(signals.every((signal) => signal.id.startsWith('bsg_'))).toBe(true);
  });

  it('proposes nothing when the reading agrees', () => {
    expect(diffBrandSignals(brand(), brand(), { projectId: null, sourceUrl: null, newId })).toEqual([]);
  });
});

describe('mergeBrandSignals', () => {
  it('does not propose the same reading twice, nor one a person dismissed', () => {
    const first = diffBrandSignals(brand(), brand({ primaryColor: '#ff5f5f' }), { projectId: null, sourceUrl: null, newId });
    const again = diffBrandSignals(brand(), brand({ primaryColor: '#ff5f5f' }), { projectId: null, sourceUrl: null, newId });
    expect(mergeBrandSignals(first, again)).toHaveLength(1);
    const dismissed = first.map((signal) => ({ ...signal, status: 'dismissed' as const }));
    expect(mergeBrandSignals(dismissed, again)).toHaveLength(1);
    const other = diffBrandSignals(brand(), brand({ primaryColor: '#00aa88' }), { projectId: null, sourceUrl: null, newId });
    expect(mergeBrandSignals(dismissed, other)).toHaveLength(2);
  });
});

describe('applyBrandSignal', () => {
  it('turns an accepted signal into the change it names, and nothing else', () => {
    const current = brand();
    const [colour, face, tagline] = diffBrandSignals(
      current,
      brand({
        primaryColor: '#ff5f5f',
        typography: [{ role: 'display', family: 'Geist', renderFamily: 'Geist' }, { role: 'body', family: 'Inter', renderFamily: 'Inter' }],
        communication: { ...current.communication, tagline: 'Reconcile everything.' },
      }),
      { projectId: null, sourceUrl: null, newId },
    );
    expect(applyBrandSignal(current, colour!)).toEqual({ primaryColor: '#ff5f5f' });
    const typed = applyBrandSignal(current, face!);
    expect(typed.typography?.find((font) => font.role === 'display')).toMatchObject({ family: 'Geist', renderFamily: 'Geist' });
    expect(typed.typography?.find((font) => font.role === 'body')?.family).toBe('Inter');
    expect(applyBrandSignal(current, tagline!)).toEqual({ communication: { ...current.communication, tagline: 'Reconcile everything.' } });
    expect(applyBrandSignal(current, { ...colour!, field: 'nothing.known' })).toEqual({});
  });
});

describe('pickParentBrand', () => {
  it('starts a new project from the confirmed brand of the same site, else the newest confirmed one', () => {
    const acme = brand({ id: 'brd_acme', confirmedByUser: true, updatedAt: '2026-01-05T00:00:00.000Z' });
    const other = brand({ id: 'brd_other', confirmedByUser: true, sources: ['https://other.example/'], updatedAt: '2026-01-09T00:00:00.000Z' });
    const draft = brand({ id: 'brd_draft', confirmedByUser: false, updatedAt: '2026-01-10T00:00:00.000Z' });
    expect(pickParentBrand([draft, other, acme], 'acme.example')?.id).toBe('brd_acme');
    expect(pickParentBrand([draft, other, acme], 'new.example')?.id).toBe('brd_other');
    expect(pickParentBrand([draft], 'acme.example')).toBeNull();
  });
});

describe('inheritBrand', () => {
  it('carries the confirmed DNA whole and keeps the fresh reading as signals', () => {
    const parent = brand({ id: 'brd_parent', confirmedByUser: true, confirmedAt: '2026-01-02T00:00:00.000Z', overrides: ['colors'] });
    const measured = brand({ primaryColor: '#ff5f5f', sources: ['https://acme.example/launch'] });
    const child = inheritBrand(parent, measured, { id: 'brd_child', projectId: 'prj_2', newId, now: '2026-03-01T00:00:00.000Z' });
    expect(child).toMatchObject({ id: 'brd_child', projectId: 'prj_2', parentBrandId: 'brd_parent', primaryColor: '#2f6fed', confirmedByUser: true, overrides: ['colors'], sources: ['https://acme.example/launch'] });
    expect(pendingBrandSignals(child).map((signal) => signal.field)).toEqual(['primaryColor']);
    // The parent is untouched.
    expect(parent.signals).toEqual([]);
  });
});

describe('componentOfField', () => {
  it('puts every field in exactly one of the eight components', () => {
    expect(componentOfField('primaryColor')).toBe('colors');
    expect(componentOfField('typography.display')).toBe('typography');
    expect(componentOfField('cornerRadiusPx')).toBe('layout');
    expect(componentOfField('communication.tagline')).toBe('communication');
    expect(componentOfField('logo')).toBe('logo');
    expect(componentOfField('motionStyle')).toBe('motion');
    expect(componentOfField('imageryStyle')).toBe('imagery');
    expect(componentOfField('iconography')).toBe('iconography');
  });
});
