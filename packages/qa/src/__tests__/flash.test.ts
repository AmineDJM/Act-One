import { describe, it, expect } from 'vitest';
import { MAX_FLASHES_PER_SECOND } from '@act-one/core';
import { findFlashes, flashIssues, isFullRange, parseYAvg, relativeLuminance } from '../index.ts';

/** A sequence that alternates between two luminances every `holdFrames`. */
function alternating(dark: number, bright: number, holdFrames: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, i) =>
    Math.floor(i / holdFrames) % 2 === 0 ? dark : bright,
  );
}

/**
 * Photosensitivity is the one rule in this system that is about harm rather
 * than quality, and the only one with no creative argument on the other side.
 * These are the cases it has to get right.
 */
describe('flash rate', () => {
  it('passes a film that does not flash', () => {
    const steady = Array.from({ length: 90 }, () => 0.3);
    expect(findFlashes(steady, 30)).toEqual([]);
  });

  it('passes a film cutting at a normal pace', () => {
    // A cut every half second between a dark and a bright frame: six
    // transitions in three seconds, nowhere near the limit.
    expect(findFlashes(alternating(0.05, 0.6, 15, 90), 30)).toEqual([]);
  });

  it('catches strobing', () => {
    // Every three frames at 30fps is ten alternations a second.
    const events = findFlashes(alternating(0.02, 0.7, 3, 90), 30);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.count).toBeGreaterThan(MAX_FLASHES_PER_SECOND);
  });

  it('allows exactly three flashes in a second', () => {
    // The standard is "more than three", so three is compliant. A check that
    // is off by one here rejects a legitimate edit.
    const frames = [0.05, 0.6, 0.05, 0.6, 0.05, 0.6, 0.05];
    const padded = [...frames, ...Array.from({ length: 60 }, () => 0.05)];
    const events = findFlashes(padded, 30);
    expect(events).toEqual([]);
  });

  it('ignores changes between two bright images', () => {
    // WCAG only counts a pair where the darker image is below 0.8 relative
    // luminance: two bright frames alternating is not a flash.
    expect(findFlashes(alternating(0.85, 1.0, 2, 90), 30)).toEqual([]);
  });

  it('ignores a change too small to count', () => {
    // Under 10% of maximum luminance.
    expect(findFlashes(alternating(0.3, 0.36, 2, 90), 30)).toEqual([]);
  });

  it('does not count a staircase as flashing', () => {
    // Rising steadily in one direction is not a pair of opposing changes,
    // however steep. A check that counted these would fail every fade-in.
    const ramp = Array.from({ length: 60 }, (_, i) => i / 60);
    expect(findFlashes(ramp, 30)).toEqual([]);
  });

  it('reports each offending stretch once rather than each frame of it', () => {
    const events = findFlashes(alternating(0.02, 0.7, 2, 300), 30);
    // Ten seconds of continuous strobing: a handful of findings, not hundreds.
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(15);
  });

  it('blocks rather than merely noting', () => {
    const issues = flashIssues(alternating(0.02, 0.7, 3, 90), 30);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.severity).toBe('blocker');
    expect(issues[0]!.message).toMatch(/WCAG 2\.2/);
    expect(issues[0]!.message).toMatch(/seizures/);
  });

  it('survives a film too short to have a rate at all', () => {
    expect(findFlashes([], 30)).toEqual([]);
    expect(findFlashes([0.5], 30)).toEqual([]);
    expect(findFlashes([0.1, 0.9], 0)).toEqual([]);
  });
});

describe('reading luminance from a frame', () => {
  it('uses the sRGB transfer function rather than the raw value', () => {
    // Mid-grey in code values is far darker than half brightness. Using the
    // raw value would put the 0.8 threshold in completely the wrong place.
    const mid = relativeLuminance(128, true);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.23);
  });

  it('reads limited and full range differently, because they are', () => {
    expect(relativeLuminance(16, false)).toBe(0);
    expect(relativeLuminance(16, true)).toBeGreaterThan(0);
    expect(relativeLuminance(235, false)).toBeCloseTo(1, 5);
    expect(relativeLuminance(255, true)).toBeCloseTo(1, 5);
  });

  it('clamps rather than going negative below limited-range black', () => {
    expect(relativeLuminance(7, false)).toBe(0);
  });

  it('recognises the range FFmpeg reports', () => {
    const full = '  Stream #0:0[0x1](und): Video: h264 (High), yuvj420p(pc, bt470bg), 3840x2160';
    const limited = '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709), 1920x1080';
    expect(isFullRange(full)).toBe(true);
    expect(isFullRange(limited)).toBe(false);
    // Nothing said: assume limited, which is the broadcast norm.
    expect(isFullRange('no stream line here')).toBe(false);
  });

  it('parses per-frame luma out of signalstats metadata', () => {
    const output = [
      'frame:0    pts:0       pts_time:0',
      'lavfi.signalstats.YMIN=7',
      'lavfi.signalstats.YAVG=7.08889',
      'lavfi.signalstats.YMAX=10',
      'frame:1    pts:1500    pts_time:0.033',
      'lavfi.signalstats.YAVG=112.5',
    ].join('\n');

    // YMIN and YMAX must not be mistaken for the average.
    expect(parseYAvg(output)).toEqual([7.08889, 112.5]);
  });
});
