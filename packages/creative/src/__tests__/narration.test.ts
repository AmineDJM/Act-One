import { describe, it, expect } from 'vitest';
import { ScriptedLlmProvider } from '@act-one/providers';
import {
  judgeAudio,
  judgeLoudnessSpread,
  judgeTranscript,
  numbersOf,
  pauseAfter,
  scoreFindings,
  segmentForSpeech,
  shortenForTime,
  speedUpFor,
  splitSentences,
  timingFor,
  tokensForCompare,
  wordErrorRate,
} from '../index.ts';

const call = { organizationId: 'org_1', projectId: 'prj_1' };

describe('segmentation for speech', () => {
  it('splits at sentence ends and not at abbreviations or decimals', () => {
    expect(splitSentences('Dr. Smith raised $1.2M in 2024. It closed fast! Really? Yes… and then some.')).toEqual([
      'Dr. Smith raised $1.2M in 2024.',
      'It closed fast!',
      'Really?',
      'Yes… and then some.',
    ]);
    expect(splitSentences('Version 3.5 shipped. "Done," she said. Next.')).toEqual([
      'Version 3.5 shipped.',
      '"Done," she said.',
      'Next.',
    ]);
  });

  it('packs whole sentences under the limit and keeps paragraphs apart', () => {
    const text = `One. Two two. Three three three.\n\nFour four four four. Five.`;
    const passages = segmentForSpeech(text, { maxChars: 200 });
    // Under the floor of 200 characters everything of a paragraph fits in one passage.
    expect(passages.map((p) => p.text)).toEqual(['One. Two two. Three three three.', 'Four four four four. Five.']);
    expect(passages.map((p) => p.endsParagraph)).toEqual([true, true]);
    expect(passages.map((p) => p.paragraph)).toEqual([0, 1]);
    expect(pauseAfter(passages[0]!)).toBeGreaterThan(pauseAfter({ endsParagraph: false }));
  });

  it('never splits a sentence to make a passage fit', () => {
    const sentence = 'This sentence is exactly long enough to matter, with a clause in it. ';
    const passages = segmentForSpeech(sentence.repeat(12), { maxChars: 220 });
    for (const passage of passages) {
      expect(passage.text.length).toBeLessThanOrEqual(220);
      expect(passage.text.endsWith('.')).toBe(true);
    }
    expect(passages.reduce((n, p) => n + p.sentences, 0)).toBe(12);
    expect(passages.at(-1)?.endsParagraph).toBe(true);
    expect(passages.slice(0, -1).every((p) => !p.endsParagraph)).toBe(true);
  });
});

describe('fitting a line to its room', () => {
  it('leaves a line alone when it fits, and asks for fewer words when it does not', () => {
    const line = 'The work moves the moment it lands.';
    expect(timingFor(line, 4).fits).toBe(true);
    expect(timingFor(line, null).fits).toBe(true);
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.';
    const plan = timingFor(long, 3);
    expect(plan.fits).toBe(false);
    expect(plan.targetWords).toBeGreaterThan(2);
    expect(plan.targetWords).toBeLessThan(16);
  });

  it('hurries a long line only a little, and never a short one', () => {
    expect(speedUpFor('Hi.', 30)).toBe(1);
    expect(speedUpFor('word '.repeat(60), 1)).toBe(1.1);
    expect(speedUpFor('one two three four five six seven eight nine ten.', 3.4)).toBeGreaterThan(1);
    expect(speedUpFor('one two three four five six seven eight nine ten.', 3.4)).toBeLessThanOrEqual(1.1);
  });

  it('accepts a rewrite that keeps every figure and is shorter, and refuses one that drops a figure', async () => {
    const original = 'Teams close their books 3x faster, with 400 finance teams already on board, every single month.';
    const keeps = new ScriptedLlmProvider([
      { respond: { text: 'Teams close their books 3x faster; 400 finance teams already do.' } },
    ]);
    const kept = await shortenForTime(keeps, { text: original, language: 'en', targetWords: 12, roomSeconds: 4, context: 'launch_film' }, call);
    expect(kept.changed).toBe(true);
    expect(kept.text).toBe('Teams close their books 3x faster; 400 finance teams already do.');
    expect(keeps.calls[0]?.options.tier).toBe('fast');

    const drops = new ScriptedLlmProvider([{ respond: { text: 'Teams close their books much faster now.' } }]);
    const dropped = await shortenForTime(drops, { text: original, language: 'en', targetWords: 12, roomSeconds: 4, context: 'launch_film' }, call);
    expect(dropped.changed).toBe(false);
    expect(dropped.text).toBe(original);

    const longer = new ScriptedLlmProvider([{ respond: { text: `${original} And more besides, honestly.` } }]);
    expect((await shortenForTime(longer, { text: original, language: 'en', targetWords: 12, roomSeconds: 4, context: 'launch_film' }, call)).changed).toBe(false);

    const broken = new ScriptedLlmProvider([{ respond: { nope: true } }]);
    expect((await shortenForTime(broken, { text: original, language: 'en', targetWords: 12, roomSeconds: 4, context: 'launch_film' }, call)).changed).toBe(false);
  });

  it('reads figures as written', () => {
    expect(numbersOf('Raised $1.2M in 2024, 24.7 % up, 3x.')).toEqual(['1.2', '2024', '24.7%', '3']);
  });
});

