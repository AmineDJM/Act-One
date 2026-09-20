/**
 * Commissions the film's graphic device.
 *
 * WHAT THE CRITICS ACTUALLY SAID. Four films went to an independent vision
 * model — three creative directions and the current baseline — and all four
 * came back the same way: "no memorable visual device", "no bespoke
 * illustration", "typography is safe rather than exquisite", "frames that
 * work as posters" absent. Not one of those is a note about colour or about
 * where the type sits. They are all one note, which is that every film this
 * system makes is type over a screenshot, because type and screenshots are
 * the only things the vocabulary could produce.
 *
 * A drawing is the missing supplier. Recraft returns real SVG rather than a
 * picture of a drawing, which is what makes it usable here: paths can be
 * recoloured to the brand, laid on the grid, and drawn on a at a time, and
 * none of that is possible with a raster.
 *
 * WHAT IT MAY NOT BE. Not an illustration of software, not a fake interface,
 * not a mascot. A device is a mark a film repeats — a rule, a bracket, a
 * measure, a form that means something the second time you see it. The brief
 * below asks for a measure, because this film is about time.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all ACT_ONE_COMMISSION=1 npm run commission:device
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RecraftProvider } from '@act-one/providers';

const CONTEXT = { organizationId: 'org_quality_sprint' };

/*
 * REJECTED ONCE, AND WHY IT IS WRITTEN LIKE THIS NOW.
 *
 * The first brief asked for "a single abstract measuring mark" and described
 * a ruler whose scale compresses. What came back was a tablet drawn in
 * perspective, with a screen, placeholder image boxes and a scroll bar — a
 * picture of a user interface, which is the one thing this system may never
 * put on screen. Two things went wrong and both are worth keeping.
 *
 * The word "device" is a graphic-design term to a designer and a piece of
 * hardware to everything else. Nothing in the brief said the word, but the
 * comparison to a ruler put an object in the model's head, and it drew the
 * object. So this version names no object at all: it describes marks on a
 * page and nothing that could be held.
 *
 * And the product rule has no teeth here. `checkBrief` refuses a video brief
 * that commissions an interface; nothing refuses a STILL that does. An
 * illustration of a fake dashboard would have been written straight into a
 * film with no check objecting, and the only reason this one was not is that
 * somebody looked at it.
 */
const DEVICE = {
  prompt:
    'Flat two-dimensional graphic marks on a plain background, drawn as if printed on paper. ' +
    'A row of thin vertical lines of equal height, packed tightly together at the left side and ' +
    'spreading further and further apart towards the right until only a few remain. ' +
    'Beneath them, one straight horizontal line spanning the full width. ' +
    'Nothing else at all. Black lines on warm off-white. ' +
    'Flat orthographic, no perspective, no depth, no shadow, no gradient, no frame, no border, ' +
    'no box, no rectangle, no screen, no device, no object, no text, no numbers, no symbols.',
  aspect: '16:9' as const,
  tier: 'studio' as const,
  substyle: 'line_art',
};

const recraft = new RecraftProvider({});
if (!recraft.isConfigured()) {
  console.error('No Recraft credential is available in this process.');
  process.exit(1);
}

console.log('DEVICE BRIEF');
console.log(`  ${DEVICE.prompt}\n`);

if (process.env['ACT_ONE_COMMISSION'] !== '1') {
  console.log('dry run. Set ACT_ONE_COMMISSION=1 to draw it.');
  process.exit(0);
}

const job = await recraft.generateVector(DEVICE, CONTEXT);
console.log(`job ${job.id} on ${job.model} (${job.status})`);
// Recraft's generation endpoint answers synchronously; there is no job to poll.
const done = job;
console.log(`${done.status} $${done.costUsd.toFixed(3)}`);

if (done.status !== 'succeeded' || !done.outputUrls[0]) {
  console.error(`failed: ${done.error ?? 'no output'}`);
  process.exit(1);
}

const svg = await (await fetch(done.outputUrls[0])).text();
const out = path.resolve(process.env['ACT_ONE_DEVICE_OUT'] ?? 'apps/web/public/capture/device.svg');
await writeFile(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${(svg.match(/<path/g) ?? []).length} paths)`);
