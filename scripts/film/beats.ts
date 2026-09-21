import type { AvBeat } from '@act-one/creative';
import type { BeatVisual } from './compile-beats.ts';

/**
 * The film, written as ideas rather than as shots.
 *
 * Each beat is one thing the film says and the thing the picture does about
 * it. Nothing here declares a duration: the length of a beat is the length of
 * its reading, measured after the voice exists, plus whatever hold the idea
 * needs to land. A shot list with times in it would be the old architecture
 * wearing new words.
 *
 * `emphasis` is the word the picture reacts to, and it must be a substring of
 * the line — it is matched against the real reading, where it has a time
 * attached. Every beat carries a `reason`, including the wordless ones, so
 * there is no visual event in this film without a narrative cause.
 */
export const BEATS: AvBeat[] = [
  {
    id: 'b1', line: 'Every company has a film it has not made yet.',
    emphasis: 'not made yet.',
    reason: 'HOOK: name the thing the viewer already knows about themselves.',
    leadSeconds: 0.4, tailSeconds: 0.5,
  },
  {
    id: 'b2', line: 'You know what it should say. You have said it a hundred times.',
    emphasis: 'a hundred times.',
    reason: 'RECOGNITION: the idea is not the missing part, so the film cannot be about having ideas.',
    tailSeconds: 0.4,
  },
  {
    id: 'b3', line: 'Then it becomes a project. Six weeks before a single frame exists.',
    emphasis: 'Six weeks',
    reason: 'THE COST, named. This is the number the whole film argues with.',
    tailSeconds: 0.5,
  },
  {
    id: 'b4', line: 'This is Act One.',
    emphasis: 'Act One.',
    reason: 'BRAND: the shortest beat so far, because it is the most certain.',
    tailSeconds: 0.6,
  },
  {
    id: 'b5', line: 'No brief. No kickoff call.',
    emphasis: 'No brief.',
    reason: 'STEP ONE, by what it removes rather than what it adds.',
    tailSeconds: 0.3,
  },
  {
    id: 'b6', line: 'It opens your site like a customer would, and takes what is actually there.',
    emphasis: 'actually there.',
    reason: 'STEP ONE SHOWN: the real interface, travelled through.',
    tailSeconds: 0.4,
  },
  {
    id: 'b7', line: 'Not one safe idea. Three.',
    emphasis: 'Three.',
    reason: 'STEP TWO: three directions, and the frame divides on the word.',
    tailSeconds: 0.5,
  },
  {
    id: 'b8', line: 'Each one rendered, watched, and scored before you see it.',
    emphasis: 'before you see it.',
    reason: 'STEP TWO SHOWN: the work is judged by the system before the customer judges it.',
    tailSeconds: 0.4,
  },
  {
    id: 'b9', line: 'Contrast, loudness, timing. It fails itself first.',
    emphasis: 'fails itself first.',
    reason: 'STEP THREE: the checks, named specifically enough to be believed.',
    tailSeconds: 0.5,
  },
  {
    id: 'b10', line: 'Six weeks is thirty working days, and most of them are waiting.',
    emphasis: 'waiting.',
    reason: 'THE ARGUMENT: the six weeks are not work, which is why they can go.',
    tailSeconds: 0.5,
  },
  {
    id: 'b11', line: 'Take the waiting out.',
    emphasis: 'Take the waiting out.',
    reason: 'THE TURN. The shortest line in the film, and the one it is about.',
    tailSeconds: 0.7,
  },
  {
    id: 'b12', line: 'Nothing about the work gets cheaper. Only the calendar.',
    emphasis: 'Only the calendar.',
    reason: 'THE BENEFIT, and the objection answered in the same breath.',
    // Carries the beat of silence that the cut output shot used to hold, so
    // the film still breathes before it asks for something.
    tailSeconds: 1.5,
  },
  /*
   * b13 WAS HERE, and it was cut.
   *
   * It was commissioned to answer one note — that the film never shows its
   * output — and it never answered it. What came back from the video model
   * was an empty table with a closed laptop on it, shot from the side: a
   * hero moment with no hero in it. Four readings in a row went for it, the
   * last of them "remove the empty desk shot entirely, it stalls the visual
   * pacing right before the final call to action", and looking at the frame
   * they are plainly right.
   *
   * The note that put it there is answered elsewhere now. b8 shows the three
   * real renders this system made, at the beat that says they are rendered
   * and scored — the output, shown where the film is actually talking about
   * it, rather than a table where the output is implied to be.
   *
   * The PAUSE it was providing was real, though, and the film should not go
   * straight from "Only the calendar." into the ask. So b12 keeps it as
   * silence: the tail below is the old beat's breath without the dead shot
   * that was wasting it.
   */
  {
    id: 'b14', line: 'Send us a link. Watch your film tonight.',
    emphasis: 'tonight.',
    reason: 'CALL: the smallest possible ask, and the shortest possible wait.',
    tailSeconds: 1.2,
  },
];

