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
/*
 * BREATH IS WRITTEN INTO THE SCRIPT, because the engine will not invent it.
 *
 * "Lacks human breath" is the note every craft reading has landed on, and no
 * voice setting produces it: stability and expressiveness change how a line is
 * coloured, not where the narrator stops to think. An ellipsis does — the
 * engine reads it as a real pause, and on v3 it is converted to an explicit
 * one.
 *
 * Placed where a person would actually stop, not evenly: after "a film" in the
 * hook, because that is the thought arriving; before "Six weeks", because a
 * number lands harder after a gap; nowhere in b4 or b11, which are the two
 * beats that are meant to be flat and certain.
 *
 * The subtitles do not need updating and could not drift if they did: they are
 * generated from the word timings of the performance itself, so a line that is
 * read with a pause is captioned with that pause already in it.
 */
export const BEATS: AvBeat[] = [
  {
    id: 'b1', line: 'Every company has a film... it has not made yet.',
    emphasis: 'not made yet.',
    // The hook is told to one person, not announced. It is the quietest thing in the film and it has to earn the next forty seconds.
    intent: 'confide',
    reason: 'HOOK: name the thing the viewer already knows about themselves.',
    leadSeconds: 0.4, tailSeconds: 0.5,
  },
  {
    id: 'b2', line: 'You know what it should say. You have said it... a hundred times.',
    emphasis: 'a hundred times.',
    // Still close: this is the viewer being recognised, not informed.
    intent: 'confide',
    reason: 'RECOGNITION: the idea is not the missing part, so the film cannot be about having ideas.',
    tailSeconds: 0.4,
  },
  {
    id: 'b3', line: 'Then it becomes a project... Six weeks before a single frame exists.',
    emphasis: 'Six weeks',
    // The cost, said plainly. A number oversold is a number disbelieved.
    intent: 'state',
    reason: 'THE COST, named. This is the number the whole film argues with.',
    tailSeconds: 0.5,
  },
  {
    id: 'b4', line: 'This is Act One.',
    emphasis: 'Act One.',
    // The film naming itself. Flat and certain on purpose — this is where monotone is the RIGHT choice.
    intent: 'land',
    reason: 'BRAND: the shortest beat so far, because it is the most certain.',
    tailSeconds: 0.6,
  },
  {
    id: 'b5', line: 'No brief. No kickoff call.',
    emphasis: 'No brief.',
    // The mechanism starts. The film gets faster here and stays faster for the middle.
    intent: 'press',
    reason: 'STEP ONE, by what it removes rather than what it adds.',
    tailSeconds: 0.3,
  },
  {
    id: 'b6', line: 'It opens your site like a customer would, and takes what is actually there.',
    emphasis: 'actually there.',
    // Still pressing: what it does, in order, without pausing to admire it.
    intent: 'press',
    reason: 'STEP ONE SHOWN: the real interface, travelled through.',
    tailSeconds: 0.4,
  },
  {
    id: 'b7', line: 'Not one safe idea. Three.',
    emphasis: 'Three.',
    // The count. Fast, because the three is the point rather than the counting.
    intent: 'press',
    reason: 'STEP TWO: three directions, and the frame divides on the word.',
    tailSeconds: 0.5,
  },
  {
    id: 'b8', line: 'Each one rendered, watched, and scored before you see it.',
    emphasis: 'before you see it.',
    // Back to plain speech for the claim that has to be believed.
    intent: 'state',
    reason: 'STEP TWO SHOWN: the work is judged by the system before the customer judges it.',
    tailSeconds: 0.4,
  },
  {
    id: 'b9', line: 'Contrast, loudness, timing. It fails itself first.',
    emphasis: 'fails itself first.',
    // The checks, named. Specific enough that colouring them would sound like selling.
    intent: 'state',
    reason: 'STEP THREE: the checks, named specifically enough to be believed.',
    tailSeconds: 0.5,
  },
  {
    id: 'b10', line: 'Six weeks is thirty working days — and most of them are waiting.',
    emphasis: 'waiting.',
    // The argument, pushed: thirty days and most of them are nothing.
    intent: 'press',
    reason: 'THE ARGUMENT: the six weeks are not work, which is why they can go.',
    tailSeconds: 0.5,
  },
  {
    id: 'b11', line: 'Take the waiting out.',
    emphasis: 'Take the waiting out.',
    // THE TURN. The shortest line in the film and the one it is about. Everything slows.
    intent: 'land',
    reason: 'THE TURN. The shortest line in the film, and the one it is about.',
    tailSeconds: 0.7,
  },
  {
    id: 'b12', line: 'Nothing about the work gets cheaper. Only the calendar.',
    emphasis: 'Only the calendar.',
    // The benefit and the objection in one breath, unhurried.
    intent: 'state',
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
    id: 'b14', line: 'Send us a link... Watch your film tonight.',
    emphasis: 'tonight.',
    // The ask. The only place the film addresses you directly, and the only warm one.
    intent: 'invite',
    reason: 'CALL: the smallest possible ask, and the shortest possible wait.',
    tailSeconds: 1.2,
  },
];

