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

Two things the render host needs:

- **`chrome-headless-shell`.** Remotion drives Chrome's *old* headless mode,
  which current Chrome binaries no longer ship; a full `chrome` fails to launch.
- **FFmpeg.** Bundled via `ffmpeg-static`, overridable with
  `ACT_ONE_FFMPEG_PATH`.

### Rotating the vault key

Add a key and move the active pointer:

```json
ACT_ONE_SECRET_KEYS={"k1":"<old>","k2":"<new>"}
ACT_ONE_SECRET_ACTIVE_KEY=k2
```

Never replace. Rows are decrypted with the key they were written under, and
removing it makes every stored secret permanently unreadable.

---

## External dependencies

Four, deliberately: **OpenAI**, **Browserbase**, **Higgsfield**, **Stripe**.
Everything else — design, motion, 3D, sound, storage, queue, QA — is ours. Those
four are replaceable infrastructure; the moat is product understanding, creative
strategy, art direction, premium motion systems, real product cinematography,
Brand DNA, automated QA and the revision system.
