# Convergence log

One row per render. The gaps are measured against the three benchmark films
with `scripts/analysis/profile.py`, which runs the same instrument over all
four, and read by Gemini watching the real MP4. Neither is a target — they say
where to look.

## Benchmark profile (the bar)

| metric | ref 1 | ref 2 | ref 3 |
|---|---|---|---|
| duration | 88.6s | 77.5s | 70.8s |
| cuts/min | 16.3 | 7.7 | 2.5 |
| shot median | 3.2s | 5.4s | 1.25s |
| motion mean | 0.83 | 0.92 | 0.86 |
| motion p90 | 1.71 | 2.66 | 2.25 |
| static share | 0.25 | 0.13 | 0.15 |
| scale variation | 0.71 | 0.91 | 0.66 |
| novelty | 0.27 | 0.19 | 0.09 |
| distinct hues | 6 | 8 | 7 |
| luma mean | 0.32 | 0.82 | 0.92 |
| luma range | 0.80 | 0.86 | 0.12 |
| audio accents | 44 | 168 | 126 |
| audio dynamic range | 0.28 | 0.80 | 0.54 |

Two completely different grammars sit in that table and both are premium. Ref 1
cuts 24 times and swings hard between dark and light. Ref 3 cuts **three times
in seventy seconds** — it is one space the camera travels through. There is no
single correct set of numbers; there is a range outside which a film is
obviously weaker, and the first cut of ours sat outside it on three axes.

---

## Iteration 1 — `launch.mp4`, 52.3s, 10 shots

**Measured against the bar:**

| metric | ours | bar | verdict |
|---|---|---|---|
| motion p90 | **0.61** | 1.71–2.66 | **3–4x too little** |
| static share | **0.51** | 0.13–0.25 | **half the film is a still picture** |
| shot median | **9.3s** | 1.25–5.4s | **shots hold roughly twice as long as the slowest reference** |
| audio accents | **3** | 44–168 | **15–50x too few** |
| distinct hues | **3** | 6–8 | monochrome |
| scale variation | 0.69 | 0.66–0.91 | in range |
| novelty | 0.22 | 0.09–0.27 | in range |
| luma range | 0.80 | 0.12–0.86 | in range |

**Top three gaps, in order of how visible they are:**

1. **The film barely moves.** A camera travelling 1.04x over six seconds moves
   a fifth of a percent per frame, which is below what anyone can see. It is a
   static shot with a note in the graph claiming otherwise.
2. **There is no sound design.** Ten cues across fifty-two seconds, one per
   scene, and a dynamic range of 0.28 against 0.54–0.80.
3. **Every shot is the same length.** Six seconds each, which reads as a
   sequence of slides however good each slide is.

**Root causes.** All three are authoring, not engine. `camera.x`, `camera.y`,
`camera.scale` and every object transform were already animatable; the film
never asked them for anything. Objects faded in and sat. Nothing entered or
left frame. Nothing was cut short because the next thing was better.

**Changes made:** real camera travel on every shot (scale 1.0→1.3, x across
±0.13 of frame rather than ±0.01); objects arriving from outside the frame;
the how-it-works act split so each step is a short title beat plus a
travelling product shot; shot lengths varied deliberately from 1.8s to 5.2s;
audio events per scene raised from one to three-to-six, placed on actual
events; fifteen shots instead of ten.

**What QA caught in the process, and the lesson.** A travelling camera moves
everything — six payload objects that were comfortably inside the frame with a
static camera were carried out of it. And short shots need short lines: five
reading-time failures, all of them copy written for a six-second hold being
shown for two. The references are narrated, so their voice carries the detail
and their screen carries a label. Ours has no voice, so the lines had to get
shorter rather than the shots getting longer.

**Evidence from the next render:** below.

---

## Iteration 2 — 56.4s, 15 shots

**Evidence from the render:**

| metric | it 1 | it 2 | bar | verdict |
|---|---|---|---|---|
| motion p90 | 0.61 | **1.77** | 1.71–2.66 | **in band** |
| motion mean | 0.37 | 0.63 | 0.83–0.92 | closer, still low |
| static share | 0.51 | 0.36 | 0.13–0.25 | improved, still high |
| audio dynamic range | 0.28 | **0.63** | 0.28–0.80 | **in band** |
| novelty | 0.22 | **0.29** | 0.09–0.27 | **above all three** |
| scale variation | 0.69 | 0.75 | 0.66–0.91 | in band |
| audio accents | 3 | 11 | 44–168 | still 4–15x short |
| distinct hues | 3 | 3 | 6–8 | unchanged |

