import { describe, it, expect } from 'vitest';
import {
  CAPTION_MAX_SECONDS,
  CAPTION_MIN_GAP_SECONDS,
  CAPTION_MIN_SECONDS,
  captionFindings,
  captionLimits,
  captionLines,
  captionScript,
  captionsFrom,
  columns,
  toWebVtt,
  type CaptionCue,
} from '../index.ts';

/**
 * Captions, against the published limits.
 *
 * One test per rule, named for it, because the point of writing the corpus
 * down was that a regression can say which standard it broke rather than
 * which assertion it failed.
 */

/** Words at a plausible speaking rate, roughly 2.8 a second. */
function speak(sentence: string, from = 0): { word: string; start: number; end: number }[] {
  let at = from;
  return sentence.split(' ').map((word) => {
    const length = 0.12 + word.length * 0.055;
    const entry = { word, start: round(at), end: round(at + length) };
    at += length + 0.06;
    return entry;
  });
}

const round = (value: number) => Math.round(value * 1000) / 1000;

const LINE = 'A week of manual reconciliation. One run.';

describe('captions from what was actually said', () => {
  const words = speak(LINE);

  it('breaks where the sentence breaks, not where the character count does', () => {
    const cues = captionsFrom(words);
    expect(cues[0]!.text).toBe('A week of manual reconciliation.');
    expect(cues[0]!.start).toBe(0);
    expect(cues[1]!.text).toBe('One run.');
  });

  it('caption.minimum_duration: holds every caption at least five sixths of a second', () => {
    for (const cue of captionsFrom(words)) {
      expect(cue.end - cue.start).toBeGreaterThanOrEqual(CAPTION_MIN_SECONDS - 0.001);
    }
  });

  it('caption.maximum_duration: never leaves one up past seven seconds', () => {
    // One word, then a long silence: the cue would otherwise run to the film's end.
    const cues = captionsFrom([{ word: 'Ship.', start: 0, end: 0.4 }], { filmSeconds: 60 });
    expect(cues[0]!.end).toBeLessThanOrEqual(CAPTION_MAX_SECONDS + 0.001);
  });

  it('caption.gap: leaves two frames between consecutive captions', () => {
    // Continuous speech, so holding each cue for its reading time would run
    // it straight into the next one.
    const cues = captionsFrom(speak('One. Two. Three. Four.'));
    expect(cues.length).toBeGreaterThan(2);
    for (const [index, cue] of cues.entries()) {
      const next = cues[index + 1];
      if (next) expect(next.start - cue.end).toBeGreaterThanOrEqual(CAPTION_MIN_GAP_SECONDS - 0.001);
    }
  });

  it('caption.reading_rate: borrows the silence after a line rather than racing it', () => {
    // Said in 1.2s, then nothing for ten: the caption should take the time.
    const cues = captionsFrom(
      [
        { word: 'Reconciliation', start: 0, end: 0.7 },
        { word: 'finished', start: 0.7, end: 1.2 },
      ],
      { filmSeconds: 12 },
    );
    const cue = cues[0]!;
    const needed = cue.text.length / captionLimits('en').charactersPerSecond;
    expect(cue.end - cue.start).toBeGreaterThanOrEqual(needed);
    expect(captionFindings(cues)).toEqual([]);
  });

  it('caption.reading_rate: reports a line that no caption could keep up with', () => {
    // Forty-two characters spoken in a second, with the next line hard behind
    // it. There is no honest way to caption that, so it is a finding, not a
    // quiet truncation.
    const cues = captionsFrom([
      { word: 'Reconciliation,', start: 0, end: 0.5 },
      { word: 'consolidation,', start: 0.5, end: 0.8 },
      { word: 'attribution.', start: 0.8, end: 1 },
      { word: 'Next.', start: 1.05, end: 1.3 },
    ]);
    const rate = captionFindings(cues).filter((finding) => finding.standardId === 'caption.reading_rate');
    expect(rate.length).toBeGreaterThan(0);
    expect(rate[0]!.message).toMatch(/20 a second/);
  });

  it('says nothing when nothing was said', () => {
    expect(captionsFrom([])).toEqual([]);
    expect(toWebVtt([])).toBe('WEBVTT\n');
  });
});

