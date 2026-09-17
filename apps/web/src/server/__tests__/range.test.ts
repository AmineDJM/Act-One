import { describe, it, expect } from 'vitest';
import { parseByteRange } from '../range.ts';

describe('parseByteRange', () => {
  it('reads a normal range', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('runs an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('reads a suffix range as the LAST n bytes', () => {
    // bytes=-500 means the final 500 bytes. Reading it as "up to byte 500"
    // serves the opening of the film to somebody who seeked to the end.
    expect(parseByteRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('clamps a suffix longer than the file', () => {
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past the last byte', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('rejects a start past the end of the file', () => {
    expect(parseByteRange('bytes=2000-3000', 1000)).toBe('unsatisfiable');
  });

  it('rejects a backwards range', () => {
    expect(parseByteRange('bytes=800-200', 1000)).toBe('unsatisfiable');
  });

  it('ignores multipart ranges rather than mis-serving one part', () => {
    expect(parseByteRange('bytes=0-99,200-299', 1000)).toBeNull();
  });

  it('ignores junk and an absent header', () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange('items=0-10', 1000)).toBeNull();
    expect(parseByteRange('bytes=-', 1000)).toBeNull();
  });

  it('has nothing to serve from an empty asset', () => {
    expect(parseByteRange('bytes=0-10', 0)).toBeNull();
  });
});