Motion was the right call and it worked. What did not move: sound density
and palette.

**Read (Gemini, on the file):** *"Relies heavily on generic SaaS motion
graphics (dark backgrounds, floating UI, subtle zooms)."* Hero moment
confirmed again at the measure collapse. It also reported *"UI elements are
frequently clipped by frame edges (0:08, 0:19, 0:25, 0:31)"*.

**That claim was checked and it is wrong** — those four timecodes contain no
UI at all. But they point at the right shots for the wrong reason: they are
the three step-title beats and the pain line, and what is actually wrong with
them is that they are **three-quarters empty**. One short line on the left and
two-thirds of a cream field doing nothing. A critic being inaccurate about a
detail while being right about which shot is weakest is worth more than a
critic that says nothing.

**Top three gaps:**

1. **The product is always a floating card.** Every appearance is a rectangle
   with a screenshot on it, tilted, on a field — which is the exact thing
   Gemini named. The references treat the interface as a PLACE: "camera pans
   down to new UI layout", "camera zooms into white space of a message".
2. **The title beats are empty frames.** Three of fifteen shots are dead
   space with a caption.
3. **Audio accents 11 against 44–168.**

**Root causes:**

1. `crop` has been animatable since the scene language was written, and a crop
   that moves is a camera INSIDE the capture. It had never been used once.
2. Those scenes contain two objects on a full frame. Nothing else was authored
   into them.
3. Not the cues — there are thirty. `musicCharacter: 'restrained'` matches
   none of the director's word list, falls through to `sub_tonal`, and selects
   a 72bpm ambient pad. A pad has no accents in it, so the only things the
   meter could hear were the impacts.

**Changes:** two of the three product shots now travel through the page
full-bleed via an animated crop, with the third deliberately left as a held
card so the act does not become the same shot three times; the page each step
lands inside now slides into its title beat from the frame edge, so the cut is
a continuation rather than a surprise; the music bed is `percussive`.

---

## Iteration 3/4 — 57.1s, 15 shots

**Evidence — the film is now inside the reference band on almost everything:**

| metric | it 1 | it 2 | it 4 | bar | verdict |
|---|---|---|---|---|---|
| motion mean | 0.37 | 0.63 | **0.89** | 0.83–0.92 | **in band** |
| motion p90 | 0.61 | 1.77 | **2.44** | 1.71–2.66 | **in band** |
| cuts/min | 4.6 | 3.2 | **7.4** | 2.5–16.3 | **in band** |
| shot median | 9.3 | 12.5 | **4.6** | 1.25–5.4 | **in band** |
| audio accents | 3 | 11 | **48** | 44–168 | **in band** |
| audio dynamic | 0.28 | 0.63 | **0.59** | 0.28–0.80 | **in band** |
| luma range | 0.80 | 0.86 | **0.86** | 0.12–0.86 | **in band** |
| novelty | 0.22 | 0.29 | **0.31** | 0.09–0.27 | above all three |
| static share | 0.51 | 0.36 | 0.275 | 0.13–0.25 | marginally out |
| scale variation | 0.69 | 0.75 | 0.63 | 0.66–0.91 | marginally out |
| **distinct hues** | 3 | 3 | **3** | **6–8** | **the remaining gap** |

The music change accounted for nearly all of the audio movement: 11 accents
to 48 from one word. Motion and rhythm are now indistinguishable from the
references by this instrument.

**Top three gaps:**

1. **Captions land on live product content.** A caption at a fixed point over
   a full-bleed interface sits on whatever the interface has there — and once
   the camera travels, that changes every frame. Three shots had white type on
   the product's own white type.
2. **Three distinct hues against six to eight.** The only metric still clearly
   outside the band.
3. **The work window cut its own headline** at the end of its travel.

**Root causes and fixes:**

1. No scrim, and a caption pinned to the page margin that the camera then
   carried away from the band meant to protect it. Captions now sit on a band
   — a shape and a text object, both of which already existed. The band is
   authored from the object list rather than built into the `text` primitive,
   because a scrim is a composition decision and burying it there would make
   every caption in every film wear one.