describe('how a caption breaks into lines', () => {
  it('caption.two_lines: never puts three lines on screen', () => {
    const long = 'Finance teams spend a week every month reconciling ledgers by hand across four systems.';
    for (const cue of captionsFrom(speak(long))) expect(cue.lines.length).toBeLessThanOrEqual(2);
  });

  it('caption.line_length: keeps each line inside the limit for its script', () => {
    const long = 'Finance teams spend a week every month reconciling ledgers by hand across four systems.';
    for (const cue of captionsFrom(speak(long))) {
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(42);
    }
  });

  it('caption.line_break: does not leave an article or a preposition hanging', () => {
    const lines = captionLines('Close the books in a morning instead of a week of manual work', 42);
    expect(lines).toHaveLength(2);
    const last = lines[0]!.split(' ').at(-1)!.toLowerCase();
    expect(['a', 'an', 'the', 'of', 'in', 'to']).not.toContain(last);
  });

  it('leaves a line that already fits on one line', () => {
    expect(captionLines('One run.', 42)).toEqual(['One run.']);
  });

  it('prefers a break at punctuation near the middle', () => {
    const lines = captionLines('Four systems, one ledger, and a morning to close the books', 42);
    expect(lines[0]!.endsWith(',')).toBe(true);
  });
});

describe('scripts that are not written in Latin letters', () => {
  it('knows which languages are counted in full-width characters', () => {
    expect(captionScript('ja')).toBe('full_width');
    expect(captionScript('zh-Hans')).toBe('full_width');
    expect(captionScript('fr')).toBe('latin');
    expect(captionScript(null)).toBe('latin');
  });

  it('counts a full-width character as two columns and a Latin one as one', () => {
    expect(columns('請求書', 'full_width')).toBe(6);
    expect(columns('Act One', 'full_width')).toBe(7);
    expect(columns('Act One', 'latin')).toBe(7);
  });

  it('caption.line_length: holds Japanese to sixteen characters a line', () => {
    expect(captionLimits('ja')).toEqual({ charactersPerLine: 16, charactersPerSecond: 4 });
    const cues = captionsFrom(
      // Four characters a second is the published Japanese reading rate, and
      // a narration written to it sounds like this: unhurried.
      [
        { word: '請求書の消込に', start: 0, end: 1.8 },
        { word: '毎月一週間かけていました。', start: 2, end: 5.4 },
      ],
      { language: 'ja', filmSeconds: 20 },
    );
    for (const cue of cues) for (const line of cue.lines) expect(columns(line, 'full_width')).toBeLessThanOrEqual(32);
    expect(captionFindings(cues, { language: 'ja' })).toEqual([]);
  });
});

describe('the track a browser reads', () => {
  it('writes WebVTT with the two lines on two lines', () => {
    const vtt = toWebVtt([
      { start: 0, end: 2.5, text: 'Four systems, one ledger', lines: ['Four systems,', 'one ledger'] },
    ]);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500');
    expect(vtt).toContain('Four systems,\non ledger'.replace('on ledger', 'one ledger'));
  });

  it('numbers the cues from one', () => {
    const vtt = toWebVtt(captionsFrom(speak(LINE)));
    expect(vtt).toContain('\n1\n');
    expect(vtt).toContain('\n2\n');
  });
});

describe('the checks, against a track built by hand to fail them', () => {
  const bad: CaptionCue[] = [
    { start: 0, end: 0.3, text: 'Too fast', lines: ['Too fast'] },
    {
      start: 0.3,
      end: 9,
      text: 'A line long past the limit for how many characters may sit on one line at once',
      lines: ['A line long past the limit for how many characters may sit on one line at once'],
    },
    { start: 9, end: 10, text: 'Third', lines: ['a', 'b', 'c'] },
  ];

  it('names the standard each failure broke', () => {
    const broken = new Set(captionFindings(bad).map((finding) => finding.standardId));
    expect(broken).toContain('caption.minimum_duration');
    expect(broken).toContain('caption.maximum_duration');
    expect(broken).toContain('caption.line_length');
    expect(broken).toContain('caption.gap');
    expect(broken).toContain('caption.two_lines');
  });

  it('passes a track the builder produced', () => {
    expect(captionFindings(captionsFrom(speak(LINE)))).toEqual([]);
  });
});