/** What each beat looks like. The line says what it means; this says what it is. */
export const VISUALS: Record<string, BeatVisual> = {
  /*
   * THE AUDIT, replacing two atmosphere shots that both failed.
   *
   * Five directors watched the film independently and all five went for this
   * shot, converging on one diagnosis from five different lenses: the film
   * describes its mechanism instead of showing it operate. The opener was
   * using an ambient clip language, so "it opens your site" later arrived as a
   * claim over a mood, and the audit premise was never visible before the copy
   * explained it.
   *
   * A lamplit desk was tried and called "entirely generic". A blank cinema
   * screen was commissioned to a written brief specifically to fix that, and
   * came back "an incredibly generic stock projection screen". The outcome
   * memory has both on file, which is what stopped the revision room
   * proposing a third: "this is not another atmosphere shot; it performs the
   * audit verb."
   *
   * So the film opens on the page, square-on, and does to it what the system
   * does: underline what is there, pin it as evidence, strike what cannot be
   * proved. The line is unchanged — "Every company has a film it has not made
   * yet" — and the strike lands on "not made yet", so the picture performs the
   * absence the line names instead of illustrating a mood around it.
   */
  b1: {
    kind: 'audit', assetId: 'ast_home_hero',
    /*
     * The hero capture is 1580x680 — aspect 2.324 — so at full frame width it
     * occupies 0.765 of the frame's height. Centred at 0.44 it spans 0.057 to
     * 0.823, which leaves the caption band at 0.88 clear of it.
     *
     * Every coordinate below is that arithmetic, not a guess:
     *   frame y of a line = 0.057 + (its y within the image) * 0.765
     * "Directed." sits at 0.190 of the image, so 0.540 in frame, and runs from
     * x 0.153 to 0.493. The paragraph's second line sits at 0.884, so 0.734,
     * and runs from 0.153 to 0.790.
     */
    plate: { width: 1.0, centreY: 0.44 },
    // Under "Directed." — the claim the page actually makes.
    underline: { x: 0.153, y: 0.556, width: 0.34, at: 0.20 },
    // In the left margin, level with that line.
    pin: { x: 0.128, y: 0.540, at: 0.42 },
    // Through the paragraph's second line, on the emphasis.
    strike: { x: 0.153, y: 0.734, width: 0.637, at: 0.60 },
  },
  b2: { kind: 'statement', field: null },
  // Ember was nearly black on a near-black field: the loudest event in the
  // frame was a colour change nobody could see. Amber reads.
  b3: { kind: 'statement', field: '#FFB03A' },
  b4: { kind: 'mark' },
  b5: { kind: 'statement', field: null },
  b6: { kind: 'product', assetId: 'ast_home', window: { x: 0.03, width: 0.58, fromY: 0.02, toY: 0.34 }, holdIndex: 0 },
  b7: { kind: 'fields', colours: ['#1F6F4A', '#2B4B9B', '#FF4D1F'] },
  // The three real renders this system made, at the beat that says they are
  // rendered and scored. The claim becomes literal instead of illustrated.
  /*
   * The three real renders, now SCORED rather than merely counted.
   *
   * "It counts to three, and counting is not proving" — three directors said
   * versions of that independently, and one put it exactly: the panels "could
   * belong to any company with three brand colours". The beat's line is "Each
   * one rendered, watched, and scored before you see it", and nothing on
   * screen was doing the scoring.
   *
   * Lane two fails. One lane, not all three: a system that rejected everything
   * is not one anybody would buy, and the film's own claim is that it fails
   * its work first — not that the work is bad.
   */
  b8: {
    kind: 'films', assetIds: ['ast_dir_a', 'ast_dir_b', 'ast_dir_c'],
    colours: ['#1F6F4A', '#2B4B9B', '#FF4D1F'],
    verdicts: ['pass', 'fail', 'pass'],
  },
  b9: { kind: 'product', assetId: 'ast_how', window: { x: 0.06, width: 0.58, fromY: 0.30, toY: 0.06 }, holdIndex: 2 },
  b10: { kind: 'statement', field: null },
  b11: { kind: 'statement', field: '#FF4D1F' },
  b12: { kind: 'statement', field: null },
  b14: { kind: 'mark' },
};
