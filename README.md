# Act One

**Your product. Directed.**

Give us a product URL. Act One reads the product, measures the brand, develops
three genuinely different creative directions, storyboards the one you choose,
and produces an agency-quality launch film — plus every cut your launch needs.

---

## What this is, and what it refuses to be

The hard part of automated video is not generating frames. It is not producing
something that looks automated. Almost every decision here is downstream of
that.

**The rules the system enforces in code, not in prompt text:**

- **The product is never faked.** If a real interface exists, the film shows the
  real interface. With no capture available, a scene falls back to typography —
  never a generated screen, even when generation is enabled and would look
  impressive.
- **Nothing is claimed that the customer has not published.** Every fact is
  verified against verbatim excerpts we captured. A figure appearing nowhere in
  their own material is dropped and reported back as a gap.
- **Generative video is supplementary.** It carries mood, metaphor and
  environment. Typography, layout, brand colour and product interface are
  rendered by our own deterministic engine, because those are exactly what
  generative models cannot hold steady.
- **Three concepts are three arguments.** Each is assigned a different narrative
  structure and creative language before a word is written, then measured for
  divergence — if two come back as one idea reworded, one is regenerated.

---

## The words

Act One is a production house that happens to be software, and the language
holds that everywhere a customer can read it. A project is a **production**.
The finished file is the **master**; the other lengths are **cuts**; the
timed storyboard you watch before any of it is the **workprint**. Pictures
and footage are **material**, kept in the **archive**, which is a place that
keeps things rather than a folder that holds them. What the machine reads
about a product is **discovery**, and what it measures of a brand is the
**identity**.

Two rules keep that from becoming costume, and both are in
`packages/core/src/domain/vocabulary.ts`. Internal names never change — the
code says `project`, `asset`, `render`, and renaming a column to sound like
a film studio would buy nothing. And the word has to be the accurate one:
*mastering* is used where sound and picture are actually being finished,
never as decoration on a progress bar, and where the plain word is the true
one — settings, billing, sign in — the plain word stays.

A film credits **An Act One Production**, or **Act One Original** when we
made it for ourselves. Never "AI-generated". The ™ or ® after the name is
not written into any page: the console says which mark the name has earned,
and the footer is the one place it is claimed.

## What the customer sees while it works

The interface is near-black and quiet, with one accent and a grid of dots
for a signature. The terminal is an influence, not a costume: a prompt in
front of a label, a two-digit index, a status in capitals — `DISCOVERY`,
`MASTER READY` — and otherwise modern type and generous space.

A production runs through six phases, and the page says which one it is in:
**DISCOVERY**, **DIRECTION**, **STORYBOARD**, **PRODUCTION**, **MASTERING**,
**READY**. The thirteen stages underneath are how the machine thinks about
the same work, and they stay in the console — nobody outside this building
needs to know that capturing the product and rendering the film are
different jobs. When something stops, it is named by the phase it
interrupted: `DISCOVERY INTERRUPTED` says what did not happen and what still
stands, where `RENDER FAILED` told a customer about our queue.

While the system works, the production page shows the work as nine steps —
product discovery, identity, creative direction, three directions,
storyboard, source material, voice, motion, the master — each `COMPLETE`,
`BUILDING` or `WAITING`, and the step in progress carries the curated lines
the worker writes as it goes: each page read with a tick, then `> extracting
positioning`, `> identifying target audience`, `> finding product moments`.
Only meaningful activity, never a log line; the log is the console's.

Nothing discovery read is thrown away. Every page becomes a source kept with
the production — its address, title, type, why the agent went there, the
screenshot as our own asset, the excerpt, the claims the brief took from
it — and stays inspectable after the film exists, under **Discovery** on the
production page.

### When something does not go to plan

Three different things wear the word "error" in most software, and only one of
them is an error here.

A shot that comes back wrong is remade, and the page says **Rebuilding this
shot**. A shot that fails the standards is directed again, and the page says
**Refining this shot**. Neither is a failure, and neither offers a button:
telling somebody their production broke while it is quietly being remade is
the worst thing this system could say, so work in progress beats every other
reading.

When a production really does stop, it is named by the phase it interrupted —
**Discovery paused**, **Master not completed**, **Production interrupted** —
and it carries exactly one way on, whose words say what pressing it does:
*Continue discovery*, *Resume mastering*, *Resume production*. A provider
being briefly unavailable is **Production paused**, which does not blame the
customer for our supplier. An account that needs attention is **Payment
requires attention**, which is not a production problem at all. The status
beside the title and the status on the card come from the same notice, so a
card and the page it opens can never disagree about what happened.