2. **Answered by the script rather than by decoration.** The wrong fix is to
   tint things. The right one was already in the copy: the beat says "three
   directions" and said it over an empty cream field. It now SHOWS three, as
   three colour fields arriving in turn. It is the only place in the film
   where colour is the subject, which is what lets the restraint everywhere
   else read as a choice.
3. The window's end position, moved to land on whole content.

---

## Iterations 5–7 — the audio, and a pile instead of a constellation

**Three instruments produced confident wrong numbers in this stretch**, and
each would have sent somebody to fix something that was not broken. They are
recorded here because the pattern matters more than any one of them.

1. `sync_check` reported the master at **+0.37 dBFS — apparently clipping**.
   It folds to mono for onset detection, which SUMS the channels. The file
   peaks at −1.98 and was never near the ceiling.
2. The profiler reported the film **58% silent**. `silentShare` normalises by
   the film's own loudest second, so one hard impact drags every other second
   below the threshold.
3. `bedRms` said the music bed was three times quieter than the references
   even after the mix was demonstrably balanced. Printing the design settled
   it: cues at −11 dB under a −8 dB bed, three decibels BELOW it. The metric
   was reporting the music's character — a 124bpm percussive track has space
   between its hits, so its median at a tenth of a second falls in the gaps.

**One real audio finding survived all that.** The bed sat at −13 dB, which is
where a bed goes when a voice has to be heard over it, applied to a film with
no voice. A first fix made the level depend on `hasVoiceOver` and a test
caught it — the bed used to drop to −18 for the whole film the moment there
was narration, and the sidechain is what makes room dynamically. The test was
right. Raising the single unconditional level to −8 dB respects it.

Audio now: meanRms 0.19 against reference 1's 0.1916, 66 accents against
44–168, dynamic range 0.65 against 0.28–0.80.

### Confirmation passes A and B disagreed

| | pass A | pass B |
|---|---|---|
| boundaries | 11 | 12 |
| beats | 10 | 3 |
| hero moments | 1 | **2** |
| confusions | **none** | one, at 10s |

Pass B added the opening desk shot as a second hero — *"Strongest moment.
Establishes a premium, unexpected mood for a B2B software film"* — and also
returned the criticism that had been absent from pass A: *"relies on generic
SaaS tropes (floating UI, subtle zooms)... making it feel like a template"*,
pointed at ten seconds.

**Two passes that disagree are not two clean passes, so this is not
convergence.** The note is also correct: at ten seconds four screenshots were
hovering across the frame at even intervals, each turned a different way,
which is the single most recognisable gesture in automated software video. It
is also nothing like what that shot is about — pages accumulating on the desk
the film has just opened on. They are a pile now: overlapping, landing heavily
on one another, sharing a shallow angle the way a real stack does.

**My own error in the same pass:** the design-printout run rendered at preview
quality and overwrote the master, so pass B read a 960x540 file. Re-rendered
at 1920x1080.

---

## Loop: the voice, and what the film sounds like

**The change.** The film had no narration because the ElevenLabs credential is
rejected. It is reachable through Runway, which has a working one, so the
script is read by `eleven_v3` and the mix ducks the bed under it with the
sidechain that was already in the graph.

The blocker was never the credential. It was three wrong guesses about the
request shape, all of which the vendor's published OpenAPI document settled in
one request after twenty-eight probes had found nothing:

| sent | wanted |
| --- | --- |
| `voice: { id }` | `voice: { type: 'runway-preset', presetId }` |
| `promptInstruction: "<brief>"` | no such field — `speed`, `stability`, `style` |
| any name | one of 49 presets, listed only inside a 400 |

The second mattered most. The performance brief this system writes was being
dropped silently on every read, so the engine looked undirectable. Measured
after the fix: the same line runs 3.55s undirected and 2.77s at speed 1.06.

**What it did to the numbers.** Every audio metric moved inside the benchmark
band, and none was inside it before:

| metric | before | after | benchmark band |
| --- | --- | --- | --- |
| audio.meanRms | 0.19 | **0.294** | 0.192 – 0.426 |
| audio.accents | 66 | **110** | 44 – 168 |
| audio.dynamicRange | 0.65 | **0.556** | 0.277 – 0.804 |
| audio.silentShare | — | **0.180** | 0.027 – 0.222 |

