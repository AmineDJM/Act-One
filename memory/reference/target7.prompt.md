# target7 — the prompt that would rebuild this film

40.98s · 16:9 · 24fps · read and heard by gemini-3.1-pro-preview

**Subject.** Venture capital fund launch
**Claim.** Invest in technologies that expand human limits.

## The ground and the colour

- `#0A0A0A` — ground, from 0s, 100% of the running time. Fill base environment.
- `#FFFFFF` — type, from 0s, 85% of the running time. Render text and vector lines.
- `#0033FF` — accent, from 3.1s, 45% of the running time. Drive primary gradient nodes.
- `#FF0055` — accent, from 4.05s, 45% of the running time. Drive secondary gradient nodes.
- `#8800FF` — accent, from 5s, 40% of the running time. Drive tertiary gradient nodes.

Black point `#050505`, white point `#FFFFFF`, type against ground at 21:1. Grain 15%, vignette 50%, bloom 25%.
The ground is **lit**. Direct a 90-degree spotlight from 50% width, 0% height with 80% radial falloff.
Hold ground saturation at 0%. Push accent saturation to 95%.

## The type

- neo-grotesque, weights 400/500 — Set primary statements, body copy, and captions.
- mono, weights 400 — Set background texture and cascading emphasis.

- **statement** — 15% of frame height, tracking -0.02em, line height 1.1, Sentence, max 1 lines (see 3.5s)
- **display** — 12% of frame height, tracking 0.05em, line height 1, UPPERCASE, max 5 lines (see 15s)
- **body** — 8% of frame height, tracking 0em, line height 1.2, Sentence, max 2 lines (see 1s)
- **caption** — 3% of frame height, tracking 0em, line height 1.4, Sentence, max 1 lines (see 36s)

Type enters by Reveal characters sequentially from left to right. over 1.5s on `linear`, staggered 0.04s per letter; it leaves by Cut opacity to 0% instantly. over 0s. Does it ever sit still: **yes**.

## The camera and the motion

- 0s — static 0% over 5s on `none`, because Hold on typography.
- 5s — tilt 25% over 6s on `in_out_sine`, because Follow line drawing upwards to reveal orb.
- 11s — zoom 200% over 3s on `in_expo`, because Push through the orb to transition scenes.
- 14s — static 0% over 8s on `none`, because Hold on UI cards and typography.
- 22s — orbit 45% over 5s on `out_cubic`, because Reveal Z-depth array of pill objects.
- 27s — zoom 500% over 4s on `in_expo`, because Push through the glowing line to transition to end card.
- 31s — static 0% over 10s on `none`, because Hold on final logo and URL.

Something is always moving: **yes**. Shift gradient mesh nodes at 10% frame width per second.
- `out_expo` on Typography reveals and UI card entrances., typically 1.5s
- `linear` on Gradient texture shifts and continuous line drawing., typically 10s
- `in_expo` on Camera zooms for scene transitions., typically 3s

## The transitions

- 3.1s — hard_cut over 0s on `none`, caused by None.
- 5s — hard_cut over 0s on `none`, caused by None.
- 14s — displacement_glitch over 0.5s on `in_expo`, caused by Orb scales to 200% frame width, triggering RGB split.
- 19s — hard_cut over 0s on `none`, caused by None.
- 22s — hard_cut over 0s on `none`, caused by None.
- 27s — hard_cut over 0s on `none`, caused by None.
- 31s — additive_fade over 1s on `linear`, caused by Glowing line scales to 100% frame height, blowing out exposure.

## Dimension

**Yes.** Render spherical orb at 11.00s and pill-shaped capsules at 22.00s. Lit by Set ambient light to 0%. Place 100% intensity point lights inside geometry. Add 80% intensity directional rim light at 90 degrees.; materials Apply 90% transmission glass to outer shells. Apply 100% emission to inner fluid meshes.; perspective 50mm. Translates abstract investment concepts into measurable spatial arrays.

## The cut and the sound

6 cuts, average shot 4.1s (0.95s–10s). Cuts on the beat: **yes**. Decrease shot duration by 50% during the middle section (14.00s to 20.00s), then hold the final shot for 10.00s.

