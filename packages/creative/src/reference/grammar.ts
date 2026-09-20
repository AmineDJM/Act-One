import { REFERENCE_BANDS, STAGGER_MS, STAGGER_SPAN_SECONDS } from '@act-one/core';

/**
 * The grammar of a premium product film, written for the systems that direct.
 *
 * This is not a description of four films. It is what was measured in them —
 * boundary rates, trajectory-fitted easing, camera/object separation, audio
 * layers and their offsets against element entries — turned into instructions
 * a director can follow. Nothing here is anybody's artwork: no composition, no
 * copy, no asset, no palette. Rates, ratios, curves and reasons.
 *
 * Every number in it can be re-derived by running scripts/analysis on the
 * films again, which is the only reason it is allowed to assert anything.
 */

const band = (b: { low: number; high: number }, unit = '') =>
  `${b.low}${unit}–${b.high}${unit}`;

/**
 * ART DIRECTION — one film, one world.
 *
 * The four references resolve into two strategies and no third. Either the
 * film holds ONE atmosphere for its whole length and changes register by
 * changing what is IN it, or it moves through a small number of full-frame
 * colour fields as chapters. Nobody gives each beat its own background.
 */
export const ART_DIRECTION_GRAMMAR = [
  'ART DIRECTION',
  '',
  'One film has one visual world. Two strategies were measured and there is no third:',
  '- Hold one atmosphere end to end and change register by changing what is in the frame.',
  '  A dark near-black world with a single warm accent; a light world with a soft gradient wash',
  '  and a faint drifting texture. The accent appears on the semantic payload of a line and',
  '  nowhere else.',
  '- Move through a small number of full-frame colour fields as chapters, keeping one type',
  '  system, one shape language and one product treatment across all of them.',
  '',
  'The accent is a scalpel. In the references it lands on the two or three words that carry the',
  'meaning of a sentence — never on the whole line, never on a whole panel. A line reads as',
  '"neutral neutral ACCENT ACCENT neutral" and the eye goes where the argument is.',
  '',
  'The product is freed from its chrome. No browser frame, no window furniture, no coloured card',
  'placed behind a screenshot. The relevant region of the real interface sits on the field with a',
  'soft shadow, cropped to what the beat is about, frequently tilted in perspective.',
  '',
  'Type is composed, not printed: two weights and two colours inside one line; words at different',
  'baselines before they settle; a small crisp label with an enormous pale ghost of the same words',
  'behind it; words allowed to run off the frame edge.',
].join('\n');

/**
 * MOTION — what moves, how, relative to what.
 *
 * The measurements that matter here are the easing distribution and the
 * stagger. Both are specific, both are cheap, and Act One is measurably wrong
 * on the first and under-uses the second.
 */
export const MOTION_GRAMMAR = [
  'MOTION',
  '',
  `Seven easing families are in use across the references, in roughly equal proportions: linear,`,
  `ease-out quad, ease-out cubic, ease-out quint, ease-in cubic, ease-in-out cubic, and overshoot.`,
  'A film that only eases out has only one gesture — arrival — and can then change only by cutting.',
  '',
  'THINGS MUST LEAVE. ease-in cubic is the single most common family in three of the four',
  'references. Elements accelerate out of frame, and the next idea occupies the space they left.',
  'This is what makes a boundary unnecessary.',
  '',
  `STAGGER: siblings enter ${band(STAGGER_MS, 'ms')} apart, over a span of`,
  `${band(STAGGER_SPAN_SECONDS, 's')}. Every reference, every element type. Three to eight items,`,
  'often arriving from different directions and settling onto a common line or radius. This is what',
  'makes a group read as separate objects rather than one image.',
  '',
  'MOTION BLUR IS REAL. Entering elements are genuinely blurred along their trajectory and sharp at',
  'rest. A cross-dissolve is not motion blur and does not read as mass.',
  '',
  'CAMERA AND OBJECTS ARE DIFFERENT TOOLS. Between a half and two thirds of the motion in the',
  'references is explained by a single camera move; the rest is objects moving independently of it.',
  `Between ${Math.round(REFERENCE_BANDS.parallaxShare.low * 100)}% and`,
  `${Math.round(REFERENCE_BANDS.parallaxShare.high * 100)}% of frames carry two depths moving at`,
  'different rates. A film that is only camera is a camera over a still.',
  '',
  'REST IS PART OF MOTION. After a long continuous move the picture stops dead and holds. The hold',
  'is the frame the viewer reads.',
].join('\n');