/**
 * The claim the film pins and then rejects.
 *
 * VERBATIM from the hero copy on the real page — "develop three creative
 * directions" — because a receipt the film invented would be the one thing
 * this system must never do. It is pinned at b6 when the film says it takes
 * what is actually there, carried through the three directions and the
 * scoring, and struck at b9 on "fails itself first".
 *
 * That is the whole audit in one object: read, kept, tested, rejected.
 */
const RECEIPT = { text: 'develop three creative directions' } as const;

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
    marks: [
      // Under "Directed." — the claim the page actually makes.
      { kind: 'rule', x: 0.153, y: 0.556, width: 0.34, at: 0.20 },
      // In the left margin, level with that line.
      { kind: 'tag', x: 0.128, y: 0.540, at: 0.42 },
      // Through the paragraph's second line, on the emphasis.
      { kind: 'strike', x: 0.153, y: 0.734, width: 0.637, at: 0.60 },
    ],
  },
  b2: { kind: 'statement', field: null },
  /*
   * A WHITE FRAME FOR THE COST, not a yellow one.
   *
   * Ember was nearly black on a near-black field — the loudest event in the
   * frame was a colour change nobody could see — so this became amber, and
   * amber read. Then the film got darker and more consistent around it: two
   * beats are now locked plates on ink, and against that a full yellow frame
   * was named the worst moment in the film, "visually harsh", abruptly
   * breaking the established palette.
   *
   * The rupture is not the problem; the same reading praised the tricolour
   * split for exactly that. The problem is that amber belongs to nothing else
   * here. Paper does: it is the film's own second colour, it is the hardest
   * possible cut from ink, and a white frame under "Six weeks before a single
   * frame exists" is the cost arriving as a blank — which is what six weeks of
   * calendar with no film in it actually is.
   *
   * It also gives the film a colour argument rather than a set of accents:
   * dark, white for the cost, tricolour for the three directions, accent for
   * the turn. The accent stays spent on one beat, which is what keeps it loud.
   */
  b3: { kind: 'statement', field: '#F4F2EC' },
  b4: { kind: 'mark' },
  b5: { kind: 'statement', field: null },
  /*
   * WHERE THE RECEIPT IS TAKEN.
   *
   * The line is "It opens your site like a customer would, and takes what is
   * actually there," and this was a marketing page drifting past underneath
   * it — two directors called it "asserts the product reads an actual site,
   * but shows an abstraction". Taking something is a visible act: the film
   * underlines one real phrase on the real page and pins it, and that phrase
   * does not leave for the next fifteen seconds.
   *
   * Same hero plate as the opening, at the close scale, so the geometry is the
   * arithmetic already established: y = 0.057 + fy * 0.765 at plate width 1.0.
   * The paragraph's second line, which is where the phrase lives, sits at
   * 0.734.
   */
  b6: {
    kind: 'audit', assetId: 'ast_home_hero',
    plate: { width: 1.0, centreY: 0.44 },
    marks: [
      // Underlined, then pinned: read, and kept.
      { kind: 'rule', x: 0.153, y: 0.752, width: 0.637, at: 0.34 },
      { kind: 'tag', x: 0.128, y: 0.734, at: 0.62 },
    ],
    receipt: RECEIPT,
  },
  // The receipt stays on screen: these three directions are what that pinned
  // phrase turned into, and the film has to let the viewer see the link.
  /*
   * Three directions, named and set three different ways.
   *
   * These are the real three this system developed while choosing the look of
   * this very film — paper, depth, field — and each label is set the way its
   * direction sets things: one quiet and tracked, one large and declarative,
   * one between. Three colours differ in hue and nothing else; three
   * typographic registers differ in the thing a creative direction actually
   * is.
   */
  b7: {
    kind: 'fields', colours: ['#1F6F4A', '#2B4B9B', '#FF4D1F'],
    labels: [
      { text: 'Paper', token: 'mono', scale: 1.0 },
      { text: 'Depth', token: 'display', scale: 0.62 },
      { text: 'Field', token: 'statement', scale: 0.8 },
    ],
    receipt: RECEIPT,
  },
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
    /*
     * One shown, three scored. Lane 2 is the field direction, and it is the
     * one worth inspecting: a craft reading called lane 0's nested cards
     * "illegible grey text on white, lacking contrast", which is true of that
     * render rather than of the framing around it. No amount of composition
     * rescues a weak source — this one sets one bold word on near-black, which
     * survives being looked at.
     */
    focus: 2,
    receipt: RECEIPT,
  },
  /*
   * THE CHECKS, PERFORMED — because naming them was the problem.
   *
   * This beat says "Contrast, loudness, timing. It fails itself first," and it
   * was a screenshot of a marketing page travelling past while the voice
   * listed three things. Two directors called it "telling instead of showing";
   * the inspector had it 95% the same picture as b6 and 8% off the right edge
   * at the same time, which is a beat that was neither saying anything nor
   * framed.
   *
   * So the three checks are three rules, landing one per named check, and then
   * the film strikes its own page on "fails itself first". This is the same
   * grammar as the opening, which is the point: the Round 1 thesis asked for
   * pin, measure and strike to recur across the film rather than be a device
   * used once.
   *
   * AN EVIDENCE-CLOSE, not a second wide read. The opening looks at a whole
   * page; this one is inside one. The plate is 1.25x the frame and pushed to
   * x 0.5275 so the TEXT COLUMN is centred rather than the image — a zoomed
   * plate centred on the picture puts its left margin off the screen.
   *
   * The capture is 1876x626, aspect 2.997, so at 1.25 it is 0.742 of frame
   * height and spans 0.069 to 0.811. A line at image-fraction fy sits at
   * 0.069 + fy * 0.742, and its x is 0.5275 + (fx - 0.5) * 1.25.
   */
  b9: {
    kind: 'audit', assetId: 'ast_how_stages',
    plate: { width: 1.25, centreY: 0.44, centreX: 0.5275 },
    marks: [
      // Contrast, loudness, timing — one rule per check, each landing as its
      // check is named.
      /*
       * Below the baseline, not on the text's centre.
       *
       * These were computed to the line's vertical CENTRE and drew straight
       * through the words. A rule that crosses what it marks is a strike, and
       * this film has a strike already; the two must not be the same gesture.
       * Measured off a locked frame: the headline baselines sit at 0.400 and
       * 0.523, so the rules clear them at 0.412 and 0.535.
       */
      { kind: 'rule', x: 0.059, y: 0.412, width: 0.671, at: 0.08 },
      { kind: 'rule', x: 0.059, y: 0.535, width: 0.588, at: 0.20 },
      { kind: 'rule', x: 0.059, y: 0.650, width: 0.882, at: 0.32 },
    ],
    /*
     * THE STRIKE MOVED TO THE RECEIPT, and that is the point of the whole
     * sequence. It used to cross a line of copy on this page — a rejection of
     * something the film had never asked the viewer to care about. "It fails
     * itself first" means the system rejects ITS OWN pinned claim, so the
     * thing struck is the phrase it took at b6 and carried ever since.
     *
     * Three rules for three checks, and then the claim they were applied to
     * goes. Read, kept, tested, rejected — one object, four beats.
     */
    receipt: { ...RECEIPT, struck: true },
  },
  b10: { kind: 'statement', field: null },
  b11: { kind: 'statement', field: '#FF4D1F' },
  b12: { kind: 'statement', field: null },
  b14: { kind: 'mark' },
};