Music at 65 BPM in C minor, bed -18 LUFS, master -14 LUFS, sidechained to the voice: **yes**.
- 0s — Apply a low-pass filter at 400Hz to an ambient drone.
- 3.1s — Introduce quarter-note synth bass hits.
- 14s — Add a 16th-note arpeggiator layer.
- 22s — Open the low-pass filter to 5000Hz to widen the spectrum.
- 31s — Mute all percussion and arpeggiators; sustain the root note drone.
- Digital typing × 2, about 12 dB below the voice
- Low-frequency whoosh × 2, about 6 dB below the voice
- UI interface pop × 8, about 10 dB below the voice

Voice: Baritone, 120 wpm, median pause 0.8s, leading the bed by 4 LU.
- 0s — neutral → authoritative, Deliver initial thesis statement.
- 14s — authoritative → staccato, Punctuate the list of technology sectors.
- 22s — staccato → intense, Emphasize the ambition of the target audience.

**Sync rule.** Snap visual cuts and UI element reveals to the quarter-note grid of the music track. Tolerance 0.04s. Cut to a full-screen white flash at 31.00s and instantly mute all rhythmic audio stems.

## What it does every single time

- Center all primary text blocks at 50% frame width and 50% frame height.
- Hold ground saturation at 0% and push accent saturation to 95%.
- Reveal characters sequentially from left to right at 0.04s intervals.

## What a weaker studio would get wrong

- Executing the 0.50s displacement glitch at 14.00s while maintaining the 21:1 contrast ratio and seamlessly transitioning from the 200% camera zoom into the rapid 40% frame width UI card sequence without dropping the 24fps frame rate.

## The recipe

1. Set ground to #0A0A0A. Type '{We invest in te}' at 50% frame width, 50% frame height. Reveal letters at 0.04s intervals. At 3.10s, execute a 0.00s hard cut to 'Faster.' over a 100% frame width gradient bar driven by #0033FF.
2. At 5.00s, execute a 0.00s hard cut to #0A0A0A ground. Draw a 2px (inferred) #FFFFFF continuous line from 50% frame width, 100% frame height, forming a face profile. Tilt camera up 25% over 6.00s on in_out_sine to reveal a 30% frame width (inferred) orb.
3. At 11.00s, zoom camera 200% over 3.00s on in_expo. At 14.00s, apply a 0.50s displacement glitch. Display 40% frame width (inferred) UI cards at 50% frame width, 50% frame height. Flash mono text in background at 100% frame width.
4. At 22.00s, orbit camera 45 degrees over 5.00s on out_cubic to reveal an array of 3D pill shapes. Apply 5% blur radius to pills beyond 200% Z-depth. At 27.00s, display a 100% frame width horizontal glowing line. Zoom camera 500% over 4.00s on in_expo.
5. At 31.00s, cut to #0A0A0A ground. Reveal 'augment.' logo at 50% frame width, 50% frame height. Shift logo gradient mesh nodes at 10% frame width per second. Type tagline at 55% frame height (inferred). Type URL at 50% frame width, 90% frame height at 34.00s.

## The timeline

- **0.00s–10.00s** · sound · Play a continuous low-frequency synth drone at -18 LUFS.  
  *level -18 LUFS*  
  Provides audio bed.  *(inferred)*
- **0.00s–10.00s** · type · Display closed captions at 3% of frame height, bottom center, synced to voiceover.  
  *fontSize 3%h*  
  Ensures accessibility.
- **0.00s–1.50s** · type · Reveal '{We invest in technologies that make humans}' character by character at 12% of frame height, centered.  
  *fontSize 12%h, duration 1.50s*  
  Introduces premise.
- **0.00s–1.50s** · motion · Scale the text layer from 100% to 60% and rotate Y-axis from 0 to -20 degrees on out_expo.  
  *scaleStart 100%, scaleEnd 60%, rotationY -20deg*  
  Adds depth.  *(inferred)*
- **0.00s–1.50s** · voice · Speak 'We invest in technologies' at 120 WPM.  
  *wpm 120*  
  Delivers narrative.
- **1.50s–2.00s** · transition · Crossfade to 'that make humans' scaling from 80% to 100% at 12% of frame height.  
  *duration 0.50s, scaleStart 80%, scaleEnd 100%*  
  Advances text.
- **2.50s–2.50s** · transition · Hard cut to a horizontal mask occupying 30% of frame height.  
  *maskHeight 30%h*  
  Shifts visual style.
- **2.50s–3.50s** · type · Display 'Faster.' at 12% of frame height, centered.  
  *fontSize 12%h*  
  Highlights keyword.
