import { describe, expect, it } from 'vitest';
import { parseXml, sanitizeSvg, SvgRejected } from '../svg/sanitize-svg.ts';

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32" width="120" height="32">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="rgb(10, 20, 30)"/><stop offset="1" stop-color="#ff0066"/></linearGradient></defs>' +
  '<path d="M0 0h10v10z" fill="url(#g)"/><text x="12" y="20" font-family="Brand Sans">Acme &amp; Co</text></svg>';

describe('sanitizeSvg keeps a real logo intact', () => {
  it('keeps geometry, gradients, internal references and text', () => {
    const { svg, width, height, removed } = sanitizeSvg(LOGO);
    expect(width).toBe(120);
    expect(height).toBe(32);
    expect(removed).toEqual([]);
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain('<linearGradient id="g">');
    expect(svg).toContain('Acme &amp; Co');
    // The output is itself well-formed under the same strict parser.
    expect(() => parseXml(svg)).not.toThrow();
  });

  it('always declares the SVG namespace, and xlink only when used', () => {
    expect(sanitizeSvg('<svg><rect width="1" height="1"/></svg>').svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    const withXlink = sanitizeSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/><g id="a"/></svg>').svg;
    expect(withXlink).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(sanitizeSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><g/></svg>').svg).not.toContain('xmlns:xlink');
  });

  it('keeps an embedded raster image, and only an image', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeSvg(`<svg><image href="${png}" width="4" height="4"/></svg>`).svg).toContain(png);
    expect(sanitizeSvg(`<svg><use href="${png}"/></svg>`).svg).not.toContain('data:');
  });
});

describe('sanitizeSvg removes everything that executes or reaches out', () => {
  it.each([
    ['a script element', '<svg><script>alert(1)</script><rect width="1" height="1"/></svg>', /script/],
    ['an event handler', '<svg onload="alert(1)"><rect onclick="x()" width="1" height="1"/></svg>', /on(load|click)/],
    ['a foreign object', '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>', /foreignObject|div/],
    ['a style element', '<svg><style>@import url(https://evil.test/x.css);</style><rect width="1" height="1"/></svg>', /style|evil/],
    ['an animation', '<svg><rect width="1" height="1"><animate attributeName="x" to="9"/><set attributeName="href" to="javascript:alert(1)"/></rect></svg>', /animate|set|javascript/],
    ['an external href', '<svg><use href="https://evil.test/sprite.svg#a"/></svg>', /evil/],
    ['an external url() reference', '<svg><rect fill="url(https://evil.test/p.svg#g)" width="1" height="1"/></svg>', /evil/],
    ['a javascript: href hidden by entities', '<svg><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', /javascript|href/],
    ['a javascript: href split by whitespace', '<svg><use href="java&#9;script:alert(1)"/></svg>', /script/],
    ['a class and an inline style', '<svg class="x"><rect style="fill:url(https://evil.test)" class="y" width="1" height="1"/></svg>', /class|style|evil/],
    ['a foreign namespace declaration', '<svg xmlns:ev="http://www.w3.org/2001/xml-events"><rect width="1" height="1"/></svg>', /xmlns:ev/],
  ])('%s', (_label, input, forbidden) => {
    const { svg } = sanitizeSvg(input);
    expect(svg).not.toMatch(forbidden);
  });

  it('unwraps a link but keeps what it contained', () => {
    const { svg, removed } = sanitizeSvg('<svg><a href="https://acme.test"><rect width="4" height="4"/></a></svg>');
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');
    expect(removed).toContain('<a> (unwrapped)');
  });
});

describe('the strict parser refuses rather than repairs', () => {
  it.each([
    ['a DOCTYPE with entities', '<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]><svg>&b;</svg>'],
    ['CDATA', '<svg><text><![CDATA[x]]></text></svg>'],
    ['a processing instruction', '<svg><?php echo 1; ?></svg>'],
    ['an unknown entity', '<svg><text>&nbsp;</text></svg>'],
    ['a bare ampersand', '<svg><text>A & B</text></svg>'],
    ['mismatched tags', '<svg><g></svg></g>'],
    ['a repeated attribute', '<svg width="1" width="2"/>'],
    ['a < inside a value', '<svg aria-label="a<b"/>'],
    ['content after the root', '<svg/><svg/>'],
    ['an unclosed element', '<svg><g>'],
    ['a non-svg root', '<html><svg/></html>'],
    ['an invalid character reference', '<svg><text>&#0;</text></svg>'],
    ['no whitespace between attributes', '<svg width="1"height="2"/>'],
  ])('%s', (_label, input) => {
    expect(() => sanitizeSvg(input)).toThrow(SvgRejected);
  });

  it('bounds nesting depth and size', () => {
    const deep = `${'<g>'.repeat(80)}${'</g>'.repeat(80)}`;
    expect(() => sanitizeSvg(`<svg>${deep}</svg>`)).toThrow(/deeply/);
    expect(() => sanitizeSvg(`<svg>${' '.repeat(1_000_001)}</svg>`)).toThrow(/larger/);
  });

  it('accepts an XML declaration, comments and a byte-order mark', () => {
    const { svg } = sanitizeSvg('﻿<?xml version="1.0" encoding="UTF-8"?><!-- made by hand --><svg><!-- inner --><rect width="1" height="1"/></svg>');
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  });

  it('escapes on the way out whatever it decoded on the way in', () => {
    const { svg } = sanitizeSvg('<svg aria-label="&quot;A&quot; &lt;B&gt; &amp; C"><text>&lt;tag&gt;</text></svg>');
    expect(svg).toContain('aria-label="&quot;A&quot; &lt;B&gt; &amp; C"');
    expect(svg).toContain('<text>&lt;tag&gt;</text>');
  });
});
