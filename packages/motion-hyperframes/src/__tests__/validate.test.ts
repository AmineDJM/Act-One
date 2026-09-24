import { describe, expect, it } from 'vitest';
import { MAX_SCENE_BYTES, figuresOf, normalizeScene, validateScene, wordsOf, type ValidationContext } from '../validate.ts';

/**
 * The gate every written scene passes before a browser sees it.
 *
 * The scene is code a model wrote from a brief containing a customer's words,
 * so each rule is tested by the thing it exists to stop: a scene that reaches
 * the network, moves on the browser's clock, sets a face the renderer does not
 * have, or puts a word on screen the storyboard never wrote.
 */
const context: ValidationContext = {
  frameId: 'scene-01',
  mountedSeconds: 3,
  allowedPaths: new Set(['assets/ast_1.png', 'assets/ast_2.mp4']),
  allowedWords: new Set(wordsOf('Forty unmatched rows. 12,500 invoices')),
  allowedFigures: new Set(figuresOf('Forty unmatched rows. 12,500 invoices')),
};

const GOOD = `<template>
<style>
#root { position: absolute; inset: 0; overflow: hidden; }
#scene-01-title { position: absolute; left: var(--ao-safe-x); top: 40%; font-family: var(--ao-display-family), sans-serif; font-size: 96px; color: var(--ao-primary); }
</style>
<div id="root" data-composition-id="scene-01" data-width="1920" data-height="1080">
<div id="scene-01-title">Forty unmatched rows.</div>
<img id="scene-01-shot" src="assets/ast_1.png" alt="">
</div>
<script>
const tl = gsap.timeline({ paused: true });
gsap.set("#scene-01-shot", { opacity: 0 });
tl.fromTo("#scene-01-title", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.72, ease: ActOne.ease("out_quint") }, 0);
window.__timelines = window.__timelines || {};
window.__timelines["scene-01"] = tl;
</script>
</template>`;

function codes(html: string, overrides: Partial<ValidationContext> = {}): string[] {
  return validateScene(html, { ...context, ...overrides })
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
}

function changed(from: string, to: string): string {
  if (!GOOD.includes(from)) throw new Error(`The good scene has no ${from}`);
  return GOOD.replace(from, to);
}

const SCRIPT_END = 'window.__timelines = window.__timelines || {};';
const inScript = (code: string) => changed(SCRIPT_END, `${code}\n${SCRIPT_END}`);
const inMarkup = (markup: string) => changed('<img id="scene-01-shot"', `${markup}\n<img id="scene-01-shot"`);
const inStyle = (css: string) => changed('</style>', `${css}\n</style>`);

describe('a well-formed scene', () => {
  it('passes with no errors', () => {
    expect(codes(GOOD)).toEqual([]);
  });

  it('is found inside fences and prose a model wrapped it in', () => {
    const wrapped = `Here is the scene:\n\`\`\`html\n${GOOD}\n\`\`\`\nIt uses one timeline.`;
    expect(normalizeScene(wrapped)).toBe(GOOD);
  });
});

describe('the shape the renderer depends on', () => {
  it('refuses anything that is not one template', () => {
    expect(codes(`<div>${GOOD}</div>`)).toEqual(['missing_template']);
    expect(codes(`${GOOD}\n${GOOD}`)).toContain('multiple_templates');
    expect(codes(changed('</template>', '<template></template></template>'))).toContain('multiple_templates');
  });

  it('wants exactly one root, with the scene id, called root', () => {
    expect(codes(changed('data-composition-id="scene-01"', 'data-composition-id="scene-02"'))).toEqual(
      expect.arrayContaining(['wrong_composition_id', 'missing_root']),
    );
    expect(codes(changed('<div id="root" data-composition-id', '<div id="stage" data-composition-id'))).toContain('root_id');
    expect(codes(changed(' data-composition-id="scene-01"', ''))).toContain('missing_root');
  });

  it('refuses a scene that mounts another composition', () => {
    expect(codes(inMarkup('<div data-composition-src="compositions/other.html"></div>'))).toContain('nested_composition');
  });

  it('wants one paused timeline, registered under the scene id', () => {
    expect(codes(changed('{ paused: true }', '{}'))).toContain('timeline_not_paused');
    expect(codes(inScript('const other = gsap.timeline({ paused: true });'))).toContain('timeline_count');
    expect(codes(changed('window.__timelines["scene-01"] = tl;', 'window.__timelines["scene-02"] = tl;'))).toContain('timeline_not_registered');
    expect(codes(GOOD.replace(/<script>[\s\S]*<\/script>/, ''))).toContain('missing_timeline');
  });

  it('times every clip inside the scene', () => {
    expect(codes(inMarkup('<div class="clip" data-start="0">x</div>'))).toContain('clip_missing_timing');
    expect(codes(inMarkup('<div class="clip" data-start="-1" data-duration="1" data-track-index="1"></div>'))).toContain('clip_bad_timing');
    expect(codes(inMarkup('<div class="clip" data-start="2" data-duration="1.5" data-track-index="1"></div>'))).toContain('clip_outside_scene');
    expect(codes(inMarkup('<div class="clip" data-start="0" data-duration="3" data-track-index="1"></div>'))).toEqual([]);
  });

  it('wants every video muted and timed', () => {
    expect(codes(inMarkup('<video class="clip" src="assets/ast_2.mp4" data-start="0" data-duration="3" data-track-index="1"></video>'))).toContain('video_sound');
    expect(codes(inMarkup('<video src="assets/ast_2.mp4" muted></video>'))).toContain('video_not_clip');
    expect(codes(inMarkup('<video class="clip" src="assets/ast_2.mp4" muted playsinline data-start="0" data-duration="3" data-track-index="1"></video>'))).toEqual([]);
  });

  it('refuses a scene past the size limit', () => {
    const huge = changed('</style>', `/* ${'x'.repeat(MAX_SCENE_BYTES)} */</style>`);
    expect(codes(huge)).toEqual(['scene_too_large']);
  });
});