- **2.50s–3.50s** · threeD · Render a flowing abstract shape using #0033FF and #8800FF inside the mask. Expand mask height from 30% to 100% over 1.00s on linear.  
  *startHeight 30%h, endHeight 100%h, duration 1.00s*  
  Introduces color.
- **2.50s–2.50s** · sfx · Play a synthetic impact sound at -12 dB.  
  *level -12 dB*  
  Accents cut.  *(inferred)*
- **3.50s–3.50s** · transition · Hard cut to full-screen 3D shape.  
  Maintains pace.
- **3.50s–4.50s** · type · Display 'Smarter.' at 12% of frame height, centered.  
  *fontSize 12%h*  
  Highlights keyword.
- **3.50s–4.50s** · threeD · Render a flowing abstract shape using #0033FF, #FF0055, and #8800FF.  
  Evolves background.
- **3.50s–3.50s** · sfx · Play a synthetic impact sound at -12 dB.  
  *level -12 dB*  
  Accents cut.  *(inferred)*
- **4.50s–4.50s** · transition · Hard cut to full-screen 3D shape with contour lines.  
  Maintains pace.
- **4.50s–5.50s** · type · Display 'Stronger.' at 12% of frame height, centered.  
  *fontSize 12%h*  
  Highlights keyword.
- **4.50s–5.50s** · threeD · Render a flowing abstract shape using #8800FF and #FF0055, overlaid with 2px #FFFFFF contour lines.  
  *lineWidth 2px*  
  Adds texture.
- **4.50s–4.50s** · sfx · Play a synthetic impact sound at -12 dB.  
  *level -12 dB*  
  Accents cut.  *(inferred)*
- **5.50s–5.50s** · transition · Hard cut to #0A0A0A ground.  
  Resets visual space.
- **5.50s–9.00s** · motion · Animate a 2px #FFFFFF stroke along a path forming a human profile, from 0% to 100% trim path over 3.50s on linear.  
  *lineWidth 2px, duration 3.50s*  
  Illustrates human element.
- **5.50s–8.00s** · voice · Speak 'That push human capabilities' at 120 WPM.  
  *wpm 120*  
  Continues narrative.
- **8.00s–9.00s** · voice · Speak 'to the next level.' at 120 WPM.  
  *wpm 120*  
  Completes sentence.
- **9.00s–10.00s** · threeD · Reveal a 3D shape at the top 20% of the frame, casting a volumetric light downwards onto the line drawing.  
  *shapeHeight 20%h*  
  Introduces new element.
- **9.00s–10.00s** · voice · Speak 'That supercharge performance' at 120 WPM.  
  *wpm 120*  
  Starts new sentence.
- **10.00s–11.50s** · motion · Translate the continuous line drawing of the face downwards from 50% to 80% of frame height, while the glowing orb descends from -20% to 50% of frame height.  
  *faceStartY 50%, faceEndY 80%, orbStartY -20%, orbEndY 50%*  
  Shifts focus to the orb.
- **10.00s–11.50s** · voice · Speak 'performance at every level.' at 120 WPM.  
  *wpm 120*  
  Continues the narrative.
- **11.50s–13.50s** · voice · Speak 'And break into what evolution never delivered.' at 120 WPM.  
  *wpm 120*  
  Sets up the transition.
- **11.50s–13.50s** · motion · Animate two red hands reaching from the left and right edges towards the center orb, stopping at 40% and 60% of frame width.  
  *leftHandEndX 40%, rightHandEndX 60%*  
  Creates anticipation.
- **13.50s–14.00s** · transition · Apply a digital glitch effect with horizontal displacement up to 20% of frame width, accompanied by a white flash.  
  *displacement 20%*  
  Signals a shift in topic.
- **13.50s–14.00s** · sfx · Play a digital glitch sound effect peaking at -6 dB.  
  *level -6 dB*  
  Reinforces the visual glitch.
- **14.00s–15.00s** · picture · Display a central image of a robotic hand touching a human hand, scaled to 60% of frame width, with a repeating text background of 'ROBOTICS'.  
  *imageWidth 60%*  
  Introduces the first topic.
- **14.00s–15.00s** · voice · Speak 'Robotics.' at 120 WPM.  
  *wpm 120*  
  Names the topic.
- **15.00s–16.00s** · picture · Display a central image of a robotic head, scaled to 60% of frame width, with a repeating text background of 'DEFENSE'.  
  *imageWidth 60%*  
  Introduces the second topic.
