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