/**
 * TRANSITION — how a beat hands over.
 *
 * This is the section the whole analysis was for.
 */
export const TRANSITION_GRAMMAR = [
  'TRANSITION',
  '',
  'Before a hard cut, ask whether material already on screen can generate what comes next.',
  '',
  `Measured: the references make ${band(REFERENCE_BANDS.transformationsPerShot)} continuous`,
  'transformations for every hard cut. The weakest of them still transforms as often as it cuts.',
  '',
  'The mechanisms, all observed:',
  '- CAMERA CARRY. The camera keeps moving; one element exits the frame under its own acceleration',
  '  while the next arrives inside the same move. No boundary exists to be noticed.',
  '- OBJECT HANDOFF. An object survives and becomes part of the next idea. Worked example: a brand',
  '  mark is introduced alone, gains its wordmark, sheds the wordmark, shrinks into a small circular',
  '  icon, and that icon becomes the centre of the next scene’s diagram. Three ideas, no cut.',
  '- FIELD CHANGE. The background turns over from one colour to another underneath an object that',
  '  stays. The world changes; the anchor does not.',
  '- SCALE THROUGH. The frame pushes into a real interface for two seconds until the interface is',
  '  the whole frame and the previous composition is gone.',
  '- MORPH. Material becomes other material: a card becomes a chart, a rectangle becomes a panel.',
  '- MASK REVEAL. One element’s shape uncovers the next composition.',
  '',
  'A hard cut remains valid and must be a decision. What is never valid is a cut used because',
  'nothing was designed to carry over — that is the definition of a slide change.',
  '',
  `Transformations run ${band({ low: 0.27, high: 3.2 }, 's')}, with a median near half a second and`,
  'several per film that develop for two to three. A film whose transformations are all the same',
  'length has a mechanism, not a grammar.',
].join('\n');

/**
 * EDITING — where the units are.
 */
export const EDITING_GRAMMAR = [
  'EDITING',
  '',
  'Four boundaries, four different decisions, and only the first requires a discontinuity:',
  '- SHOT: the picture is replaced between one frame and the next.',
  '- SCENE: the world changes — a new field, a new place, a new register. Usually with no cut.',
  '- CREATIVE BEAT: same world, new idea. The elements are replaced, the line changes, the layout',
  '  reorganises. This is the unit a director works in.',
  '- TRANSFORMATION: material becomes other material. Maximum change, maximum continuity.',
  '',
  `Creative beats arrive at ${band(REFERENCE_BANDS.creativeBeatsPerMinute)} per minute — roughly`,
  'one new idea every 1.5 to 2.5 seconds — while hard cuts arrive at only',
  `${band(REFERENCE_BANDS.shotsPerMinute)} per minute. The rate of ideas is high and the rate of`,
  'cuts is low. Those are separate dials and confusing them is how a film becomes a slideshow.',
  '',
  `Films of this class run ${band(REFERENCE_BANDS.runtimeSeconds, 's')}. Duration follows the`,
  'communication problem: a product a viewer has never seen cannot be explained in twenty-five',
  'seconds, and pacing is not speed.',
  '',
  'Shot lengths vary widely inside one film — some beats under a second, some held for five.',
  'Uniform shot lengths are a metronome, and a metronome has no rhythm however fast it runs.',
].join('\n');

/**
 * SOUND — measured against the picture, not described.
 */