- **15.00s–16.00s** · voice · Speak 'Neurotech, defense.' at 120 WPM.  
  *wpm 120*  
  Names the topics.
- **16.00s–17.00s** · picture · Display a central image of a wireframe car, scaled to 60% of frame width, with a repeating text background of 'AI AGENTS'.  
  *imageWidth 60%*  
  Introduces the third topic.
- **16.00s–17.00s** · voice · Speak 'AI agents.' at 120 WPM.  
  *wpm 120*  
  Names the topic.
- **17.00s–18.50s** · picture · Display a central image of an eye, scaled to 60% of frame width, with a repeating text background of 'LONGEVITY'.  
  *imageWidth 60%*  
  Introduces the fourth topic.
- **17.00s–18.50s** · voice · Speak 'Longevity.' at 120 WPM.  
  *wpm 120*  
  Names the topic.
- **18.50s–19.50s** · motion · Scale the central eye image from 60% to 150% of frame width, filling the screen.  
  *startScale 60%, endScale 150%*  
  Transitions to the next scene.
- **19.50s–20.00s** · voice · Speak 'This is' at 120 WPM.  
  *wpm 120*  
  Starts the next sentence.
- **20.00s–21.00s** · type · Scroll the background text 'ISN'T FUTURE TALK' horizontally at 10% of frame width per second.  
  *scrollSpeed 10% frame width/s*  
  Creates continuous background motion.  *(inferred)*
- **20.00s–21.00s** · voice · Deliver the phrase 'future talk.' at 120 words per minute.  
  *speechRate 120 wpm*  
  Completes the previous sentence.
- **21.00s–22.00s** · type · Cut to background text 'HAPPENING IT'S HAPPENING' scrolling vertically at 15% of frame height per second.  
  *scrollSpeed 15% frame height/s*  
  Shifts visual rhythm and direction.  *(inferred)*
- **21.00s–22.00s** · voice · Deliver the phrase 'This is happening' at 120 words per minute.  
  *speechRate 120 wpm*  
  Introduces the next concept.
- **22.00s–23.00s** · type · Cut to a staggered arrangement of the word 'NOW' in #FFFFFF (type) on #0A0A0A (ground).  
  *wordCount 15*  
  Emphasizes immediacy.
- **22.00s–23.00s** · voice · Deliver the word 'NOW.' with emphasis.  
  *speechRate 120 wpm*  
  Punctuation of the visual message.
- **23.00s–24.00s** · ui · Reveal a pill-shaped UI element containing 'We build.' and a globe icon, glowing with #FF0055 (accent) and #0033FF (accent).  
  *pillWidth 30% frame width, pillHeight 10% frame height*  
  Introduces the core action.  *(inferred)*
- **23.00s–27.00s** · voice · Deliver the phrase 'With those who build with obsession, discipline, and raw ambition.' at 120 words per minute.  
  *speechRate 120 wpm*  
  Describes the target audience.
- **24.00s–27.00s** · ui · Duplicate the pill UI element, creating a cascading trail that recedes into 3D space along the Z-axis.  
  *trailCount 20+, zDepth 500px*  
  Suggests scale and multiplicity.  *(inferred)*
- **24.00s–27.00s** · camera · Pan the camera upwards and slightly right, following the receding trail of UI elements.  
  *panY 20% frame height, panX 5% frame width*  
  Guides the eye through the 3D space.  *(inferred)*
- **27.00s–28.00s** · transition · Compress the trail of UI elements into a single horizontal line spanning the frame width.  
  *lineWidth 100% frame width, lineHeight 1% frame height*  
  Transforms complex elements into a simple graphic.  *(inferred)*
- **27.00s–30.00s** · voice · Deliver the phrase 'Because human limits aren't lines in the sand.' at 120 words per minute.  
  *speechRate 120 wpm*  
  Connects the visual line to the narrative.
- **28.00s–30.00s** · motion · Hold the horizontal line, glowing with #0033FF (accent) on the left and #FF0055 (accent) on the right.  
  *glowIntensity 50%*  
  Provides a visual anchor for the voiceover.  *(inferred)*
- **30.00s–31.50s** · motion · Scale the horizontal line vertically from 1% to 100% of frame height on out_expo.  
  *startScale 1%, endScale 100%, duration 1.50s*  
  Expands the line into a full-screen gradient.