Nothing in any of it names a provider, a model, a status code or a stack. The
only raw text that can reach a customer is a sentence the pipeline deliberately
wrote for them — "We could not read anything at that address." — and a filter
decides whether what it is handed is one of those. A test feeds the notices
every kind of infrastructure noise we have actually produced and asserts none
of it comes out the other side.

Underneath, the promise the copy makes is real. A failed job re-queues the
stage that failed and keeps everything before it: the discovery, the identity,
the concepts, the storyboard, the material and every shot already made. The
retries are bounded and invisible, the backoff is exponential, and a failure
that will fail identically forever — a validation error, a refusal — is not
retried at all. The media allowance belongs to the production rather than to
the attempt, so three automatic retries cannot spend three times what the
customer agreed to.

### The product's phase, and the door

Where the product is in its life is one setting in the console, under
**Product**: a private beta, a public beta, or production. The public
pages read it within a minute — the button says *Request access*, *Join
the beta* or *Start free*; the sign-up page asks for an invitation code,
says plainly that it is a beta, or asks for nothing; the name beside the
mark carries ™ or ® only as the console says it has earned it. Nothing
about the phase is written into a page by hand.

In a private beta the door is an invitation code: bounded by uses and by
time, withdrawable from the console, one use per person, and never a
credential — it lets a person create an account, nothing more. People
without one may request access; a person reads each request and either
declines it or invites, which makes a single-use code and the link to send.
Nothing is sent on anyone's behalf.

### The console is the expert surface

Customers see nine human steps and statuses in capitals. Staff see the
queue as it is, under **Console → Jobs**: every job across the platform
with its kind, state, worker, attempts, timings and last error verbatim,
narrowed by window, state, kind, workspace or project; and one job all
the way down — the payload, every provider call made while it ran with
model, cost, outcome and browser session id, the lines the customer was
shown, and the operational log entries that name it. None of it reaches
the product: provider names, models, session ids and raw errors live here
and nowhere a customer looks.

### Brand DNA, per production

A brand belongs to a project. It is measured from that project's own site —
colours by painted area, type by use, radii and spacing by mode, icons by
how they are drawn, pictures by kind, the favicon and the mark — and read,
by quotation only, for how the brand speaks: the words it uses, how it
names itself and its things, the line it leads with, what it never says.
The Brand page shows it as eight components a person can read, edit and
tick off — **BRAND DNA — measured automatically from 14 sources … [ Confirm
brand ]** — and every writing prompt in the pipeline gets the brand's own
words.

A later project for a company whose brand a person confirmed starts from
that DNA, so a second film matches the first, and keeps what its own
reading found differently as *signals*: "We found 2 new brand signals"
lists each one — what the brand has, what was measured, where — for a
person to accept or dismiss. Nothing a person edited or confirmed is
overwritten by a measurement, and a dismissed reading is not proposed
again.

### The archive

Every picture a workspace owns lives in one place, under **Archive**: what
people drop on the page (PNG, JPG, WebP, SVG, any number, up to 25 MB
each), what discovery kept as it read the product, and what a film was
made from. A production ends; the material stays. A file is what its bytes say, never what its name claims, and an
SVG that carries script or reaches out to other places is refused rather
than cleaned. Nothing is asked at upload: the name is the filename, the
category — product, founder, people, team, office, UI, screenshot, logo,
brand, illustration, reference — is inferred by looking at the picture
after the card is already on the page, and a person's correction outlives
every later inference.

One file, any number of productions. An asset is shared with every
production until it is attached to some, and a production's **Material**
section is a view over the archive, never a copy. Favourites are for people;
**approved** is for the films: the storyboard planner is handed the
production's material — approved pictures first — before it is allowed to
imagine anything, a
photograph is staged full frame as real media, a customer's own picture of
their interface may carry a product beat, and a generated shot is anchored
to an approved product still and records it as its parent. Versions point
at their original.

### Collections

The public gallery of launch films made here, at `/collections`, with a page
per film at `/collections/{slug}` and a page per category. A film enters it in
exactly two ways. A customer with a finished, clean master clicks *Submit for
selection* on the project page and ticks a consent statement that is shown in
full and stored with the entry; the film waits *Under consideration* until a
person selects it. Or staff publish a film themselves from the console, and
attest, in their own words, to the written consent they hold; that attestation
is stored with the entry too. Nothing becomes public on its own: no job, no
schedule, no default.

