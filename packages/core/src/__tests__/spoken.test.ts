import { describe, it, expect } from 'vitest';
import { adaptForSpeech, numberToWords } from '../index.ts';

/**
 * Copy made speakable: the numbers a reader resolves without noticing, said
 * the way a narrator would say them, in the language of the line.
 */
describe('numbers in English', () => {
  it('says integers, decimals and scales', () => {
    expect(numberToWords(0, 'en')).toBe('zero');
    expect(numberToWords(21, 'en')).toBe('twenty-one');
    expect(numberToWords(105, 'en')).toBe('one hundred five');
    expect(numberToWords(1234, 'en')).toBe('one thousand two hundred thirty-four');
    expect(numberToWords(2_500_000, 'en')).toBe('two million five hundred thousand');
    expect(numberToWords(24.7, 'en')).toBe('twenty-four point seven');
    expect(numberToWords(3.14, 'en')).toBe('three point one four');
  });

  it('turns the example line into what a narrator says', () => {
    expect(adaptForSpeech('Revenue increased by 24.7% QoQ.', { language: 'en' })).toBe(
      'Revenue increased by twenty-four point seven percent quarter over quarter.',
    );
  });

  it('handles money, scales, years, ordinals and multipliers', () => {
    expect(adaptForSpeech('Raised $1.2M in 2024, our 3rd round; 10k users, 2x growth.', { language: 'en' })).toBe(
      'Raised one point two million dollars in twenty twenty-four, our third round; ten thousand users, two times growth.',
    );
    expect(adaptForSpeech('It costs $12.50 a month.', { language: 'en' })).toBe(
      'It costs twelve dollars fifty a month.',
    );
    expect(adaptForSpeech('Since 2007.', { language: 'en' })).toBe('Since two thousand seven.');
    expect(adaptForSpeech('Over 1,200 teams.', { language: 'en' })).toBe('Over one thousand two hundred teams.');
  });

  it('spells initialisms and leaves words alone', () => {
    expect(adaptForSpeech('Our API and SDK, built for CRM teams at NASA.', { language: 'en' })).toBe(
      'Our A P I and S D K, built for C R M teams at NASA.',
    );
    expect(adaptForSpeech('B2B SaaS, YoY.', { language: 'en' })).toBe('B to B sass, year over year.');
  });

  it("applies the organisation's own pronunciations first", () => {
    expect(
      adaptForSpeech('Welcome to Ornikar, by Amine.', {
        language: 'en',
        pronunciations: [
          { term: 'Ornikar', say: 'Or-nee-car', language: null },
          { term: 'Amine', say: 'Ah-meen', language: 'en' },
        ],
      }),
    ).toBe('Welcome to Or-nee-car, by Ah-meen.');
  });

  it('turns dashes into breaths and closes the sentence', () => {
    expect(adaptForSpeech('One idea — one film', { language: 'en' })).toBe('One idea, one film.');
    expect(adaptForSpeech('Design/build in a day', { language: 'en' })).toBe('Design or build in a day.');
  });
});

describe('numbers in French', () => {
  it('counts the French way', () => {
    expect(numberToWords(21, 'fr')).toBe('vingt et un');
    expect(numberToWords(71, 'fr')).toBe('soixante et onze');
    expect(numberToWords(80, 'fr')).toBe('quatre-vingts');
    expect(numberToWords(81, 'fr')).toBe('quatre-vingt-un');
    expect(numberToWords(99, 'fr')).toBe('quatre-vingt-dix-neuf');
    expect(numberToWords(200, 'fr')).toBe('deux cents');
    expect(numberToWords(201, 'fr')).toBe('deux cent un');
    expect(numberToWords(1000, 'fr')).toBe('mille');
    expect(numberToWords(2026, 'fr')).toBe('deux mille vingt-six');
    expect(numberToWords(1_500_000, 'fr')).toBe('un million cinq cent mille');
    expect(numberToWords(24.7, 'fr')).toBe('vingt-quatre virgule sept');
  });

  it('reads the French comma as a decimal and says pour cent', () => {
    expect(adaptForSpeech("Le chiffre d'affaires a augmenté de 24,7 % QoQ.", { language: 'fr' })).toBe(
      "Le chiffre d'affaires a augmenté de vingt-quatre virgule sept pour cent d'un trimestre sur l'autre.",
    );
    expect(adaptForSpeech('Plus de 1 200 équipes, 3 € par mois.', { language: 'fr' })).toBe(
      'Plus de mille deux cents équipes, trois euros par mois.',
    );
    expect(adaptForSpeech('Le 1er avril, la 2e version.', { language: 'fr' })).toBe(
      'Le premier avril, la deuxième version.',
    );
  });

  it('keeps digits in a language it cannot count in', () => {
    expect(adaptForSpeech('Über 1.200 Teams.', { language: 'de' })).toBe('Über 1.200 Teams.');
  });
});
