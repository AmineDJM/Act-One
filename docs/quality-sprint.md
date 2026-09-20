# Benchmark-Level Creative Quality Sprint

What was measured, what was found, what was changed, and what is still wrong.

Two kinds of statement appear below and they are never mixed. **MEASURED** is
FFmpeg, OpenCV and onset detection reading the finished files: facts about
pixels and samples. **READ** is a model's interpretation — Gemini 3.1 Pro
watching the real MP4 at the deep tier, or an independent OpenAI critic shown
stills and told it was seeing stills. Agreement between the two is evidence;
either one alone is a claim.

---

## 1. The baseline, re-rendered

`.renders/baseline.mp4` — 69.0s, 1920x1080, 30fps, AAC. Rendered against the
fixed engine before anything creative was attempted, so every comparison below
has a real starting point rather than a remembered one.

**READ (independent critic, stills):** `genericSaas: true`,
`wouldShipToAClient: false`. *"The benchmark films usually have a memorable
visual engine, exquisite transitions, strong rhythm, and frames that work as
posters. These stills rely on generic dark-mode SaaS UI and big type."*

---

## 2. Three directions, actually rendered

Not storyboard prose. Three films with sound, evaluated by both channels.

| | a-paper | b-depth | c-field |
|---|---|---|---|
| World | Editorial light; paper, ink, orange | Dark navy; the interface in four planes | Full-frame colour chapters |
| Type | Set on a page against rules | Centred over depth | One enormous word per field |
| Product | Plates as printed figures | Regions flown between | Full-bleed after three fields |
| Motion | Precise, short | Camera between planes, real parallax | Hard cuts on the beat |
| Sound | Restrained, opens on silence | Cinematic, opens on music | Driving, impacts as rhythm |
| **READ (video, on the file)** | "leans generic SaaS motion graphics" | **"looks exactly like generic dark-background SaaS motion graphics; lacks a unique visual idea"** | "avoids generic SaaS tropes in favor of stark typography and bold colors, establishing its own visual idea" |
| **READ (critic, stills)** | generic, would not ship | generic, would not ship | generic, would not ship |

**The stop-condition was not met.** Two of three escaped the dark canvas, and a
model watching the files said so in its own words. But the critic returned
`genericSaas: true` and `wouldShipToAClient: false` for **all four films,
including the baseline**, and its reasons were identical every time:

> no memorable visual device · no bespoke illustration · typography is safe
> rather than exquisite · no sophisticated transitions · frames that work as
> posters, absent

That is one finding stated five ways, and none of it is about colour or
placement. Every film this system made was **type over a screenshot**, because
type and screenshots were the only things it could put on screen. So the work
turned to why.

---

## 3. What was actually constraining the film

Three renderer defects, each found by looking at output rather than at code.