The read measures 158 wpm against the reference's ~160. The narrator was
auditioned rather than picked: six preset voices read the opening line, and the
other five came back between 208 and 238 wpm.

**What the references actually do with sound**, now that all three have been
read rather than assumed. They do not agree about narration — target1 is
carried by a French voice for its whole 87s, target2 has none at all, target3
has 8.5s of internal monologue and then music. They agree completely about
effects: **every single one is attached to a visible event.** Coins clinking on
falling coins, fire sizzling on burning text, a toggle click on a toggle, ticking
on a rolling counter, a chime on a completed scan. Ours are attached to cuts and
entrances, which is the same idea held more loosely.

## Loop: nine of fifteen shots were frozen pictures

**The measurement that found it.** Whole-film `staticShare` sat at 0.303 against
a 0.132–0.254 band and would not move. Measuring it per shot showed it was not
spread across the film at all:

| frozen (>85% of frames static) | moving |
| --- | --- |
| l1 91.6%, l2 99.3%, l4 99.0%, l7 87.0%, l11 83.9%, l12 89.5%, l13 99.2%, l14 98.9%, l15 99.1% | l3 49.7%, l5 29.9%, l6 43.1%, l8 55.5%, l9 27.1%, l10 10.9% |

The film opened frozen and ended frozen, on three consecutive still pictures.

**The root cause, which is one line of the camera helper.** Every frozen shot
used `curve: 'out_expo'`. That curve spends about 95% of its travel in the first
fifth of the shot and then holds — so the camera arrives and the picture stops.
Every moving shot used a curve that travels the whole span. The second cause sat
on top of it: the amplitudes were small enough that even the moving part fell
below the threshold at which anything reads as motion, and every camera scale in
the film sat between 1.0 and 1.34, which is the `scaleVariation` gap in the same
numbers.

**What the guard caught.** Widening the scale range refused to render: four
shots' text boxes went off-frame, then two more from the *pan* rather than the
zoom, then l7 whose line is anchored left at x=0.09, so scaling about the centre
walks its left edge outward and a negative camera x finishes the job. A camera
scale magnifies the type with the picture. So the scale arc now reaches for its
range by pulling BACK — 0.86 at the widest — where a line only gets safer.

**Not yet verified.** The previous claim of this kind was wrong: I predicted an
entrance fix would move `staticShare` and it did not move at all, while
`scaleVariation` regressed. The render measuring this one is still running, and
nothing here is settled until it lands.

## Standing blocker

The independent OpenAI critic has returned HTTP 429 "no credits remaining" on
every attempt for several loops. Two-pass confirmation with a *second* model is
part of the acceptance criteria and cannot currently be met — Gemini agreeing
with Gemini is one opinion twice. **User action required: top up the OpenAI
account, or name another vision model to use as the second critic.**

## What the film itself is still doing wrong

From a native read of the narrated master, and more important than any metric:

1. **It never shows its own output.** *"Viewer never sees the actual output (the
   generated film), only the ordering interface."* A film about making films
   that only ever shows the order form. Hero moments: 0.
2. **The named failure mode, named back to us.** *"Visuals lean heavily on
   generic dark-background SaaS tropes (floating UI, centered text), saved
   primarily by pacing and audio sync."* That is close to verbatim the grammar
   the brief said not to collapse into.
3. **UI cards clipped at frame edges** at 0:07, 0:17 and 0:31 — which our own
   inspector also reports, as `object_outside_frame` soft-fails on l3, l5, l9
   and l10.

---

## Loop: casting, and what auditioning against the picture found

**The mechanism.** Voice was a constant in a provider file, so `VoiceDirection`
— which already carries gender, age impression, register, energy, pace and an
emotional arc — decided nothing. Casting now closes that chain: direction →
target on measured scales → ranked candidates → a shortlist of *materially
different* voices → performance settings in the vendor's units.

The catalogue had to be built by listening, because the vendor publishes
nothing about its 49 presets. 28 cards were collected before the account hit
its daily task limit.

**The finding that justifies the whole approach.** Auditioned against the
picture rather than as a WAV, the voice currently in the film scores **3.88 out
of 10**:

