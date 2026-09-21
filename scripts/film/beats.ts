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
    tailSeconds: 0.5,
  },
  {
    id: 'b13', line: '',
    emphasis: null,
    reason: 'THE OUTPUT: the film that came back, wordless, because a hero moment that has to be labelled is not one.',
    tailSeconds: 3.4,
  },
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
   * Cropped, because the generated hand in the left of frame is deformed —
   * merged fingers, no separation — and it is the first thing in the film. A
   * model watching it named that before anything else: "the mangled hand
   * instantly ruins any suspension of disbelief". No metric would have found
   * it. Losing the left fifth costs some resolution and keeps the lamp, the
   * cup and the scattered paper, which is the shot anyway.
   */
  b1: { kind: 'clip', assetId: 'ast_before', sourceInSeconds: 0.15, crop: { x: 0.2, y: 0, width: 0.8, height: 1 } },
  b2: { kind: 'statement', field: null },
  // Ember was nearly black on a near-black field: the loudest event in the
  // frame was a colour change nobody could see. Amber reads.
  b3: { kind: 'statement', field: '#FFB03A' },
  b4: { kind: 'mark' },
  b5: { kind: 'statement', field: null },
  b6: { kind: 'product', assetId: 'ast_home', window: { x: 0.03, width: 0.58, fromY: 0.02, toY: 0.34 } },
  b7: { kind: 'fields', colours: ['#1F6F4A', '#2B4B9B', '#FF4D1F'] },
  b8: { kind: 'product', assetId: 'ast_work', window: { x: 0.03, width: 0.58, fromY: 0.26, toY: 0.02 } },
  b9: { kind: 'product', assetId: 'ast_how', window: { x: 0.06, width: 0.58, fromY: 0.30, toY: 0.06 } },
  b10: { kind: 'statement', field: null },
  b11: { kind: 'statement', field: '#FF4D1F' },
  b12: { kind: 'statement', field: null },
  b13: { kind: 'clip', assetId: 'ast_output', sourceInSeconds: 0.3 },
  b14: { kind: 'mark' },
};
