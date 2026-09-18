import { NARRATION_WORDS_PER_SECOND } from '../standards/typography.ts';
import type { PronunciationRule } from './voice.ts';

/**
 * Written copy, made speakable.
 *
 * A line written to be read has numerals, symbols and abbreviations a reader
 * resolves without noticing and a narrator has to say: "24.7% QoQ" is six
 * words aloud. The engines normalise some of this themselves, differently,
 * and the difference is a wrong number in a customer's film. So it is done
 * here, deterministically, in the language of the line, before any engine
 * sees the text — and an organisation's own pronunciations come first.
 */
export type SpokenOptions = {
  /** ISO 639-1. Numbers are spelled out for the languages this knows; others keep digits. */
  language: string | null;
  pronunciations?: readonly PronunciationRule[];
};

export function adaptForSpeech(text: string, options: SpokenOptions): string {
  const language = (options.language ?? 'en').toLowerCase().slice(0, 2);
  let out = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!out) return '';

  out = applyPronunciations(out, language, options.pronunciations ?? []);
  out = expandAbbreviations(out, language);
  out = spellSymbols(out, language);
  out = spellNumbers(out, language);
  out = spellInitialisms(out);
  out = spokenPunctuation(out);
  return out;
}

// ---------------------------------------------------------------------------
// Pronunciations and abbreviations
// ---------------------------------------------------------------------------

function applyPronunciations(text: string, language: string, rules: readonly PronunciationRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (rule.language && rule.language.toLowerCase().slice(0, 2) !== language) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(rule.term)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(pattern, rule.say);
  }
  return out;
}

const ABBREVIATIONS: Record<string, Record<string, string>> = {
  en: {
    QoQ: 'quarter over quarter',
    YoY: 'year over year',
    MoM: 'month over month',
    'vs.': 'versus',
    vs: 'versus',
    'e.g.': 'for example',
    'i.e.': 'that is',
    'etc.': 'and so on',
    'approx.': 'approximately',
    SaaS: 'sass',
    B2B: 'B to B',
    B2C: 'B to C',
    'Q1': 'Q one',
    'Q2': 'Q two',
    'Q3': 'Q three',
    'Q4': 'Q four',
    'H1': 'H one',
    'H2': 'H two',
    hrs: 'hours',
    mins: 'minutes',
    sec: 'seconds',
  },
  fr: {
    QoQ: "d'un trimestre sur l'autre",
    YoY: "d'une année sur l'autre",
    MoM: "d'un mois sur l'autre",
    vs: 'contre',
    'vs.': 'contre',
    'p. ex.': 'par exemple',
    'c.-à-d.': "c'est-à-dire",
    'etc.': 'et cetera',
    'env.': 'environ',
    SaaS: 'sass',
    B2B: 'B to B',
    B2C: 'B to C',
    T1: 'premier trimestre',
    T2: 'deuxième trimestre',
    T3: 'troisième trimestre',
    T4: 'quatrième trimestre',
    'M.': 'Monsieur',
    'Mme': 'Madame',
    'nb': 'nombre',
  },
};

function expandAbbreviations(text: string, language: string): string {
  const table = ABBREVIATIONS[language] ?? ABBREVIATIONS['en']!;
  let out = text;
  for (const [term, said] of Object.entries(table)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, 'gu');
    out = out.replace(pattern, said);
  }
  return out;
}

/** Two to four capitals with no vowel, or a known initialism, are said letter by letter. */
const INITIALISMS = new Set([
  'API', 'APIS', 'SDK', 'CRM', 'ERP', 'KPI', 'KPIS', 'ROI', 'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CPO',
  'HR', 'IT', 'UI', 'UX', 'URL', 'HTML', 'CSS', 'SQL', 'AI', 'ML', 'IoT', 'GDPR', 'RGPD', 'SEO',
  'SEM', 'CPA', 'CPC', 'CPM', 'CTR', 'NPS', 'ARR', 'MRR', 'LTV', 'CAC', 'ETA', 'FAQ', 'PDF',
  'USB', 'GPS', 'LLM', 'OCR', 'VPN', 'SSO', 'MFA', 'PME', 'TPE', 'TVA', 'CDI', 'CDD', 'DSI',
]);