describe('what a scene may reach', () => {
  it('refuses elements that load, navigate or embed', () => {
    for (const markup of ['<iframe src="assets/ast_1.png"></iframe>', '<link rel="stylesheet" href="x.css">', '<a href="#x">x</a>', '<form></form>', '<meta http-equiv="refresh">', '<object data="x"></object>', '<base href="/">']) {
      expect(codes(inMarkup(markup)), markup).toContain('forbidden_element');
    }
  });

  it('refuses handlers, script addresses and files it was not given', () => {
    expect(codes(inMarkup('<div onclick="x()"></div>'))).toContain('event_handler');
    expect(codes(inMarkup('<img src="javascript:alert(1)" alt="">'))).toEqual(expect.arrayContaining(['script_url', 'unknown_file']));
    expect(codes(inMarkup('<img src="https://example.com/x.png" alt="">'))).toContain('unknown_file');
    expect(codes(inMarkup('<img src="assets/../secret.png" alt="">'))).toContain('unknown_file');
    expect(codes(inMarkup('<img src="data:image/png;base64,AAAA" alt="">'))).toContain('unknown_file');
    expect(codes(inMarkup('<img srcset="assets/ast_1.png 2x" alt="">'))).toContain('srcset');
  });

  it('lets an SVG refer to its own shapes', () => {
    expect(codes(inMarkup('<svg><defs><path id="scene-01-p" d="M0 0"/></defs><use href="#scene-01-p"/></svg>'))).toEqual([]);
  });

  it('keeps stylesheets to the engine faces and the given files', () => {
    expect(codes(inStyle('@import url("x.css");'))).toContain('css_import');
    expect(codes(inStyle('@font-face { font-family: X; src: url(assets/ast_1.png); }'))).toContain('font_face');
    expect(codes(inStyle('#scene-01-title { background: url(https://example.com/x.png); }'))).toContain('unknown_file');
    expect(codes(inStyle('#scene-01-title { background: url(assets/ast_1.png); }'))).toEqual([]);
    expect(codes(inStyle('#scene-01-title { font-family: "Comic Sans MS", sans-serif; }'))).toContain('unknown_font');
    expect(codes(inStyle('#scene-01-title { font-family: "Space Grotesk", serif; }'))).toEqual([]);
    expect(codes(inStyle('#scene-01-title { font: 700 40px Arial; }'))).toContain('font_shorthand');
    expect(codes(inStyle('#scene-01-title { behavior: url(x.htc); }'))).toContain('css_script');
  });

  it('refuses every way a script could reach the network, storage or the page', () => {
    const cases: Record<string, string> = {
      fetch: 'fetch("assets/ast_1.png");',
      xhr: 'new XMLHttpRequest();',
      socket: 'new WebSocket("wss://x");',
      eval: 'eval("1");',
      builtFunction: 'new Function("return 1");',
      dynamicImport: 'import("x");',
      storage: 'localStorage.setItem("a", "b");',
      cookie: 'document.cookie;',
      navigation: 'location.href = "x";',
      markup: 'document.body.innerHTML = "<b>x</b>";',
      scriptElement: 'document.createElement("script");',
      urlAttribute: 'el.setAttribute("src", "x");',
      urlProperty: 'el.src = "x";',
      address: 'const u = "https://example.com";',
      worker: 'new Worker("x.js");',
    };
    for (const [name, code] of Object.entries(cases)) {
      expect(codes(inScript(code)), name).toContain('forbidden_script');
    }
    expect(codes(changed('<script>', '<script src="vendor/x.js">'))).toContain('external_script');
    expect(codes(changed('<script>', '<script type="module">'))).toContain('script_type');
  });

  it('allows the calls a scene legitimately makes', () => {
    const code = [
      'const el = document.createElement("span");',
      'el.textContent = "rows";',
      'document.querySelector("#scene-01-title").appendChild(el);',
      'const words = gsap.utils.toArray(".scene-01-word");',
    ].join('\n');
    expect(codes(inScript(code))).toEqual([]);
  });
});