| criterion | score |
| --- | --- |
| semanticAuthority | 3 |
| naturalness | 3 |
| emotionalFit | 4 |
| rhythmAgainstEdit | 4 |
| intelligibilityOverMusic | 6 |
| pausesMatchEdit | 4 |
| emphasisMatchesTypography | 4 |
| soundsLikeAdvertising (0 is best) | 7 |

> "The voiceover is aggressively robotic and completely undermines the modern
> visual style. It lacks human nuance, pacing, and appropriate inflection,
> resulting in a cheap, disjointed final product."

**The catalogue said the opposite.** Judged as an isolated clip, this voice
scored `soundsLikeTts: 1` — the most human in the catalogue. Judged against the
cut it scores 3 for naturalness. Isolated-clip characterisation is useful for
building a shortlist and is NOT predictive of a read, which is the entire
argument for auditioning against picture.

**My own error, and it is a directing error rather than a casting one.** The
weakest moment is named precisely: at 32 seconds, *"the sudden burst of
artificial enthusiasm feels entirely disconnected from the sleek, restrained
visual aesthetic."* I directed `energy: high`, which drives style exaggeration
to 0.45–0.5, because the REFERENCE read is high-energy at 160 wpm. But the
reference's picture is fast, saturated and aggressive; ours is dark, editorial
and restrained. I cast the voice for somebody else's film.

Two corrections follow, and both need vendor quota that is currently exhausted:

1. **Re-direct**: lower energy and style, raise intimacy. The film wants a
   confiding read, not a pitch.
2. **Re-cast**: the current voice scores 2/10 for intimacy — the lowest useful
   value for a film that should feel close. `Grungle` (authority 9, intimacy 6,
   energy 5, *"measured, confident, slightly gravelly, experienced"*) fits this
   picture far better on the scales; `Chad` and `Billy` are the other two
   materially different candidates.

Nothing has been changed in the read yet, deliberately: the cached takes are
keyed on the direction, so revising it invalidates all fourteen and the next
render would fail on quota rather than produce a worse film.

## Standing blockers

1. **Runway daily task limit reached.** Blocks the four-voice audition (56
   reads) and the re-read under a corrected direction. Resets on the vendor's
   schedule. *User action: none required beyond waiting, unless the account's
   daily limit can be raised.*
2. **OpenAI critic returns 429 "no credits remaining"**, every attempt, for
   several loops. Two-pass confirmation with a *second* model is an acceptance
   criterion and cannot be met — Gemini agreeing with Gemini is one opinion
   twice. *User action: top up the OpenAI account, or name another vision model
   to use as the second critic.*

---

## Loop: the film shows its output

**The note this answers.** A model watching the finished film put one thing
above every metric: *"the viewer never sees the actual output (the generated
film), only the ordering interface."* Hero moments: 0. A film about making
films that only ever showed the order form.

**What was commissioned.** The opening shot twelve hours later. The film begins
on a desk at dusk, cluttered, somebody pushing back from it after too long a
day; `l13b` is the same desk at dawn, cleared, low sun crossing the grain, the
camera pulling back where the opening pushed in. The opening is the six weeks
and this is the afternoon.

Wordless and full-bleed on purpose. Everything around it is composed — type on
a field, captures on a plane — and this is the only thing in the film that
looks photographed. A hero moment that has to be labelled is not one.

The product rule is why it is a room and not a timeline: `checkBrief` rejects a
brief that commissions an interface, and the negative prompt forbade one
explicitly. A model may build the world the product lives in. The output of
this product is a piece of film, so a piece of film is what was commissioned.
Higgsfield, Seedance 2.5, $1.849, estimate printed before anything was spent.

**Two corrections the brief could not anticipate**, both found by looking at
the file rather than by measuring it. It came back at 1280x720 against a 1080p
film, so the clip was narrowed from 1.25 to 1.12 — every extra tenth of width
is more upscale on the one shot meant to look photographed, and the camera only
ever shows 1.04 of content. And the source window ended before the wood was
fully lit, throwing away the resolution the whole four seconds builds to.

**Where the film stands**, 61.4s, 16 shots, 5 of 11 metrics inside the band:

| metric | ours | band | |
| --- | --- | --- | --- |
| audio.meanRms | 0.296 | 0.192 – 0.426 | in |
| audio.dynamicRange | 0.533 | 0.277 – 0.804 | in |
| audio.accents | 112 | 44 – 168 | in |
| audio.silentShare | 0.160 | 0.027 – 0.222 | in |
| motion.p90 | 2.206 | 1.706 – 2.657 | in |
| motion.mean | 0.929 | 0.833 – 0.919 | over by 1% |
| motion.staticShare | 0.124 | 0.132 – 0.254 | under by 6% |
| luma.range | 0.863 | 0.120 – 0.859 | over by 0.5% |
| novelty | 0.314 | 0.093 – 0.272 | over |
| distinctHues | 5 | 6 – 8 | **short** |
| scaleVariation | 0.563 | 0.657 – 0.908 | **short** |

Four of the six misses are OVERSHOOTS — the film is now marginally more
dynamic than the references rather than failing to reach them, which is a
different fault and a smaller one. Only `distinctHues` and `scaleVariation`
are genuine shortfalls.

**What the remaining static shots actually are.** `l15` has a real camera move
and still measures 98% static, while `l1` with a comparable move measures 0%.
The difference is not the camera: `l1` holds footage and `l15` is a near-black
frame with two lines of type, and optical flow needs texture to find. So
`staticShare` on those shots, `distinctHues`, and the critic's "dark-background
SaaS tropes" are one problem wearing three faces — five or six shots are nearly
empty dark frames with type on them. Camera work cannot fix that. Only content
can, which is what `l13b` and the colour field are.

---

## Reading after the output shot and the three direction films

A deep reading finally landed after four 502s and one malformed-JSON answer
from the broad-pass fallback. What it says:

| | before the output shot | now |
| --- | --- | --- |
| hero moments | 0 | **1** (the timeline compressing, 37–45s) |
| beats | 3 | 4 |
| comprehension clear by | 45s | 15s |

**Two attempts at the output note, and NEITHER closed it.** First a
commissioned cinematic shot (`l13b`, the opening desk at dawn). Then the three
real direction films this system made, playing at the "Three directions" beat.
The note survives both:

> at 60s — "The film lacks examples of the actual output films, which a
> benchmark launch film would include."

Worth reading carefully rather than as a repeat. It is anchored at **60s**, the
end of the film, and the reading's own limitations call the direction films "UI
mockups" — it cannot read their small text, so it does not see them as films at
all. They are 26% of frame, for 2.6 seconds, as support under a title. And
`l13b` reads as cinematic live-action rather than as an output.

So the lesson is about placement and scale, not about whether real footage
exists: a benchmark launch film shows what you GET, large, at the end, as the
payoff. This film shows it small, in the middle, as evidence.

**The most persistent note in the whole project has not moved.** It is now
inside the understood proposition rather than beside it, which is worse:

> "A service that creates product launch films in 1 day instead of 6 weeks.
> Visually, it relies heavily on generic dark-mode SaaS motion graphics
> (floating UI, subtle zooms) rather than a unique style."

It has survived the colour flood, the output shot, the direction films, and the
camera rebuild. The thing it names is structural: five of sixteen shots show
product as a tilted capture floating on a plane with a shadow. That IS floating
UI. The references do not do this — they show interfaces full-bleed and being
used: "UI dashboard slides into view", a phone scrolling, notifications
arriving.

**New, and cheap to fix:** at 5s, "the opening text is slow and slightly
abstract, making for a weak start."

## Instrument note

The semantic channel failed five times before this reading: four HTTP 502s from
the deep model's gateway (the retry count was already raised to four earlier in
this project for the same reason), and one malformed JSON from the faster model,
which gets through the gateway but cannot hold this schema. A sixth failure was
a valid, complete reading wrapped in a single-element array and rejected at the
root — fixed, and it had silently cost three earlier retries.

---

## Two critics, and the disagreement that told us what to fix

The second critic finally answered, after three distinct failures: a credential
sent under the wrong header, a model this account does not have, and a
parameter that model rejects. It was worth the trouble.

They were deliberately given DIFFERENT evidence. Gemini watches the film;
OpenAI hears the mixed audio alone. Two models handed the identical file
agreeing tells you very little.

**They rank identically and score three points apart.**