function spellInitialisms(text: string): string {
  return text.replace(/\b([A-Z]{2,5})(s?)\b/g, (whole, letters: string, plural: string) => {
    const vowels = /[AEIOUY]/.test(letters);
    if (!INITIALISMS.has(letters) && vowels) return whole;
    if (letters === 'IoT') return whole;
    return letters.split('').join(' ') + (plural ? 's' : '');
  });
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const SYMBOLS: Record<string, Record<string, string>> = {
  en: { '&': ' and ', '→': ' to ', '≈': ' about ', '+': ' plus ', '×': ' times ', '<': ' under ', '>': ' over ' },
  fr: { '&': ' et ', '→': ' vers ', '≈': ' environ ', '+': ' plus ', '×': ' fois ', '<': ' moins de ', '>': ' plus de ' },
};

function spellSymbols(text: string, language: string): string {
  const table = SYMBOLS[language] ?? SYMBOLS['en']!;
  let out = text;
  // "+" only between things, not as a sign in front of a number ("+12%" is "plus twelve percent" too).
  for (const [symbol, said] of Object.entries(table)) {
    out = out.split(symbol).join(said);
  }
  return out.replace(/\s{2,}/g, ' ');
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const CURRENCY: Record<string, Record<string, [string, string]>> = {
  en: { $: ['dollar', 'dollars'], '€': ['euro', 'euros'], '£': ['pound', 'pounds'] },
  fr: { $: ['dollar', 'dollars'], '€': ['euro', 'euros'], '£': ['livre', 'livres'] },
};

const SCALE_SUFFIX: Record<string, Record<string, number>> = {
  en: { k: 1_000, K: 1_000, M: 1_000_000, m: 1_000_000, B: 1_000_000_000, bn: 1_000_000_000 },
  fr: { k: 1_000, K: 1_000, M: 1_000_000, Md: 1_000_000_000, Mds: 1_000_000_000 },
};

function spellNumbers(text: string, language: string): string {
  if (language !== 'en' && language !== 'fr') return text;
  const currency = CURRENCY[language]!;
  const scales = SCALE_SUFFIX[language]!;
  const scaleNames = Object.keys(scales).sort((a, b) => b.length - a.length).map(escape).join('|');

  // Ordinals first: 1st, 2nd, 21st; 1er, 1re, 2e, 3ème.
  let out =
    language === 'en'
      ? text.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n: string) => ordinalEn(Number(n)))
      : text.replace(/\b(\d+)(er|re|ère|e|ème|èmes|es)\b/g, (_, n: string, suffix: string) =>
          ordinalFr(Number(n), suffix),
        );

  // Currency, plain and scaled: $1.2M, €340, $12.50, 5 €.
  const symbols = Object.keys(currency).map(escape).join('');
  out = out.replace(
    new RegExp(`([${symbols}])\\s?(\\d[\\d,. ]*\\d|\\d)(?:\\s?(${scaleNames}))?`, 'g'),
    (_, symbol: string, number: string, scale?: string) =>
      money(number, symbol, scale ? scales[scale] : undefined, language, currency),
  );
  out = out.replace(
    new RegExp(`(\\d[\\d,. ]*\\d|\\d)(?:\\s?(${scaleNames}))?\\s?([${symbols}])`, 'g'),
    (_, number: string, scale: string | undefined, symbol: string) =>
      money(number, symbol, scale ? scales[scale] : undefined, language, currency),
  );

  // Percentages: 24.7%, 24,7 %, 12 %.
  out = out.replace(/(\d[\d,. ]*\d|\d)\s?%/g, (_, number: string) => {
    const spoken = numberToWords(parseNumber(number, language), language);
    return `${spoken} ${language === 'fr' ? 'pour cent' : 'percent'}`;
  });

  // Scaled counts: 10k, 1.5M, 2B.
  out = out.replace(
    new RegExp(`\\b(\\d[\\d,.]*\\d|\\d)\\s?(${scaleNames})\\b`, 'g'),
    (whole, number: string, scale: string) => {
      const factor = scales[scale];
      if (!factor) return whole;
      return scaledWords(parseNumber(number, language), factor, language);
    },
  );

  // Multipliers: 2x, 10x.
  out = out.replace(/\b(\d+(?:[.,]\d+)?)x\b/g, (_, number: string) =>
    `${numberToWords(parseNumber(number, language), language)} ${language === 'fr' ? 'fois' : 'times'}`,
  );

  // Everything else numeric: decimals, thousands, years, plain integers.
  out = out.replace(/(?<![\p{L}\p{N}])(\d{1,3}(?:[ ,]\d{3})+|\d+)([.,]\d+)?(?![\p{L}\p{N}])/gu, (whole, integer: string, fraction?: string) => {
    const value = parseNumber(`${integer}${fraction ?? ''}`, language);
    if (!Number.isFinite(value)) return whole;
    if (!fraction && language === 'en' && isYear(value, integer)) return yearEn(value);
    return numberToWords(value, language);
  });

  return out.replace(/\s{2,}/g, ' ');
}