Everything shown is decided in the console under *Collections*: select,
decline, unpublish, feature, name the launch of the week (one at a time), mark
an *Act One Original*, choose the poster frame and stills from the film's own
frames, set the category, the title, the tagline, the address and the order.
A customer can withdraw at any time, which takes the film off the site at
once and closes the staff door until they submit again. The public film route
`/api/collections/{slug}/film` serves bytes only while the entry is published,
and the sitemap, the landing page's *Selected work* and the structured data
(`VideoObject`, `BreadcrumbList`) read the same list.

### Referrals

A customer who brings another founder is paid in credits, and the programme
is deliberately hard to game. Everyone gets a durable link with their name in
it — `/invite/AMINE` — which is the same address a workspace invitation uses,
resolved to whichever it is. Somebody who signs up through it is recorded
once, against their account, and **nothing is paid at that moment**: an
account that merely exists is worth nothing, so the reward lands only when
the person they brought produces their first film or starts paying, whichever
the programme asks for.

The rules live in the console under *Referrals*: what each side receives, the
bonus when an invited workspace first pays, one-off tier bonuses, and the
ceiling on how many referrals one person may ever be rewarded for. A
self-referral, a referral into a workspace the inviter is already in, a second
referral of the same person, and anything over the ceiling are all recorded as
refused *with the reason*, so an operator asking "why did this earn nothing?"
finds an answer rather than an absence. The payout decision itself lives in
`packages/db/src/referrals.ts`, because a film becomes ready inside the worker
while a payment clears inside the app, and the two must never answer
differently.

### The journal

Articles about launching software live at `/blog`, with a page each and the
sitemap, structured data (`Article`, `BreadcrumbList`) and canonicals that go
with them. Bodies are Markdown rendered by our own small renderer, so nothing
an editor or a model writes ever becomes HTML in a page.

The console's *Journal* is the whole CMS: what is in flight, what is worth
writing next, and the rules the machine is held to. An editor can start an
empty draft or have one written — topic, outline, section by section, closing,
then the words search engines read — and rewrite any single section against a
fresh instruction without touching the rest. Every article carries what the
pipeline did and what the standards say about it: length, the description,
a picture somebody can hear, and the two ways a generated piece lies —
inventing figures and saying nothing. A blocking finding cannot be pressed
through; it has to be fixed.

Drafting and publishing are separate switches, both off by default. The
worker's own clock publishes what was scheduled and, when an operator has
asked for it, drafts one piece per cadence — one, because a journal that
publishes in bursts reads like a content farm.

Work the product does for itself runs under a workspace of its own,
`org_platform`, created by a migration and impossible to sign into. It exists
so the journal's model calls land in the same cost ledger as a customer's:
"what does the journal cost?" is answered by the same query as "what does
this customer cost?".

### What search engines see

Every public page describes itself the same way, through one helper: a title,
a description written to be clicked, a canonical, a social card with a real
picture, `hreflang` entries ready for a translation that does not exist yet,
and the right indexing rule — sign-up, invitations and the console are never
indexed. A page cannot forget one of them, because it does not assemble them
itself.

Structured data says only what the page shows: the landing page's FAQ is the
questions actually on it, the work page's videos are the films it plays, and
every gallery, article and film page carries its own breadcrumb trail. The
sitemap is generated from the same code the pages use, so a film published a
minute ago is in it and a withdrawn one is out. A missing page is a real page
with a way back in rather than a dead end.

Addresses are permanent even when they change. Renaming a published article
or film keeps the old address on the record, and the old link answers with a
permanent redirect to the new one instead of a 404 — for a reader, for a
crawler, and for the poster picture in a social card somebody cached last
month. A draft renamed before it ever went live records nothing, because
nobody could have linked to it.

The console's *Search* page answers the only questions worth asking: is this
deployment indexable at all, what is in the map, and what is standing in the
way — a description search will cut, a picture nobody can hear, a film with
no poster frame. It carries the few search decisions that are genuinely a
person's: the sentence the landing page shows in results, the switch that
holds the whole site back from search for the window between a domain going
live and the site being ready to be found, and the two tokens a search
console hands you to prove the site is yours. Canonicals, structured data
and the sitemap are not settings — getting them wrong is a bug, not a
preference — so they are not there.

## The pipeline

