import { describe, it, expect } from 'vitest';
import {
  doNotTranslate,
  droppedTerms,
  expansionFactor,
  figureDrift,
  figuresIn,
  isFilmLanguage,
  languageInEnglish,
  roomForText,
} from '../index.ts';

/**
 * Working in another language.
 *
 * The interesting failures here are not mistranslations — no test can catch
 * one of those — but the mechanical ones: a figure that changed value, a
 * product name that got translated, a line with no room left to say it in.
 */

describe('how much room a language needs', () => {
  it('knows which languages run longer than English and which run shorter', () => {
    expect(expansionFactor('en', 'de')).toBeCloseTo(1.3, 2);
    expect(expansionFactor('en', 'zh')).toBeCloseTo(0.55, 2);
    expect(expansionFactor('en', 'en')).toBe(1);
  });

  it('measures between two languages, not just against English', () => {
    // German to French is a slight contraction, not the 20% expansion the
    // figure against English would suggest on its own.
    expect(expansionFactor('de', 'fr')).toBeLessThan(1);
    expect(expansionFactor('fr', 'de')).toBeGreaterThan(1);
  });

  it('falls back to a European average for a language nobody measured', () => {
    expect(expansionFactor('en', 'xx')).toBe(1);
    expect(expansionFactor(null, null)).toBe(1);
  });

  it('lets a short line double, because a short line has no redundancy to lose', () => {
    // "One run" is seven characters and its French is "Un traitement", which is
    // thirteen. A flat 1.2 would give it eight, and there is no eight-character
    // French for it — which is exactly what the W3C bands are about.
    const room = roomForText('One run', 'en', 'fr');
    expect(room).toBeGreaterThanOrEqual('Un traitement'.length);
    expect(room).toBe(14);
  });

  it('settles down to the language factor once the line is long enough to absorb it', () => {
    const long = 'Close the books in a morning instead of a week of reconciling four systems by hand';
    expect(long.length).toBeGreaterThan(70);
    expect(roomForText(long, 'en', 'de')).toBe(Math.round(long.length * 1.3));
  });

  it('never squeezes a line for a language that happens to be shorter', () => {
    // Japanese does not have to be shorter than the English; it usually is.
    const line = 'Close the books in a morning';
    expect(roomForText(line, 'en', 'ja')).toBeGreaterThanOrEqual(line.length);
  });

  it('never hands a short line a budget no language could use', () => {
    expect(roomForText('Ship.', 'en', 'zh')).toBeGreaterThanOrEqual(12);
  });

  it('names a language in English for a brief, and in its own for a customer', () => {
    expect(languageInEnglish('ja')).toBe('Japanese');
    expect(languageInEnglish('de')).toBe('German');
    expect(isFilmLanguage('de')).toBe(true);
    expect(isFilmLanguage('xx')).toBe(false);
  });
});

describe('figures, which may be written differently and never be different', () => {
  it('reads a figure through whatever separators the locale uses', () => {
    expect(figuresIn('1.5 million rows')).toEqual(['15']);
    expect(figuresIn('1,5 millions de lignes')).toEqual(['15']);
    expect(figuresIn('12 000 rows in 4 systems')).toEqual(['12000', '4']);
  });

  it('passes a translation that reformatted a number correctly', () => {
    expect(figureDrift('Close 1.5 million rows', 'Clôturez 1,5 million de lignes')).toEqual({
      missing: [],
      added: [],
    });
  });

  it('catches a figure that changed value', () => {
    const drift = figureDrift('Four systems, one ledger, 40 hours', 'Vier Systeme, ein Hauptbuch, 14 Stunden');
    expect(drift.missing).toContain('40');
    expect(drift.added).toContain('14');
  });

  it('catches a figure that was dropped, and one that was invented', () => {
    expect(figureDrift('40 hours a month', 'des heures chaque mois').missing).toEqual(['40']);
    expect(figureDrift('hours a month', '40 heures chaque mois').added).toEqual(['40']);
  });

  it('counts repeats, so two of a figure is not one of it', () => {
    expect(figureDrift('4 and 4', '4').missing).toEqual(['4']);
  });
});

describe('words that cross unchanged', () => {
  it('builds the list from what the project already knows', () => {
    expect(
      doNotTranslate({
        companyName: 'Northwind',
        productName: 'Northwind Close',
        websiteUrl: 'https://www.northwind.example/pricing',
      }),
    ).toEqual(['Northwind', 'Northwind Close', 'northwind.example']);
  });

  it('ignores an address it cannot read rather than inventing a term', () => {
    expect(doNotTranslate({ companyName: 'Northwind', websiteUrl: 'not a url' })).toEqual(['Northwind']);
  });

  it('drops a one-letter name, which would match every line ever written', () => {
    expect(doNotTranslate({ companyName: 'X', productName: 'Close' })).toEqual(['Close']);
  });

  it('reports a name that was translated away', () => {
    expect(droppedTerms('Fermez les livres avec Vent du Nord', ['Northwind'])).toEqual(['Northwind']);
    expect(droppedTerms('Fermez les livres avec Northwind', ['Northwind'])).toEqual([]);
  });
});