- **30.00s–31.50s** · picture · Expand the gradient colors (#0033FF, #FF0055, #8800FF) to fill the screen as the line scales.  
  *colors #0033FF, #FF0055, #8800FF*  
  Transitions from a line to a full-screen color field.
- **30.00s–32.50s** · voice · Deliver the line 'They're the start of something bigger.' at 120 WPM.  
  *wpm 120*  
  Provides narrative context for the visual expansion.
- **31.50s–32.50s** · picture · Fade the full-screen gradient to #0A0A0A (ground) over 1.00s on linear.  
  *color #0A0A0A, duration 1.00s*  
  Clears the screen for the final logo reveal.
- **32.50s–33.50s** · type · Reveal the logo 'augment.' at 15% of frame height, centered, using a glitch/morph effect from abstract shapes to the final wordmark over 1.00s.  
  *size 15%, duration 1.00s*  
  Introduces the brand name with a technological feel.
- **32.50s–33.50s** · picture · Apply a subtle, shifting gradient glow (#0033FF, #FF0055, #8800FF) behind the logo text.  
  *colors #0033FF, #FF0055, #8800FF*  
  Connects the logo to the established color palette.
- **33.50s–34.50s** · voice · Deliver the word 'augment.' at 120 WPM.  
  *wpm 120*  
  Reinforces the brand name audibly.
- **34.50s–36.50s** · type · Type out the tagline 'A fund for those who rewrite human capability.' at 8% of frame height, centered below the logo, over 2.00s.  
  *size 8%, duration 2.00s*  
  Provides the brand's mission statement.
- **34.50s–37.00s** · voice · Deliver the line 'a fund for those who rewrite human capability.' at 120 WPM.  
  *wpm 120*  
  Audibly reinforces the tagline.
- **37.00s–37.50s** · type · Fade in the URL 'www.augment.fund' at 3% of frame height, centered at the bottom of the screen, over 0.50s.  
  *size 3%, duration 0.50s*  
  Provides a call to action.
- **37.50s–40.00s** · picture · Hold the final composition (logo, tagline, URL, background glow) static.  
  *duration 2.50s*  
  Allows the viewer to read and absorb the final information.
- **40.00s–40.98s** · picture · Hold background at #0A0A0A. Render 'augment.' at 50% width, 45% height in #8800FF at 12% frame height. Render subtitle at 50% width, 55% height in #FFFFFF at 3% frame height. Render URL at 50% width, 90% height in #FFFFFF at 3% frame height.  
  *title_y 45%, title_size 12%, subtitle_y 55%, subtitle_size 3%, url_y 90%, url_size 3%*  
  Final brand lockup.
- **40.00s–40.98s** · sound · Fade bass drone from -12 LUFS to -48 LUFS over 0.98s on linear curve.  
  *start_level -12 LUFS, end_level -48 LUFS, duration 0.98s*  
  Audio conclusion.  *(inferred)*
- **40.00s–40.98s** · motion · Maintain 0px movement and 0deg rotation for all elements and camera.  
  *movement 0px, rotation 0deg*  
  Static resolution.

## Every half second

| at | on screen | type | hex | motion | audio | spoken |
| --- | --- | --- | --- | --- | --- | --- |
| 0.00s | {We invest in te} | Sans-serif, white, centered, approx 10% frame height. | #000000 | Text types on from left to right. | Low drone begins, approx -20 LUFS. | We invest in technologies |
| 0.50s | {We invest in technologies that make humans} | Sans-serif, white, centered, approx 10% frame height. | #000000 | Text continues typing on. | Drone continues. | We invest in technologies |
| 1.00s | that make humans | Sans-serif, white, centered, approx 10% frame height. | #000000 | Text scales up slightly, brackets disappear. | Drone continues. | that make humans |
| 1.50s | that make humans | Sans-serif, white, centered, approx 10% frame height. | #000000 | Text holds position. | Drone continues. | that make humans |
| 2.00s | Faster. | Sans-serif, white, centered, approx 15% frame height. | #1A4B8C | Text cuts in. Background reveals a blue/purple gradient band, approx 30% frame height. | Drone continues, slight swell. | faster |
| 2.50s | Faster. | Sans-serif, white, centered, approx 15% frame height. | #1A4B8C | Background band expands vertically. | Drone continues. | faster |
| 3.00s | Smarter. | Sans-serif, white, centered, approx 15% frame height. | #4A2B8C | Text cuts in. Background band expands further, colors shift to include more purple/pink. | Drone continues. | smarter |
| 3.50s | Smarter. | Sans-serif, white, centered, approx 15% frame height. | #4A2B8C | Background band continues expanding and shifting colors. | Drone continues. | smarter |
| 4.00s | Stronger. | Sans-serif, white, centered, approx 15% frame height. | #8C1A4B | Text cuts in. Background fills frame, colors shift to include more red/pink. White contour lines appear. | Drone continues, slight swell. | stronger |
| 4.50s | Stronger. | Sans-serif, white, centered, approx 15% frame height. | #8C1A4B | Background colors shift, contour lines undulate. | Drone continues. | stronger |
| 5.00s | Stronger. | Sans-serif, white, centered, approx 15% frame height. | #8C1A4B | Background colors shift, contour lines undulate. | Drone continues. | stronger |
| 5.50s | — | None | #000000 | Cut to black. A single white line begins drawing from bottom center. | Drone continues. | That push human capabilities |
| 6.00s | — | None | #000000 | White line continues drawing upwards, forming a profile. | Drone continues. | That push human capabilities |
| 6.50s | — | None | #000000 | White line continues drawing, forming a face profile. | Drone continues. | That push human capabilities |
| 7.00s | — | None | #000000 | White line completes face profile, begins rotating clockwise. | Drone continues. | to the next level. |
| 7.50s | — | None | #000000 | Face profile continues rotating clockwise. | Drone continues. | to the next level. |
| 8.00s | — | None | #000000 | Face profile continues rotating clockwise. | Drone continues. | to the next level. |
| 8.50s | — | None | #000000 | Face profile continues rotating clockwise, approaching horizontal. | Drone continues. | to the next level. |
| 9.00s | — | None | #000000 | Face profile reaches horizontal. A colorful gradient circle appears at top center, approx 20% frame width. | Drone continues. | That supercharge performance |
| 9.50s | — | None | #000000 | Gradient circle expands downwards, revealing a brain-like structure. | Drone continues. | That supercharge performance |
| 10.00s | — | None | #000000 | Gradient circle continues expanding downwards. | Drone continues. | That supercharge performance |
| 10.00s | That supercharge performance | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | White line drawing of a face at 50% frame height, 30% frame width. Glowing sphere at 10% frame height, 40% frame width. | Ambient synth pad at -18 LUFS. | That supercharge performance |
| 10.50s | at every level. | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Face drawing fades out over 0.5s. Sphere descends to 50% frame height over 1.0s. | Ambient synth pad at -18 LUFS. | at every level. |
| 11.00s | And break into what | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Sphere centered at 50% frame height. Two red glowing hands enter from left and right edges, moving towards sphere. | Ambient synth pad at -18 LUFS. | And break into what |
| 11.50s | evolution never delivered. | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Red hands touch the sphere. Sphere glows brighter. | Ambient synth pad at -18 LUFS. | evolution never delivered. |
| 12.00s | evolution never delivered. | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Sphere and hands distort with a glitch effect over 0.2s. | Glitch sound effect at -12 LUFS. | — |
| 12.50s | Robotics. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Background fills with repeating 'ROBOTICS' text. Central image of a robotic arm touching a human hand appears in a rounded rectangle. | Upbeat electronic music starts at -14 LUFS. | Robotics. |
| 13.00s | Neurotech. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Background text changes to 'NEUROTECH'. Central image changes to a brain scan. | Upbeat electronic music at -14 LUFS. | Neurotech. |
| 13.50s | Defense. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Background text changes to 'DEFENSE'. Central image changes to robots. | Upbeat electronic music at -14 LUFS. | Defense. |
| 14.00s | AI agents. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Background text changes to 'AI AGENTS'. Central image changes to a wireframe car. | Upbeat electronic music at -14 LUFS. | AI agents. |
| 14.50s | Longevity. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Background text changes to 'LONGEVITY'. Central image changes to a close-up of an eye. | Upbeat electronic music at -14 LUFS. | Longevity. |
| 15.00s | Longevity. | Sans-serif, white, 4% frame height, centered at 50% frame height. | #222222 | Eye image scales up to fill the frame over 0.5s. | Upbeat electronic music at -14 LUFS. | — |
| 15.50s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Eye image fades to black. Text appears at bottom. | Upbeat electronic music at -14 LUFS. | This is |
| 16.00s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 16.50s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 17.00s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 17.50s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 18.00s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 18.50s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 19.00s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 19.50s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 20.00s | This is | Sans-serif, white, 4% frame height, centered at 90% frame height. | #000000 | Static black screen with text. | Upbeat electronic music at -14 LUFS. | — |
| 20.00s | ISN'T FUTURE TALK repeated vertically. Central rectangle with pink/purple fluid texture. White circle outline in center with text 'Not in the future.' | ISN'T FUTURE TALK: 80px monospace, #FFFFFF. Not in the future.: 24px sans-serif, #FFFFFF. | #1A1A1A | Background text scrolls vertically at 100px/s. Central rectangle scales up from 30% to 40% width. Fluid texture animates. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | future talk. |
| 20.50s | IT'S HAPPENING repeated vertically. Central rectangle with pink/purple fluid texture. White circle outline in center with text 'This is happenin'. | IT'S HAPPENING: 80px monospace, #FFFFFF. This is happenin: 24px sans-serif, #FFFFFF. | #1A1A1A | Background text scrolls vertically at 100px/s. Central rectangle scales up to 50% width. Fluid texture animates. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | This is happening. |
| 21.00s | NOW repeated vertically in a staggered pattern. | NOW: 80px monospace, #FFFFFF. | #1A1A1A | Text 'NOW' appears in a staggered vertical column, scrolling upwards at 150px/s. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | NOW. |
| 21.50s | NOW repeated vertically in a staggered pattern. | NOW: 80px monospace, #FFFFFF. | #1A1A1A | Text 'NOW' continues scrolling upwards at 150px/s. | Synth drone continues at -12 LUFS. | — |
| 22.00s | NOW repeated vertically in a staggered pattern. | NOW: 80px monospace, #FFFFFF. | #1A1A1A | Text 'NOW' continues scrolling upwards at 150px/s. | Synth drone continues at -12 LUFS. | — |
| 22.50s | Pill shape with 'We build.' text and globe icon. Pink/purple fluid texture inside pill. Red and blue glow behind pill. | We build.: 32px sans-serif, #FFFFFF. | #1A1A1A | Pill shape fades in and scales up from 0% to 20% width over 0.5s. Fluid texture animates. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | With those who build with obsession, |
| 23.00s | Pill shape with 'We build.' text and globe icon. Pink/purple fluid texture inside pill. Red and blue glow behind pill. | We build.: 32px sans-serif, #FFFFFF. | #1A1A1A | Pill shape holds at 20% width. Fluid texture animates. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | With those who build with obsession, |
| 23.50s | Pill shape with 'We build.' text and globe icon. Pink/purple fluid texture inside pill. Red and blue glow behind pill. | We build.: 32px sans-serif, #FFFFFF. | #1A1A1A | Pill shape holds at 20% width. Fluid texture animates. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | With those who build with obsession, |
| 24.00s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Additional pill shapes fade in and scale up, forming a vertical stack. The stack rotates slightly on the Y-axis. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | discipline, |
| 24.50s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | discipline, |
| 25.00s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | and |
| 25.50s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | raw ambition. |
| 26.00s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | raw ambition. |
| 26.50s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. | — |
| 27.00s | Multiple pill shapes with various text and icons appear, arranged vertically. Each has a different fluid texture and glow. | Various text: 24px sans-serif, #FFFFFF. | #1A1A1A | Stack of pill shapes continues to rotate on the Y-axis and scale down slightly. | Synth drone continues at -12 LUFS. | — |
| 27.50s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Pill shapes collapse into a single horizontal line. Line glows blue on left, red on right. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | Because human limits |
| 28.00s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Horizontal line holds position. Glow pulses slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | Because human limits |
| 28.50s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Horizontal line holds position. Glow pulses slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | aren't lines in the sand. |
| 29.00s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Horizontal line holds position. Glow pulses slightly. | Synth drone continues at -12 LUFS. Voiceover at -18 LUFS. | aren't lines in the sand. |
| 29.50s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Horizontal line holds position. Glow pulses slightly. | Synth drone continues at -12 LUFS. | — |
| 30.00s | Horizontal line with blue glow on left and red glow on right. | — | #1A1A1A | Horizontal line holds position. Glow pulses slightly. | Synth drone continues at -12 LUFS. | — |
| 30.00s | A horizontal line spans 100% of the frame width at 50% of the frame height. The line is a gradient from blue (#0000FF) on the left to red (#FF0000) on the right. The background is black (#000000). | Subtitle text 'aren't lines in the sand.' is centered at 90% of the frame height. | #000000 | The horizontal line remains static. | A low, sustained synth note plays at -15 LUFS. | aren't lines in the sand. |
| 30.50s | The horizontal line has expanded vertically to cover 30% of the frame height. The gradient colors are more intense, with purple (#800080) and pink (#FFC0CB) hues. | Subtitle text 'They're the start' is centered at 90% of the frame height. | #000000 | The horizontal line expands vertically on an ease-in curve. | The synth note increases in volume to -10 LUFS. | They're the start |
| 31.00s | The gradient now fills 100% of the frame. The colors are a mix of purple (#800080), pink (#FFC0CB), and white (#FFFFFF). | Subtitle text 'They're the start' is centered at 90% of the frame height. | #DDA0DD | The gradient continues to expand and fill the frame. | The synth note reaches its peak volume at -5 LUFS. | They're the start |
| 31.50s | The gradient fills 100% of the frame. The colors are a mix of purple (#800080), pink (#FFC0CB), and white (#FFFFFF). | Subtitle text 'of something bigger.' is centered at 90% of the frame height. | #DDA0DD | The gradient colors shift slightly. | The synth note begins to fade. | of something bigger. |
| 32.00s | The gradient fills 100% of the frame. The colors are a mix of purple (#800080), pink (#FFC0CB), and white (#FFFFFF). | Subtitle text 'of something bigger.' is centered at 90% of the frame height. | #DDA0DD | The gradient colors shift slightly. | The synth note continues to fade. | of something bigger. |
| 32.50s | The frame is entirely black (#000000). | None | #000000 | The screen cuts to black. | Silence. | — |
| 33.00s | The frame is entirely black (#000000). | None | #000000 | The screen remains black. | Silence. | — |
| 33.50s | The word 'augment.' appears in the center of the frame. The letters are formed by a gradient of purple (#800080) and red (#FF0000). The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. | #330000 | The letters of 'augment.' fade in and assemble themselves. | A low, rhythmic synth pulse begins at -20 LUFS. | augment. |
| 34.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. | #330000 | The word 'augment.' remains static. | The synth pulse continues. | augment. |
| 34.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. Subtitle text 'a fund for those' is centered at 90% of the frame height. | #330000 | The word 'augment.' remains static. | The synth pulse continues. | a fund for those |
| 35.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. Subtitle text 'a fund for those' is centered at 90% of the frame height. The text 'A fund for those who rewrite human capab\|' is being typed out below 'augment.' at 60% of the frame height. | #330000 | The text below 'augment.' is being typed out. | The synth pulse continues. Typing sound effects play at -15 LUFS. | a fund for those |
| 35.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. Subtitle text 'who rewrite human capability.' is centered at 90% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. | #330000 | The text below 'augment.' is fully typed out. | The synth pulse continues. Typing sound effects stop. | who rewrite human capability. |
| 36.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. Subtitle text 'who rewrite human capability.' is centered at 90% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | who rewrite human capability. |
| 36.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 37.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' appears at 80% of the frame height. | #330000 | The text 'www.augment.fund' fades in. | The synth pulse continues. | — |
| 37.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 38.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 38.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 39.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 39.50s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 40.00s | The word 'augment.' is fully formed in the center of the frame. The background is a dark, mottled red (#330000). | The word 'augment.' is centered at 50% of the frame height. The text 'A fund for those who rewrite human capability.' is fully typed out below 'augment.' at 60% of the frame height. The text 'www.augment.fund' is at 80% of the frame height. | #330000 | The text remains static. | The synth pulse continues. | — |
| 40.00s | Display 'augment.' at 50% width, 45% height. Display 'A fund for those who rewrite human capability.' at 50% width, 55% height. Display 'www.augment.fund' at 50% width, 90% height. | Set 'augment.' to 10% frame height, bold sans-serif, #7B32D9. Set subtitle to 3% frame height, regular sans-serif, #FFFFFF. Set URL to 2% frame height, regular sans-serif, #FFFFFF. | #0A0A0A | Hold all elements static at 0px/s velocity. | Fade out synth pad from -24dB to -30dB. | None. |
| 40.50s | Maintain 'augment.' at 50% width, 45% height. Maintain subtitle at 50% width, 55% height. Maintain URL at 50% width, 90% height. | Keep 'augment.' at 10% frame height, #7B32D9. Keep subtitle at 3% frame height, #FFFFFF. Keep URL at 2% frame height, #FFFFFF. | #0A0A0A | Hold all elements static at 0px/s velocity. | Fade out synth pad from -30dB to -40dB. | None. |