```
URL
 │
 ├─ Research ......... browser agent reads the site; every claim keeps its source
 ├─ Brand DNA ........ colour, type, radius and rhythm MEASURED in the page
 ├─ Strategy ......... three structurally different directions
 │                     ↳ customer chooses
 ├─ Direction ........ treatment, including what the film will NOT show
 ├─ Storyboard ....... timing, legibility and budget settled before anything costs money
 │                     ↳ customer revises in plain sentences
 ├─ Production ....... motion · product cinematography · 3D · sound design · mix
 ├─ QA ............... deterministic checks, fact check, then vision on real frames
 ├─ Repair ........... only the scenes that broke, bounded
 └─ Campaign ......... vertical, square, 15s ads that argue differently, bumper, loop
```

---

## Architecture

```
apps/
  web/              Next.js — marketing site, customer app, Super Admin console
  worker/           Long-lived render worker

packages/
  core/             Domain model, entitlements, tenancy. No I/O.
  db/               Schema, row-level security, Postgres + in-memory Stores
  providers/        LLM · browser · generative media · speech · storage
  research/         Product Research Agent, Brand DNA, claim verification
  creative/         Creative systems, strategy, direction, storyboard, revisions
  design/           Deterministic design engine: colour, type metrics, grid, SVG
  motion/           Remotion components and the film composition
  three-d/          Blender rigs, driven by structured parameters
  sound/            Sound Director, synthesised library, FFmpeg mix graph
  qa/               Deterministic checks, fact check, vision QA, repair planning
  pipeline/         Stages and the job runner
```

**Provider boundary.** Nothing outside `packages/providers` imports a vendor SDK
or names a model. Callers ask for a capability and a quality tier; the registry
decides who serves it. Every paid call reports through a cost sink, so the
ledger is complete by construction rather than by remembering to log.

---

## Getting started

```bash
npm install
cp .env.example .env     # DATABASE_URL is optional in development
npm run dev              # http://localhost:3000
```

Without `DATABASE_URL` the app runs against the in-memory store — a real second
implementation of the same contract, not a stub, so behaviour does not diverge.
**The first account created on a fresh install becomes staff**, so you have a
way into the console.

With a database:

```bash
npm run migrate          # schema + row-level security
npm run sound-library    # ~2 min, once — see below
npm run worker           # in a second terminal
```

### The sound library

Act One scores its own films. Nothing in the library is licensed, sampled or
bought: the seven tracks and twelve effects are synthesised from scores in
`packages/sound/src/scores.ts`, rendered by `npm run sound-library`, and
mastered to the loudness each one declares. They stay out of the repository
because they are output, not source — a couple of hundred megabytes that the
scores reproduce byte for byte on any machine.

Until it has run, the manifest describes files that are not there. The mix is
still built correctly, out of nothing, and every film comes out silent. The
worker says so at startup, and any film rendered without it carries a QA
finding rather than shipping quietly.

### Verify

```bash
npm run verify           # typecheck + tests
```

---

## Configuring it

Almost nothing is configured in files. Sign in as staff and open **`/admin`**.

| Page | What it controls |
| --- | --- |
| **Integrations** | API keys for OpenAI, Browserbase, Higgsfield, Stripe, Supabase. Paste, save, and the key is encrypted, stored, and verified by a live call to the vendor. |
| | Model routing per quality tier, browser vendor and fallback, spend ceilings. |
| | The creative budget — how much of a film may be generated, and what it may cost per second. |
| **Plans & pricing** | Prices, limits and entitlements. Live immediately. |
| **Customers** | Organisations, plans, spend and margin per tenant. |
| **Costs & margin** | What vendors charged us against what we charged customers. |

Feature code only ever asks whether an organisation holds an *entitlement*,
never which plan it is on — so changing what a tier unlocks is a form
submission that cannot strand a customer mid-project.

---

## Security

- **Tenancy is enforced twice.** Every query is scoped by `organization_id`, and
  row-level security sits behind it: the app sets `app.organization_id` per
  transaction, so a query that forgets its `WHERE` returns nothing rather than
  another customer's film. Policies fail closed when the setting is absent.
- **Secrets are bound to their tenant.** AES-256-GCM with the
  organisation/project as authenticated data, so a credential row copied between
  tenants fails to decrypt rather than relying on query discipline.
- **Product access is read-only by construction.** An authenticated session is
  confined to one origin and the paths the customer authorised, and
  state-changing interactions are blocked in code — a model that decides
  "Delete workspace" looks interesting cannot act on it. Everything is audited,
  and revoking destroys the stored secret rather than flagging the row.