describe('the studio frame', () => {
  const framed = changed('<div id="scene-01-title">Forty unmatched rows.</div>', '<div id="scene-01-frame" class="ao-frame ao-frame--center-left"><div id="scene-01-title">Forty unmatched rows.</div></div>');

  it('is where type is placed', () => {
    expect(codes(framed, { expectsFrame: true })).toEqual([]);
    const warnings = validateScene(GOOD, { ...context, expectsFrame: true }).filter((finding) => finding.severity === 'warning');
    expect(warnings.map((finding) => finding.code)).toEqual(['studio_frame_unused']);
  });

  it('is never restyled, since every scene shares it', () => {
    expect(codes(changed('</style>', '#root .ao-frame { justify-content: flex-start; }\n</style>').replace('<div id="scene-01-title">', '<div class="ao-frame ao-frame--center-left"><div id="scene-01-title">'))).toContain('studio_frame_restyled');
    expect(codes(framed.replace('class="ao-frame ao-frame--center-left"', 'class="ao-frame ao-frame--center-left" style="top: 0"'))).toContain('studio_frame_restyled');
  });

  it('is never selected by class from a script, which would move every scene’s frame', () => {
    expect(codes(inScript('tl.fromTo(".ao-frame", { opacity: 0 }, { opacity: 1 }, 0);'))).toContain('studio_frame_selected');
    expect(codes(inScript('tl.fromTo("#scene-01-frame", { opacity: 0 }, { opacity: 1 }, 0);'))).toEqual([]);
  });
});

describe('a scene is a function of time', () => {
  it('refuses randomness, clocks, timers and animation the browser runs', () => {
    const cases: Record<string, string> = {
      random: 'const r = Math.random();',
      now: 'const t = Date.now();',
      date: 'const d = new Date();',
      performance: 'performance.now();',
      timeout: 'setTimeout(() => 1, 10);',
      frame: 'requestAnimationFrame(() => 1);',
      forever: 'tl.fromTo("#scene-01-title", { x: 0 }, { x: 1, repeat: -1 }, 0);',
      yoyo: 'tl.fromTo("#scene-01-title", { x: 0 }, { x: 1, yoyo: true }, 0);',
      tween: 'gsap.to("#scene-01-title", { x: 1 });',
      delayed: 'gsap.delayedCall(1, () => 1);',
    };
    for (const [name, code] of Object.entries(cases)) {
      expect(codes(inScript(code)), name).toContain('nondeterministic');
    }
    expect(codes(inStyle('#scene-01-title { transition: opacity 1s; }'))).toContain('css_transition');
    expect(codes(inStyle('@keyframes spin { to { transform: rotate(1turn); } }'))).toContain('css_animation');
    expect(codes(inStyle('#scene-01-title { animation-name: spin; }'))).toContain('css_animation');
  });

  it('does not mistake a word inside a string for a call', () => {
    expect(codes(inScript('const note = "Math.random() is not used";'))).not.toContain('nondeterministic');
  });
});

describe('no word on screen the storyboard did not write', () => {
  it('refuses an invented word in the markup', () => {
    expect(codes(changed('Forty unmatched rows.', 'Forty unmatched rows. Guaranteed.'))).toContain('invented_text');
  });

  it('refuses an invented word revealed from a script', () => {
    expect(codes(inScript('const line = "Forty happy customers";'))).toContain('invented_text');
  });

  it('refuses a figure nobody published, and allows the ones they did and a count starting at zero', () => {
    expect(codes(changed('Forty unmatched rows.', 'Forty unmatched rows: 99%'))).toContain('invented_figure');
    expect(codes(changed('Forty unmatched rows.', '12,500 invoices'))).toEqual([]);
    expect(codes(changed('Forty unmatched rows.', '0 invoices'))).toEqual([]);
    expect(codes(changed('Forty unmatched rows.', '0.0 invoices'))).toEqual([]);
  });

  it('is not fooled by case, entities or CSS values in strings', () => {
    expect(codes(changed('Forty unmatched rows.', 'FORTY &nbsp;UNMATCHED ROWS.'))).toEqual([]);
    expect(codes(inScript('gsap.set("#scene-01-title", { transformOrigin: "left center" });'))).toEqual([]);
  });

  it('does not read an SVG title or description as words on screen', () => {
    expect(codes(inMarkup('<svg><title>Decorative rule</title><desc>Nothing to read</desc><rect width="1" height="1"/></svg>'))).toEqual([]);
  });

  it('reads the words an SVG does draw', () => {
    expect(codes(inMarkup('<svg><text>Free trial</text></svg>'))).toContain('invented_text');
  });
});