export const SOUND_GRAMMAR = [
  'SOUND',
  '',
  `IMPACTS ARE RARE. The references place ${band(REFERENCE_BANDS.impactsPerSecond, '/s')} sonic`,
  'impacts per second. A sound on every movement is the same as a sound on nothing.',
  '',
  `SYNC IS PARTIAL. A sonic mark lands within 80ms of only`,
  `${Math.round(REFERENCE_BANDS.soundLockShare.low * 100)}–${Math.round(REFERENCE_BANDS.soundLockShare.high * 100)}%`,
  'of element entries. The rest float free. A film in which every movement is locked to a sound is',
  'mechanical; the looseness is what makes the locked ones land.',
  '',
  'SOUND LEADS THE PICTURE ROUGHLY A THIRD OF THE TIME. In two references, sound anticipates the',
  'visual event on nearly half of all entries — the J-cut, at the scale of a single element.',
  '',
  `THERE IS A REAL PAUSE. Every reference holds at least ${REFERENCE_BANDS.longestSilenceSeconds.low}s`,
  `of genuine silence somewhere, and one holds ${REFERENCE_BANDS.longestSilenceSeconds.high}s.`,
  'Scattered gaps below the noise floor are not a pause. A pause is a decision the audience hears.',
  '',
  'THE SCORE HAS SECTIONS. Between seven and nineteen distinct musical sections per film: the',
  'soundtrack changes because the story changes, not on a timer.',
  '',
  'TEMPO IS CHOSEN. Two of the references sit near 130 BPM and two near 72–78. Both work. What does',
  'not work is a bed with no tempo the edit can be felt against.',
  '',
  'VOICE CARRIES THE ARGUMENT WHERE THERE IS ONE. The story-led reference is 38% voice by runtime.',
  'A film that explains an unfamiliar product with 7% voice is asking the picture to do work the',
  'picture cannot do alone.',
].join('\n');

/**
 * STORY — why scene N becomes scene N+1.
 */
export const STORY_GRAMMAR = [
  'STORY',
  '',
  'The story-led reference, deconstructed as it actually runs:',
  '',
  'PROBLEM, DRAMATISED IN THE PRODUCT’S OWN WORLD. It opens on a real message being composed and',
  'a cursor about to send it, then on the reply, which is a refusal. Not a claim about a problem:',
  'the problem happening.',
  '',
  'ESCALATION BY MULTIPLICATION. The same material is multiplied — one card, then three tilted in',
  'space, then a field of fifteen receding. The argument ("volume will not fix this") is made by',
  'the behaviour of the material rather than by a sentence about it.',
  '',
  'THE PIVOT IS THE BRAND MARK, AND IT IS A HANDOFF, NOT A CUT. The mark arrives alone, gains its',
  'wordmark, sheds it, shrinks to an icon, and that icon becomes the centre of the next diagram.',
  'The field turns from warm to white underneath it.',
  '',
  'CAPABILITY SHOWN AS ONE IDEA PER BEAT. Each beat states one thing and shows it: a form being',
  'filled, a node diagram assembling from real avatars, cards being scored, a sequence building.',
  'The headline for each beat is built in clauses over about a second rather than printed.',
  '',
  'PROOF AS A NUMBER, HELD BIG. A single figure in enormous type with real motion blur, running off',
  'the frame edge.',
  '',
  'THE ENDING RESOLVES THE THESIS. The last line is the film’s argument, earned by everything',
  'before it, with the mark and a single call to action. Not a logo and a chord.',
  '',
  'Every beat must answer: what happens, why it exists, what changes, what the viewer now',
  'understands, what they feel, and why the next beat must follow. A beat that cannot answer the',
  'last one is a slide.',
].join('\n');

/** The whole grammar, for a system that needs all of it at once. */
export const FILM_GRAMMAR = [
  ART_DIRECTION_GRAMMAR,
  MOTION_GRAMMAR,
  TRANSITION_GRAMMAR,
  EDITING_GRAMMAR,
  SOUND_GRAMMAR,
  STORY_GRAMMAR,
].join('\n\n');