- **Sessions are stored as hashes**, so a leaked database grants no access.
  Unknown-email and wrong-password take the same time and return the same
  message.
- **Voice cloning requires a recorded consent grant.** There is no path around
  it.

---

## Deployment

`render.yaml` describes the full topology: a web service, a worker and Postgres.

The worker is separate because rendering takes minutes and holds gigabytes —
work that must never run inside an HTTP request, where a proxy timeout kills it
halfway and leaves the customer looking at a spinner.

Three things the worker host needs, all installed by the build:

- **Chromium**, for research. `npm run browsers` installs Playwright's build
  under `PLAYWRIGHT_BROWSERS_PATH`; `ACT_ONE_CHROMIUM_PATH` overrides it.
- **`chrome-headless-shell`**, for rendering. Remotion drives Chrome's *old*
  headless mode, which current Chrome binaries no longer ship; a full `chrome`
  fails to launch. The same script installs it; `ACT_ONE_CHROME_HEADLESS_SHELL`
  overrides it.
- **FFmpeg.** Bundled via `ffmpeg-static`, overridable with
  `ACT_ONE_FFMPEG_PATH`.

The Postgres plan in `render.yaml` is `basic-1gb`: films live in object
storage, so the database grows with customers, not with render volume. The
database is pinned to the services' region, because Render's internal database
hostname only resolves inside one region: a database elsewhere fails every
connection with `ENOTFOUND dpg-…-a`, and `npm run migrate` and `/api/health`
both say so in those words.

Migrations run as the web service's pre-deploy command, once per deploy,
before the new version takes traffic — nothing else runs them, and a database
with no schema fails every sign-up with "Something went wrong on our side."
The health check at `/api/health` reports the database and its schema, so a
deploy whose database is behind its code is marked failed with the reason in
the logs rather than going live. On any other host: run `npm run migrate`
against `DATABASE_URL` before starting the web service, and point the health
check at `/api/health`.

**The first account created becomes staff.** Sign up at `/auth/sign-up` as
soon as the deploy answers, before sharing the address; the console is at
`/admin`, and other staff are granted from `/admin/staff`.

### The vault key

Nothing to type on Render: the Blueprint has Render generate
`ACT_ONE_SECRET_KEYS` in an environment group shared by the web service and
the worker, so both hold the same key and nobody handles it. The application
accepts either form:

```
ACT_ONE_SECRET_KEYS=<any random string>              one key, as a host generates it
ACT_ONE_SECRET_KEYS={"k1":"<base64 32 bytes>", ...}   a keyring, for rotation
```

A bare value that is not 32 bytes of base64 is hashed to 32 bytes; the same
string always yields the same key. Self-hosting, generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### Rotating the vault key

Add a key and move the active pointer:

```json
ACT_ONE_SECRET_KEYS={"k1":"<old>","k2":"<new>"}
ACT_ONE_SECRET_ACTIVE_KEY=k2
```

Never replace. Rows are decrypted with the key they were written under, and
removing it makes every stored secret permanently unreadable. To rotate away
from a host-generated key, `k1` in the keyring is that generated value.

### Addresses

The canonical origin comes from `ACT_ONE_SITE_URL`, or from
`RENDER_EXTERNAL_URL` when Render sets it. Set the first only for a custom
domain. `ACT_ONE_SUPPORT_EMAIL` is optional; when it is empty there is no
contact link and no email in the structured data, rather than a made-up one.

---

## External dependencies

Four, deliberately: **OpenAI**, **Browserbase**, **Higgsfield**, **Stripe**.
Everything else — design, motion, 3D, sound, storage, queue, QA — is ours. Those
four are replaceable infrastructure; the moat is product understanding, creative
strategy, art direction, premium motion systems, real product cinematography,
Brand DNA, automated QA and the revision system.

One optional fifth: **ElevenLabs**, the premium voice. Narration comes from
OpenAI's voices until its key is saved and chosen for finals under Routing;
then finals are performed on Eleven v3 by a voice cast for the language, which
is the difference between a voice reading French and a French voice.

### The voice

The customer chooses, on the brief, in plain words: who reads (a woman, a man,
nobody), the language, and optionally an accent, a style and a pace. Nothing
about a vendor, a model or a setting reaches them.

