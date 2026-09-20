/**
 * Product capture as source material, not as shots.
 *
 * A screenshot of a whole page, scaled to fit a 16:9 frame, is a page nobody
 * can read. A critic watching the master said exactly that about the shots
 * this used to produce — "too much small text presented for too short a
 * duration to actually read" — and measured the viewer's load as HIGH for the
 * five seconds it was on screen.
 *
 * So this captures REGIONS. It finds the elements a beat could be about — a
 * headline, a card, a row of steps — measures their real boxes in the page,
 * and writes each one as its own image at twice device scale with a little
 * air around it. A shot is then a real part of the real interface at a size
 * somebody can read, which is what the references do and what a scaled page
 * can never be.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = '/home/user/Act-One/.renders/capture';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

/** What to crop to, per route: a selector and the name it is filed under. */
const SHOTS = [
  { name: 'home_hero', route: '/', selector: 'h1' },
  { name: 'home_steps', route: '/', selector: 'h2' },
  { name: 'how_stages', route: '/how-it-works', selector: 'h1' },
  { name: 'work_films', route: '/work', selector: 'h1' },
  { name: 'pricing_terms', route: '/pricing', selector: 'h1' },
];

const graph = [];
for (const shot of SHOTS) {
  try {
    await page.goto('http://localhost:3000' + shot.route, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(900);
    const el = page.locator(shot.selector).first();
    const box = await el.boundingBox();
    if (!box) { console.log(shot.name, 'NO BOX'); continue; }

    /*
     * A generous region around the element rather than the element alone.
     *
     * A headline cropped to its own bounding box is a word on a white
     * rectangle, which is not the interface — it is type. The point of showing
     * the product is showing that the type sits in something.
     */
    const pad = { x: 120, y: 90 };
    const clip = {
      x: Math.max(0, box.x - pad.x),
      y: Math.max(0, box.y - pad.y),
      width: Math.min(1600 - Math.max(0, box.x - pad.x), box.width + pad.x * 2),
      height: Math.min(1000 - Math.max(0, box.y - pad.y), box.height + pad.y * 2.2),
    };
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, clip });
    const text = (await el.textContent() || '').trim().slice(0, 90);
    graph.push({ ...shot, clip, text });
    console.log(`${shot.name.padEnd(16)} ${Math.round(clip.width)}x${Math.round(clip.height)} @2x  "${text}"`);
  } catch (e) {
    console.log(shot.name, 'FAILED', String(e.message).slice(0, 110));
  }
}
// The scene graph: what was captured, from where, and what it says.
await writeFile(`${OUT}/scene-graph.json`, JSON.stringify(graph, null, 2));
await browser.close();
