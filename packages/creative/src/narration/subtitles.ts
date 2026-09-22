/**
 * Subtitles, which are the one thing in this film that may not be authored.
 *
 * THEY HAVE BEEN BROKEN TWICE, BOTH TIMES BY A GOOD INTENTION. Once when the
 * on-screen type was filtered down to the phrase a beat turns on — which was
 * right for the EDITORIAL layer and silently deleted this one — and once when
 * that phrase was pulled earlier than it is spoken to fill a hole, so the film
 * showed "not made yet." while the narrator was still on "Every company has a
 * film". Both times the words on screen stopped being the words being said,
 * and both times it was invisible to every test in the repository.
 *
 * So the rule lives here as a function rather than as care taken inside a
 * script. A subtitle row is derived from the performance and nothing else: it
 * carries a phrase the reading actually produced, it appears at the second
 * that phrase was spoken, and it leaves when the next one arrives. There is no
 * option to lead it, no option to select a subset, and no option to rewrite the
 * text — an argument that could do any of those is an argument somebody will
 * eventually pass.
 *
 * The editorial layer is free to say something else entirely. That is what it
 * is for, and keeping the two apart is the whole point of having both.
 */
import type { Phrase } from './av-beat.ts';

export type SubtitleRow = {
  /** Exactly what was said. Never edited, never summarised. */
  text: string;
  /** When it was said, relative to the beat. */
  atSeconds: number;
  /** When the next phrase arrives, or the end of the beat. */
  untilSeconds: number;
};

/**
 * Every phrase the reading produced, in order, with no gaps and no leads.
 *
 * A wordless beat returns nothing, which is correct: silence has no subtitle.
 */
/**
 * The shortest a caption may stay on screen before it is a flash rather than a
 * subtitle.
 *
 * Not a taste number. The reading of "Every company has a film it has not made
 * yet." breaks where the voice breathes and where the emphasis begins, which
 * put "it has" on screen for 0.23 SECONDS — five frames of text nobody can
 * read, between two captions they can. The screen flickered, and a flicker
 * reads as a fault in the film rather than as words.
 *
 * It is a constant and not an argument because an argument is a lever, and the
 * two times this file's rule was broken it was broken by somebody reaching for
 * a lever with a good reason.
 */
const READABLE_SECONDS = 0.75;

/**
 * Every phrase the reading produced, in order, with no gaps and no leads.
 *
 * A row may carry MORE than one phrase — a phrase too brief to read is joined
 * to the one beside it — but it never carries less than a phrase, never carries
 * a phrase out of order, and never appears before its first phrase was spoken.
 * Joining is the only liberty this function takes and `subtitlesFollow` proves
 * it took no other.
 *
 * A wordless beat returns nothing, which is correct: silence has no subtitle.
 */
export function subtitlesFor(
  phrases: readonly Phrase[],
  beatDurationSeconds: number,
): SubtitleRow[] {
  const rows: SubtitleRow[] = phrases.map((phrase, index) => {
    const next = phrases[index + 1];
    return {
      text: phrase.text,
      atSeconds: phrase.atSeconds,
      /*
       * Held until the next phrase, not for a fixed duration. A subtitle that
       * expires on a timer leaves the screen while the speaker is still in the
       * sentence, and one that overlaps the next has two captions up at once.
       * The performance decides both edges.
       */
      untilSeconds: next ? next.atSeconds : beatDurationSeconds,
    };
  });

  /*
   * Join forward, because a caption belongs to the moment it STARTS.
   *
   * "it has" joined to "not made yet." becomes one caption that arrives at
   * 2.79s, when "it has" is said, and stays through the rest of the sentence.
   * That is ordinary subtitling: a line appears as it begins and the voice
   * catches up inside it. Joining backward instead would have shown "it has"
   * at 0.60s, while the narrator was still on "Every company has a film" —
   * which is the exact fault this file exists to prevent.
   *
   * The last row has nothing ahead of it, so it joins backward; a caption that
   * ends the beat is not revealing anything early by doing so.
   */
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.untilSeconds - row.atSeconds >= READABLE_SECONDS) continue;
    if (rows.length === 1) break;
    if (index + 1 < rows.length) {
      const next = rows[index + 1]!;
      rows.splice(index, 2, {
        text: `${row.text} ${next.text}`,
        atSeconds: row.atSeconds,
        untilSeconds: next.untilSeconds,
      });
    } else {
      const previous = rows[index - 1]!;
      rows.splice(index - 1, 2, {
        text: `${previous.text} ${row.text}`,
        atSeconds: previous.atSeconds,
        untilSeconds: row.untilSeconds,
      });
    }
    // Re-examine the joined row: joining twice is allowed, skipping is not.
    index -= 1;
  }

  return rows;
}

/**
 * Whether a set of rows still says what was said, when it was said.
 *
 * Every phrase must appear, in order, inside a row; no row may say anything
 * the voice did not; and no row may be on screen before its first phrase was
 * spoken. Used by the tests, and cheap enough to be used as an assertion
 * anywhere a caller wants to prove it has not quietly broken the contract —
 * the compiler calls it on every beat before it draws one.
 */
export function subtitlesFollow(
  rows: readonly SubtitleRow[],
  phrases: readonly Phrase[],
): { ok: true } | { ok: false; why: string } {
  if (!phrases.length) {
    return rows.length === 0
      ? { ok: true }
      : { ok: false, why: `${rows.length} subtitle(s) over a beat nobody speaks in.` };
  }
  if (!rows.length) return { ok: false, why: `No subtitle for ${phrases.length} spoken phrase(s).` };

  let taken = 0;
  for (const row of rows) {
    const mine: Phrase[] = [];
    // Consume phrases until the row's text is accounted for exactly.
    while (taken < phrases.length && mine.map((p) => p.text).join(' ') !== row.text) {
      mine.push(phrases[taken]!);
      taken += 1;
    }
    const said = mine.map((p) => p.text).join(' ');
    if (said !== row.text) {
      return { ok: false, why: `A row says "${row.text}"; the voice said "${said}".` };
    }
    if (row.atSeconds !== mine[0]!.atSeconds) {
      return {
        ok: false,
        why: `"${row.text}" appears at ${row.atSeconds}s; it was spoken from ${mine[0]!.atSeconds}s.`,
      };
    }
  }
  if (taken !== phrases.length) {
    return { ok: false, why: `${phrases.length - taken} spoken phrase(s) never reach the screen.` };
  }
  return { ok: true };
}