Behind that, one object — the voice direction — describes the performance:
language and locale, gender, profile, tone, energy, pace, an emotional arc,
what to avoid, and how tightly to hold the voice. The kind of film sets its
defaults (a launch film is cinematic and restrained; an audio edition is
editorial and steady), the brief overrides them, and every engine consumes the
same object, so two engines can be compared blind on the same brief. Before
any engine sees a line it is adapted for the ear: figures, currencies,
percentages, years and ordinals are written as a narrator says them, in the
language of the line; initialisms are spelt out; the organisation's own
pronunciations are applied first.

Two tiers. **Previews** — animatics, drafts — go to the fast model, or to
OpenAI, because there the timing is what matters. **Finals** go to the
premium engine, which on ElevenLabs means v3: stability as a tier rather than
a dial, at most one audio tag where the direction calls for it, and the lines
before and after each one so the film is one read. Every passage is then
transcribed back by a *different* recogniser than the voice that spoke —
Whisper or Scribe, chosen under Routing — and compared with the script.

Every line then goes through the narration engine, whichever engine reads:
fitted to its room (rewritten shorter by the model as a copy editor, every
figure kept to the character, before it is ever hurried, and never past ten
percent); performed with the lines around it; measured by FFmpeg for peak,
silence and level; and, for finals, transcribed back by the recogniser and
compared with the script — the wrong language, a figure not said, an ending
cut off, a pause that is not written, a read that runs past its scene. The
best take is kept, a failed one is read again, and the passages are brought
to one level before anything hears them together. Each recording is our own
asset, with who read it, in which language, how many characters, what it
cost and what QA found.

**Brand voice.** On the Brand page an organisation casts one narrator for
everything it makes — from the engine's library, by ear, with a sample — and
writes down how its own names are said (`Ornikar = Or-nee-car`). Plans decide
by entitlement, never by name: the premium engine for finals, alternative
takes, a brand voice, cloning, audio editions.

**Cloning.** A person's voice is cloned only under a recorded consent naming
them, granted by a member who ticks the statement in plain words; the consent
exists before the vendor is asked, the vendor checks it again, and revoking
it deletes the voice in the same breath. A cloned voice can never be cast by
accident: the library is searched with clones excluded, and naming one
outright is refused unless the consent travels with the request. Staff switch
cloning on or off for the platform under **Voice** in the console.

**Audio editions.** The film's argument, written again for the ear from the
approved storyboard and the published facts (a draft that invents a figure is
refused and the narration itself is read), segmented at sentences, read by
the brand voice, stitched with the pauses the paragraphs ask for, mastered to
−16 LUFS and delivered as its own file beside the film.

**For staff**, the console's Voice page chooses the engines for finals,
previews and listening back; curates which voice reads each language and
accent, per gender and profile, from the library; sets takes, regenerations,
the cost ceiling and cloning; shows what the voice cost, by engine and model,
from the ledger; and reads one line on every engine with a key for a blind
comparison.

### Revisions are a conversation

A change is a sentence: "the opening holds too long". We answer with what we
understood and exactly what we would do — which scenes, whether the product has
to be captured again, and whether the film will be re-rendered — and nothing is
touched until the customer says so. Confirming applies the change and, once a
film exists, regenerates it. Each plan includes a number of revisions per
project; the rest is upgrade.

### Browserbase

Paste the API key in **Integrations**; the project is found from the key, and
saving shows its name and how many sessions it may run. Set the Project ID only
if the key reaches several projects. To bootstrap a deploy instead, set
`BROWSERBASE_API_KEY`. Without it, research runs on a local Chromium.

### Higgsfield

Generated shots come from **Seedance 2.5** through the official SDK:
text-to-video, and image-to-video when a scene has a reference still to hold
the brand's palette. Stills come from **Soul 2**. The credential is one value,
`KEY_ID:KEY_SECRET`, issued at [console.higgsfield.ai](https://console.higgsfield.ai);
paste it in **Integrations**, or set `HF_CREDENTIALS` to bootstrap a deploy.
Saving it prices a four-second shot, which proves the key and shows today's cost
without generating anything. Every shot is priced by the vendor's estimate
before it is sent, and sent only under the per-request ceiling. A moderated or
failed request is recorded at zero, because that is what the vendor charges.

To make one request outside the product:

```bash
echo 'HF_CREDENTIALS=key-id:key-secret' > .env.local   # ignored by git
npm run higgsfield:example                              # spends credits
```

It generates a five-second clip from a fixed prompt and prints the URL, or says
why there is none.