**Footage could not play.** `clip` rendered through a raw `<video>` tag. In a
headless render the browser hands over whatever it has decoded when the
screenshot is taken — usually frame one, every frame. The language could
declare a shot, the router would route it, QA would pass it, and the film came
out with a frozen still where its only moving footage was meant to be.
*(`OffthreadVideo`, with the clip's own `sourceInSeconds` and `playbackRate`.)*

**Every capture was the wrong shape.** One line: `aspectRatio: crop.width /
crop.height`. Those are fractions *of the source*, so a crop covering the whole
of a 1580x680 capture computed `1/1` and the browser drew a square, then scaled
the interface up by more than two to fill it. The product shot came out as a
band of body copy with its headline cut off above the frame. The region's true
shape needs the source's dimensions, which no stylesheet knows — so the image
is measured and the frame held open with `delayRender` while that happens.

**A scene could invert its background but not what reads on it.** `onCanvas` is
decided once from the film's theme. An editorial cut goes paper, paper, paper,
then ink for the mark — and the mark kept the light theme's reading colour and
rendered near-black on near-black. In the DOM, passing every check, invisible
on screen. The film's last shot was its own name and you could not see it.

---

## 4. Structural QA that could not see the most visible defects

**Text left the frame and nothing noticed.** Two directions clipped their
headlines on the first render — "Six" came out as "ix" — while the pass
reported no hard failures. The safe-area check tests an object's anchor
*point*; a text object is a box `maxWidth` wide that the camera then magnifies.
`object_outside_frame` now measures the box through the camera the renderer
actually applies, for every object that states a width. Height is deliberately
not checked: a capture's is its width times the aspect of an image the package
has never seen, and a guessed bound would fail correct scenes.

**A full bleed is a decision; a plate hanging off one side is a mistake.** Both
look identical to an edge test. What separates them is coverage — reaching past
*both* edges is what somebody asking for a full-frame capture wanted. Type is
exempt from the exemption: a headline wider than the frame is never a bleed.

**Three checks read shape but not the intent the graph declares:**

- A *denial* was matched as a claim. A commissioned shot whose reason said "no
  interface appears in it" was refused for containing the sentence that proves
  the rule was obeyed — the most careful author in the system was the one the
  check punished.
- Thirty tick marks performing one gesture counted as thirty competing motions.
- Two scenes joined by an object handover were flagged for looking alike, which
  is the one thing a handover means.

---

## 5. The sound was silent, then misaligned

**The previews shipped with no audio at all.** Every scene declares its audio —
an impact where the word lands, a riser under a push, a sting on the mark — and
nothing had ever read those events. Three films were rendered, measured,
inspected and reviewed frame by frame while being twelve seconds of silence.
The first thing a video model said about the first one was *"no audio present;
sync and sound design cannot be evaluated."* `soundForScenes` translates
scene-graph audio into the existing sound director rather than growing a second
mixer beside it.

**The mix was truncating the picture.** A mix is only as long as its longest
sound, and `-t` can only shorten. A cut whose music ended at 10.4s over 12.2s
of picture produced a 10.4s audio track, and the mux's `-shortest` then trimmed
**1.8 seconds of video** off the end. The film lost its closing mark, and the
only evidence was a duration nobody reads twice.

**Ten of twelve pre-roll claims were wrong.** Each sample records how long it
plays before its transient, and the director subtracts that when placing a cue
— so a sample claiming 80ms of air it does not have is heard 80ms early. The
numbers were written by hand beside the filenames and assumed recorded samples
with room tone; these are synthesised and begin at their transient.

**MEASURED, before and after, on the finished master:**

| cue | before | after |
|---|---|---|
| ui_click @ 3.5s | +0.0ms | −1.4ms |
| sub_drop @ 8.0s (hero landing) | **−72.0ms** | **+1.3ms** |
| pipeline offset (median) | −1.3ms | −5.3ms |

A test now asserts the numbers against the actual files, and it was verified by
putting the old value back and watching it fail.

**And the instrument itself was lying.** `sync_check` folds to mono for onset
detection, which *sums* the channels, and read peak level off that fold: it
reported the master at +0.37 dBFS — apparently clipping — when the file peaks
at **−1.98 dBFS** and was never near the ceiling. An instrument that invents a
delivery defect costs more than no instrument, because somebody then goes and
fixes a mastering chain that was correct.

---

## 6. The live providers, exercised

| Provider | State | Used for |
|---|---|---|
| Gemini 3.1 Pro | healthy, 21 video models | Native video reading of every film, deep tier, whole MP4 uploaded |
| OpenAI | healthy → **out of credit** | Independent stills critic; exhausted before the last cut |
| Higgsfield (Seedance 2.5) | healthy | **The opening shot — commissioned, $1.849, 4s** |
| Recraft | healthy, 5000 credits | Two vector attempts, **both rejected** (below) |
| Runway | healthy, 500 credits | Priced as challenger; not used |
| Ideogram | healthy | Not used |
| Browserbase | healthy | Product captures |
| RunPod | healthy, $15 | **No endpoints deployed — nothing can be sent yet** |
| ElevenLabs | **credential invalid** | Fallback used |

**RunPod: my earlier verdict was wrong and it was my fault.** Node's `fetch`
ignores `HTTPS_PROXY` without `NODE_USE_ENV_PROXY=1`, so an ad-hoc probe left
unauthenticated, the API answered **200 with an empty account**, and I read
that as a rejected key. `httpRequest`/`httpStream` now warn once on any call
that would bypass the proxy. The account is fine; it simply has no serverless
endpoints deployed, so `canRun` is honestly false for every kind.

**No 3D was quietly substituted.** Nothing in the selected film required
Blender-grade geometry, so none was faked with 2.5D. If a direction had needed
it, RunPod is where it would have run — and it would have needed an endpoint
deployed first.

**Recraft was the wrong instrument, twice.** Asked for flat orthographic
geometry it returned a tablet in perspective, then two rulers in perspective.
It illustrates; it does not draft. The film's graphic device is built from the
scene language's own `shape` primitives instead — forty rectangles the film can
recolour, place on the grid and animate individually, which is exactly right
and which a generated approximation is not. *Also found: `checkBrief` refuses a
**video** brief that commissions an interface; nothing refuses a **still** that
does. An illustration of a fake dashboard would have gone straight into a film.*

---

## 7. The film

`.renders/final.mp4` — 18.8s, 1920x1080, 30fps, −16 LUFS, peak −1.98 dBFS.
Source: `scripts/film/final.ts`.

| shot | duration | what it is |
|---|---|---|
| f1 | 3.4s | **Commissioned footage.** Hands leaving a desk at dusk, one practical lamp, cold coffee, scattered paper. Sealed brief: no interface, no text, no logos. |
| f2 | 4.6s | **The measure.** Thirty marks across a rule — six weeks as thirty working days — under "Six weeks / to make one launch film." |
| f3 | 3.6s | **The collapse.** The same thirty marks, carried by id across the boundary, now occupying a twentieth of the same rule. "One afternoon." |
| f4 | 4.4s | **The product.** A real capture, cropped to its own claim, as the one full plate in the film. |
| f5 | 2.8s | **The mark.** Ink, the name low-left, and the one tick left of the six weeks. |

Three things no previous cut contained: a real shot, a graphic system that
transforms, and a transformation instead of a cut.

**READ (video model, on the file):** *"Contrasts generic SaaS motion graphics
by opening with a moody live-action shot, giving it a distinct cinematic
identity."*

Compare the same model on b-depth: *"looks exactly like generic dark-background
SaaS motion graphics; lacks a unique visual idea."*

And on the frame edges, which is where every earlier cut failed: *"No type or
interface is clipped by the frame edge."*

### The edit change, before and after

The first cut of this film ran the collapse to the same frame the line changed
on. The model read that moment as *"text changes to One afternoon"* and
recorded **no hero moment and no transformation** — the thirty marks gathering,
which is the film's whole argument, registered as nothing, because the words
moved at the same instant and words win.

So the marks were made to finish early and *sit* there, gathered, under a line
that still says six weeks, before the line agrees with what the picture already
said. The same model, on the same instrument:

| | before | after |
|---|---|---|
| hero moments | **0** | **1** — *"Timeline compression", 5.0–7.5s, confidence `observed`, evidence "effective visual metaphor"* |
| boundaries | 4 | 6 |
| the moment, as read | one beat: *"text and graphic update"* | two beats: 5.0s *"timeline begins to compress"*, then 7.5s *"text replacement"* |

The collapse is now its own event and the model calls it the strongest one in
the film.

---

## 8. What is still wrong

Stated plainly, because a sprint that reports only its wins is a sales
document.

1. **It reads as a beat, not as a transformation.** After the edit change the
   collapse is the film's hero moment, but `objectTransformations` is still
   `0`: the model sees a graphic that animates rather than material becoming
   other material. That may be a fair reading — thirty rectangles moving is
   not a morph — or it may mean the handover the graph declares is not visible
   as continuity. Not resolved.
2. **No camera behaviour was read at all.** `camera: 0` entries. The moves are
   1.03–1.06 scale, which is honest restraint for an editorial cut and may
   simply be below what reads.
3. **The independent critic never saw the final cut.** OpenAI ran out of credit
   mid-evaluation. Every `genericSaas: true` verdict quoted above is about an
   *earlier* version; the final film has one channel of opinion, not two.
4. **`excessive_simultaneous_motion` still fires** on the measure. Thirty marks
   converging travel different distances, so they do not collapse to one
   signature. The check is arguable here and was deliberately not tuned further
   — bending an instrument until it says what you want is how films get
   optimised for metrics instead of for viewers.
5. **Vertical clipping is unchecked.** Horizontal bounds are arithmetic;
   vertical needs the source's aspect or the font's wrapping. It belongs in a
   measurement on rendered frames, where it is a fact rather than an estimate.
6. **Gemini's deep pass 502s often.** The gateway cuts the silence before the
   model's first byte. Four retries instead of two; it still failed twice in
   one run of four films.

---

## 9. The next five highest-leverage changes

1. **Measure clipping on rendered frames.** Content touching the frame border
   is a fact OpenCV can read in milliseconds, and it closes the vertical hole
   the structural check honestly cannot.
2. **Apply the product rule to generated stills.** `checkBrief` guards video
   briefs only. A vector or image generation that draws a fake interface has
   nothing standing in its way, and one nearly reached a film here.
3. **Deploy one RunPod endpoint.** The account is live and idle. Until
   something is deployed, "we have GPU infrastructure" is an account balance.
4. **Give the sound director the scene graph directly.** `soundForScenes`
   translates into the older storyboard vocabulary and has to invent a motion
   recipe and a camera recipe that nothing reads. That is a seam, and seams
   drift.
5. **Let a handover actually carry objects.** The language declares
   `carries: [ids]` and the renderer redraws them in the next scene. Here they
   were written twice by hand and kept in sync by care. The graph already
   states the intent; nothing consumes it.
