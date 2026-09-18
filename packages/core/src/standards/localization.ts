import type { Standard } from './standard.ts';

/**
 * Working in another language.
 *
 * Most of what goes wrong here is not mistranslation. It is a line that is
 * correct and does not fit: a French narration written from an English script
 * runs a fifth longer and arrives after the shot has cut, a German headline
 * breaks to three lines where the English took one, a figure comes back with
 * the separators swapped and now says something else.
 *
 * So the rules below are mostly about time and room, and one of them is a
 * research finding rather than a style guide — the most useful thing anybody
 * has established about speech in this context.
 */
export const LOCALIZATION_STANDARDS = {
  languageTag: {
    id: 'localization.language_tag',
    rule: 'Every piece of text carries the language it is written in, as a BCP 47 tag.',
    source: 'IETF BCP 47 / RFC 5646',
    authority: 'normative',
    enforcement: 'designed_in',
    because:
      'A voice engine, a caption renderer and a screen reader each behave differently per ' +
      'language, and none of them can guess. An untagged film is read with the wrong accent.',
  },
  nativeWriter: {
    id: 'localization.native_writer',
    rule: 'The film is written and read by a native of the language it is in, never by a foreign speaker of it.',
    source: 'ISO 17100:2015',
    clause: 'Translator competences',
    authority: 'normative',
    enforcement: 'designed_in',
    because:
      'An accent nobody in the market has is the single most recognisable sign that a film was ' +
      'made somewhere else, and it undoes every other thing the film does well.',
  },
  sameClock: {
    id: 'localization.same_clock',
    rule: 'A line is written to the seconds it has, not translated from the words it had.',
    source: 'Pellegrino, Coupé & Marsico, “A cross-language perspective on speech information rate”, Language 87(3)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Languages trade syllable rate against information density, so the same idea takes about ' +
      'the same time to say in any of them — but not the same number of words. Writing to the ' +
      'clock lands on the picture; translating the words does not.',
  },
  textExpansion: {
    id: 'localization.text_expansion',
    rule: 'On-screen text is written to the room it has in the new language, which is usually less.',
    source: 'W3C Internationalization, “Text size in translation”',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Most European languages run 10 to 35% longer than English, and the shorter the string the ' +
      'worse it gets. A headline that fitted one line becomes three, and the layout it was ' +
      'composed for is gone.',
  },
  doNotTranslate: {
    id: 'localization.do_not_translate',
    rule: 'Product names, company names, addresses and figures cross unchanged.',
    source: 'ASTM F2575; Unicode CLDR for formatting',
    clause: 'Terminology and do-not-translate lists',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'A translated product name is a product nobody can search for. Figures keep their value ' +
      'and take the locale’s separators — the number may be written differently, never be a ' +
      'different number.',
  },
  register: {
    id: 'localization.register',
    rule: 'The brand’s register survives the language, including how it addresses the viewer.',
    source: 'ASTM F2575',
    clause: 'Specifications: purpose, audience and register',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'Half of Europe distinguishes a formal and an informal address, and picking the wrong one ' +
      'is not a small error — it decides whether the film sounds like a colleague or a bank.',
  },
} as const satisfies Record<string, Standard>;
