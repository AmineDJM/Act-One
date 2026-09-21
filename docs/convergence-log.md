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