describe('listening back', () => {
  const transcript = (text: string, extra: Partial<Parameters<typeof judgeTranscript>[0]['transcript']> = {}) => ({
    text,
    language: 'en',
    languageConfidence: 0.99,
    durationSeconds: 3,
    words: [],
    ...extra,
  });

  it('compares words after both sides are spoken the same way', () => {
    expect(tokensForCompare('Raised $1.2M in 2024!', 'en')).toEqual(
      'raised one point two million dollars in twenty twenty four'.split(' '),
    );
    expect(wordErrorRate(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    expect(wordErrorRate(['a', 'b', 'c'], ['a', 'c'])).toBeCloseTo(1 / 3);
  });

  it('passes a faithful read and blocks the wrong language', () => {
    const script = 'Teams close their books three times faster. Trusted by 400 finance teams.';
    expect(judgeTranscript({ script, transcript: transcript('Teams close their books three times faster. Trusted by four hundred finance teams.'), language: 'en' })).toEqual([]);
    const wrong = judgeTranscript({ script, transcript: transcript('Les équipes clôturent trois fois plus vite.', { language: 'fr' }), language: 'en' });
    expect(wrong.map((f) => f.check)).toContain('narration_language');
    expect(wrong.find((f) => f.check === 'narration_language')?.blocking).toBe(true);
  });

  it('notices a dropped figure, a cut ending and a long pause', () => {
    const script = 'Trusted by 400 finance teams, since 2019, across the whole of Europe.';
    const figure = judgeTranscript({ script, transcript: transcript('Trusted by finance teams, since twenty nineteen, across the whole of Europe.'), language: 'en' });
    expect(figure.some((f) => f.check === 'narration_accuracy' && /four/.test(f.message) && f.blocking)).toBe(true);

    const cut = judgeTranscript({ script, transcript: transcript('Trusted by four hundred finance teams, since twenty nineteen, across the'), language: 'en' });
    expect(cut.some((f) => f.check === 'narration_truncated' && f.blocking)).toBe(true);

    const paused = judgeTranscript({
      script: 'One idea, one film.',
      transcript: transcript('One idea, one film.', {
        words: [
          { word: 'One', start: 0, end: 0.3 },
          { word: 'idea', start: 0.3, end: 0.7 },
          { word: 'one', start: 3.4, end: 3.6 },
          { word: 'film', start: 3.6, end: 4 },
        ],
      }),
      language: 'en',
    });
    expect(paused).toEqual([expect.objectContaining({ check: 'narration_pause', severity: 'major', blocking: true })]);
  });

  it('judges the recording itself: clipping, a read that stopped early, a read that runs long', () => {
    // Five seconds of speech with a little dead air either side.
    const facts = { durationSeconds: 5.5, peakDb: -3, integratedLufs: -20, headSilenceSeconds: 0.2, tailSilenceSeconds: 0.3, silences: [] };
    expect(judgeAudio({ facts, roomSeconds: 6, characters: 40 })).toEqual([]);
    expect(judgeAudio({ facts: { ...facts, peakDb: 0 }, roomSeconds: 6, characters: 40 })[0]).toMatchObject({ check: 'audio_clipping', blocking: true });
    expect(judgeAudio({ facts, roomSeconds: 6, characters: 400 })[0]).toMatchObject({ check: 'narration_truncated', blocking: true });
    expect(judgeAudio({ facts, roomSeconds: 4, characters: 40 })[0]).toMatchObject({ check: 'narration_timing', severity: 'major', blocking: true });
    expect(judgeAudio({ facts, roomSeconds: 4.7, characters: 40 })[0]).toMatchObject({ check: 'narration_timing', severity: 'minor', blocking: false });
    expect(judgeAudio({ facts: { ...facts, silences: [{ start: 1, end: 2.6 }] }, roomSeconds: null, characters: 40 })[0]).toMatchObject({ check: 'narration_pause', severity: 'minor' });
  });

  it('scores blocking findings above everything and notices uneven levels', () => {
    expect(scoreFindings([{ check: 'narration_pause', severity: 'minor', message: '', blocking: false }])).toBe(1);
    expect(scoreFindings([{ check: 'audio_clipping', severity: 'major', message: '', blocking: true }])).toBe(110);
    expect(judgeLoudnessSpread([-20, -21, null])).toBeNull();
    expect(judgeLoudnessSpread([-20, -27])).toMatchObject({ check: 'narration_loudness', severity: 'major' });
  });
});
