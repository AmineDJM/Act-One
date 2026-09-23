import { describe, expect, it } from 'vitest';
import { Benchmark, benchmarkKeys, benchmarkRetrievable, cleanFileName, freshStages, sniffContainer, titleFromFileName } from '../domain/benchmark.ts';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((value) => (typeof value === 'string' ? [...value].map((c) => c.charCodeAt(0)) : [value])));

describe('sniffContainer', () => {
  it('knows an MP4 and a QuickTime film by their ftyp box, whatever they are called', () => {
    expect(sniffContainer(bytes(0, 0, 0, 0x20, 'ftyp', 'isom', 0, 0, 2, 0))).toBe('mp4');
    expect(sniffContainer(bytes(0, 0, 0, 0x18, 'ftyp', 'iso5', 0, 0, 2, 0))).toBe('mp4');
    expect(sniffContainer(bytes(0, 0, 0, 0x14, 'ftyp', 'qt  ', 0, 0, 2, 0))).toBe('mov');
  });

  it('tells WebM from other Matroska by the document type in its header', () => {
    expect(sniffContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 'webm'))).toBe('webm');
    expect(sniffContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, 'matroska'))).toBe('mkv');
  });

  it('refuses what is not a film, including a film\'s name on something else', () => {
    expect(sniffContainer(bytes('%PDF-1.7 ....'))).toBeNull();
    expect(sniffContainer(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(sniffContainer(bytes('<html>'))).toBeNull();
    expect(sniffContainer(new Uint8Array())).toBeNull();
  });
});

describe('file names', () => {
  it('keeps a name readable and harmless', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\films\\Launch <final>.mp4')).toBe('Launch _final_.mp4');
    expect(cleanFileName('Présentation 2026.mov')).toBe('Présentation 2026.mov');
    expect(cleanFileName('..')).toBe('film');
    expect(cleanFileName('a'.repeat(400) + '.mp4')).toHaveLength(160);
  });

  it('makes a title until someone writes one', () => {
    expect(titleFromFileName('plasma-5.25_amazement_guaranteed.mp4')).toBe('plasma 5 25 amazement guaranteed');
    expect(titleFromFileName('.mp4')).toBe('Untitled film');
  });
});

describe('benchmarkKeys', () => {
  it('keeps every file of a film under its own prefix, and each run under its own', () => {
    const keys = benchmarkKeys('bmk_abc', 'bmr_1');
    expect(keys.source('mp4')).toBe('platform/benchmarks/bmk_abc/source.mp4');
    expect(keys.checkpoints).toBe('platform/benchmarks/bmk_abc/runs/bmr_1/checkpoints');
    expect(keys.filmIr).toBe('platform/benchmarks/bmk_abc/runs/bmr_1/FilmIR.json');
    expect(benchmarkKeys('bmk_abc').filmIr).toBeNull();
  });
});

describe('benchmarkRetrievable', () => {
  const base = Benchmark.parse({
    id: 'bmk_abc',
    title: 'A film',
    status: 'ready',
    source: { storageKey: 'k', fileName: 'f.mp4', bytes: 1, sha256: 'a'.repeat(64), contentType: 'video/mp4', container: 'mp4', uploadedByUserId: null, uploadedAt: '2026-09-01T00:00:00Z' },
    stages: freshStages(),
    analysis: { filmIrKey: 'platform/benchmarks/bmk_abc/runs/bmr_1/FilmIR.json' },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  });

  it('offers only analysed films that nobody switched off', () => {
    expect(benchmarkRetrievable(base)).toBe(true);
    expect(benchmarkRetrievable({ ...base, status: 'partial' })).toBe(true);
    expect(benchmarkRetrievable({ ...base, retrieval: 'disabled' })).toBe(false);
    expect(benchmarkRetrievable({ ...base, status: 'failed' })).toBe(false);
    expect(benchmarkRetrievable({ ...base, analysis: { ...base.analysis, filmIrKey: null } })).toBe(false);
  });
});