function money(
  number: string,
  symbol: string,
  factor: number | undefined,
  language: string,
  currency: Record<string, [string, string]>,
): string {
  const amount = parseNumber(number, language);
  const [one, many] = currency[symbol] ?? ['', ''];
  if (factor !== undefined) {
    // $1.2M is "one point two million dollars", the way it is read, never
    // "one million two hundred thousand dollars", the way it is counted.
    const scaled = scaledWords(amount, factor, language);
    if (language === 'fr' && factor >= 1_000_000) {
      return `${scaled} ${/^[aeiouyéè]/i.test(many) ? "d'" : 'de '}${many}`;
    }
    return `${scaled} ${many}`;
  }
  const unit = amount === 1 ? one : many;
  if (Number.isInteger(amount)) return `${numberToWords(amount, language)} ${unit}`;
  // 12.50: twelve dollars fifty.
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  return `${numberToWords(whole, language)} ${whole === 1 ? one : many} ${numberToWords(cents, language)}`;
}

const SCALE_WORDS: Record<string, Record<number, [string, string]>> = {
  en: { 1_000: ['thousand', 'thousand'], 1_000_000: ['million', 'million'], 1_000_000_000: ['billion', 'billion'] },
  fr: { 1_000: ['mille', 'mille'], 1_000_000: ['million', 'millions'], 1_000_000_000: ['milliard', 'milliards'] },
};

/** 1.5M as "one point five million", 10k as "ten thousand": the figure as written, then the scale as a word. */
function scaledWords(amount: number, factor: number, language: string): string {
  const words = SCALE_WORDS[language]?.[factor];
  if (!words) return numberToWords(amount * factor, language);
  const [one, many] = words;
  return `${numberToWords(amount, language)} ${amount < 2 ? one : many}`;
}

function parseNumber(raw: string, language: string): number {
  let s = raw.replace(/\s/g, '');
  if (language === 'fr') {
    // 1 234,5 — comma is the decimal separator; a dot is a thousands separator.
    if (/,\d{1,2}$/.test(s) || (/,/.test(s) && !/,\d{3}(\D|$)/.test(s))) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/[,.](?=\d{3}(\D|$))/g, '');
  } else {
    s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  }
  return Number(s);
}

function isYear(value: number, integer: string): boolean {
  return integer.length === 4 && value >= 1500 && value <= 2099;
}

// ---------------------------------------------------------------------------
// Number words
// ---------------------------------------------------------------------------

export function numberToWords(value: number, language: string): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `${language === 'fr' ? 'moins' : 'minus'} ${numberToWords(-value, language)}`;
  const whole = Math.floor(value);
  const fraction = round(value - whole);
  const wholeWords = language === 'fr' ? integerFr(whole) : integerEn(whole);
  if (fraction === 0) return wholeWords;
  const digits = String(fraction).slice(2);
  if (language === 'fr') {
    // Twenty-four point seven is "vingt-quatre virgule sept": the decimals are a number, not digits.
    return `${wholeWords} virgule ${integerFr(Number(digits))}`;
  }
  return `${wholeWords} point ${digits.split('').map((d) => integerEn(Number(d))).join(' ')}`;
}

function round(fraction: number): number {
  return Number(fraction.toFixed(6).replace(/0+$/, '')) || 0;
}

const EN_SMALL = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES: [number, string][] = [
  [1_000_000_000_000, 'trillion'],
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];