| rank | Gemini (watches) | OpenAI (hears only) |
| --- | --- | --- |
| 1 | chris-creative-hi 5.50 | chris-creative-hi 8.25 |
| 2 | eric-creative-hi 5.38 | eric-creative-hi 8.00 |
| 3 | roger-natural 5.12 | roger-creative 7.62 |

| criterion | Gemini | OpenAI | gap |
| --- | --- | --- | --- |
| semanticAuthority | 4.60 | 9.00 | 4.40 |
| naturalness | 3.60 | 8.00 | 4.40 |
| rhythmAgainstEdit | 5.20 | 8.40 | 3.20 |
| emphasisMatchesTypography | 4.60 | 7.00 | 2.40 |
| intelligibilityOverMusic | 6.80 | 8.40 | 1.60 |

**What the gap means.** The read sounds fine on its own and wrong against the
picture. The smallest gap is on intelligibility over music — the one criterion
both can judge from audio alone. The largest are on naturalness and authority,
where the audio-only critic hears a competent read and the critic watching the
cut hears a machine talking over somebody else's film. Averaging these two
numbers would have produced a middling score and destroyed the finding.

**What they agree on.** `emphasisMatchesTypography` is OpenAI's lowest
criterion and Gemini's joint-lowest. Two critics, different evidence, same
weakest point. That is the strongest signal this project has produced about
where to work next, and it is not a casting problem: no voice, model or dial
has moved it, because the narration is placed at a hand-typed delay after each
cut and left to fall where it falls.

**Other things settled.** `eleven_multilingual_v2` beats `eleven_v3` on both
critics — v3 is last on Gemini and fourth on OpenAI — which confirms the
continuity trade: expressiveness in isolation loses to a script read as one
piece. And `stability` had never been set at all, so the dial the vendor
documents as governing how mechanical a read sounds was not chosen badly, it
was not chosen.

**A caution that still stands.** mv2-eric-hi scored 5.25 and then 5.00 on a
byte-identical cached file. Within one critic, 0.25 is noise. Gaps smaller
than that are not results.

## The alignment did not work, and the A/B says so

Both critics had converged on `emphasisMatchesTypography` as the weakest thing
about the narration, so the read was timed to the picture: a line waits for its
shot to finish saying its piece and comes in a beat later. Nine of fourteen
lines moved.

It made the film slightly worse. Same voice, model, energy and stability, the
alignment the only difference:

| criterion | Gemini on | Gemini off | OpenAI on | OpenAI off |
| --- | --- | --- | --- | --- |
| emphasisMatchesTypography | **4** | **5** | 8 | 8 |
| pausesMatchEdit | 5 | 6 | 8 | 8 |
| emotionalFit | 6 | 7 | 8 | 8 |
| naturalness | 5 | 4 | 8 | 9 |
| **overall** | **5.38** | **5.75** | 8.38 | 8.38 |

The critic that can see the picture rates it worse on the criterion it was
built to fix. The critic that only hears the mix cannot tell the two apart.

**Why, and it is obvious in hindsight.** Waiting for the words to land and then
coming in a beat later puts the voice permanently BEHIND the typography,
explaining something the viewer has already read. The hand-typed delays it
replaced — 0.25s, 0.3s, 0.4s — had the voice arriving nearly WITH the reveal.
Line-level timing was the wrong lever, and pointing it the other way is not a
tuning problem: the critics are asking which WORD carries the stress, not when
the sentence starts.

**Caveat on the size of it.** The overall gap is 0.375 against measured critic
noise of 0.25 on byte-identical files. That is weak evidence of harm and strong
evidence of no benefit. The change is reverted for not having earned its
complexity rather than for being proven harmful — which is the right standard
either way.

The module and its nine tests stay, off by default behind `ACT_ONE_ALIGN`. The
measurement is sound and the tool will be wanted for landing a line ON a reveal
rather than after one.

## What did work

| change | effect |
| --- | --- |
| `stability` set at all (was `undefined`) | Gemini naturalness 3.60 → 6, authority 4.60 → 6 |
| `eleven_multilingual_v2` over `eleven_v3` | v3 last on one critic, fourth on the other |
| casting by audition rather than by ear | both critics ranked the same voice first |

The robotic complaint survived five voices and two models, and moved when one
dial that had never been set was set.