function integerEn(n: number): string {
  if (n < 20) return EN_SMALL[n]!;
  if (n < 100) {
    const tens = EN_TENS[Math.floor(n / 10)]!;
    return n % 10 === 0 ? tens : `${tens}-${EN_SMALL[n % 10]}`;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${EN_SMALL[Math.floor(n / 100)]} hundred${rest ? ` ${integerEn(rest)}` : ''}`;
  }
  for (const [scale, name] of EN_SCALES) {
    if (n >= scale) {
      const rest = n % scale;
      return `${integerEn(Math.floor(n / scale))} ${name}${rest ? ` ${integerEn(rest)}` : ''}`;
    }
  }
  return String(n);
}

function yearEn(year: number): string {
  if (year >= 2000 && year < 2010) return `two thousand${year % 100 ? ` ${integerEn(year % 100)}` : ''}`;
  const high = Math.floor(year / 100);
  const low = year % 100;
  return `${integerEn(high)} ${low < 10 ? `oh ${integerEn(low)}` : integerEn(low)}`;
}

function ordinalEn(n: number): string {
  const words = integerEn(n);
  const irregular: Record<string, string> = {
    one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
  };
  const parts = words.split(/(-| )/);
  const last = parts[parts.length - 1]!;
  const ordinal = irregular[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  parts[parts.length - 1] = ordinal;
  return parts.join('');
}

const FR_SMALL = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze',
  'douze', 'treize', 'quatorze', 'quinze', 'seize',
];
const FR_TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function integerFr(n: number): string {
  if (n < 17) return FR_SMALL[n]!;
  if (n < 20) return `dix-${FR_SMALL[n - 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    if (tens === 7 || tens === 9) {
      // 70 to 79 and 90 to 99 count on from sixty and eighty.
      const base = tens === 7 ? 'soixante' : 'quatre-vingt';
      const rest = n - (tens === 7 ? 60 : 80);
      if (tens === 7 && rest === 11) return 'soixante et onze';
      return `${base}-${integerFr(rest)}`;
    }
    if (unit === 0) return tens === 8 ? 'quatre-vingts' : FR_TENS[tens]!;
    if (unit === 1 && tens !== 8) return `${FR_TENS[tens]} et un`;
    return `${FR_TENS[tens]}-${FR_SMALL[unit]}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const head = hundreds === 1 ? 'cent' : `${FR_SMALL[hundreds]} cent${rest ? '' : 's'}`;
    return rest ? `${head} ${integerFr(rest)}` : head;
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    // "cent" is invariable in front of "mille": cinq cent mille, not cinq cents mille.
    const head = thousands === 1 ? 'mille' : `${integerFr(thousands).replace(/cents$/, 'cent')} mille`;
    return rest ? `${head} ${integerFr(rest)}` : head;
  }
  const scales: [number, string, string][] = [
    [1_000_000_000_000, 'billion', 'billions'],
    [1_000_000_000, 'milliard', 'milliards'],
    [1_000_000, 'million', 'millions'],
  ];
  for (const [scale, one, many] of scales) {
    if (n >= scale) {
      const count = Math.floor(n / scale);
      const rest = n % scale;
      const head = `${integerFr(count)} ${count === 1 ? one : many}`;
      return rest ? `${head} ${integerFr(rest)}` : head;
    }
  }
  return String(n);
}

function ordinalFr(n: number, suffix: string): string {
  if (n === 1) return suffix === 're' ? 'première' : 'premier';
  const words = integerFr(n);
  const base = words.endsWith('e') ? words.slice(0, -1) : words === 'cinq' ? 'cinqu' : words === 'neuf' ? 'neuv' : words;
  return `${base}ième${suffix === 'es' || suffix === 'èmes' ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Punctuation for the ear
// ---------------------------------------------------------------------------

function spokenPunctuation(text: string): string {
  let out = text
    // A dash is a breath, not a word.
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    // Slashes between words are a choice.
    .replace(/(\p{L})\/(\p{L})/gu, '$1 or $2')
    // Bullets and stray markup.
    .replace(/^[•\-*]\s+/gm, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (out && !/[.!?…]$/.test(out)) out += '.';
  return out;
}

function escape(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * How long a line takes to say, before any audio exists.
 *
 * Used by the storyboard engine to set scene durations against real
 * narration length, and by the narration engine to decide whether a line
 * fits its room or has to be rewritten shorter. Sentence breaks carry real
 * pauses; a naive words-per-second estimate runs consistently short and
 * pushes narration past the cut.
 */
export function estimateNarrationSeconds(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const base = words / NARRATION_WORDS_PER_SECOND;
  const sentences = (text.match(/[.!?]+/g) ?? []).length;
  return Math.round(((base + sentences * 0.32) / rate) * 100) / 100;
}
