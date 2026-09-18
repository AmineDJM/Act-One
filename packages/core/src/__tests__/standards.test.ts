import { describe, it, expect } from 'vitest';
import {
  AUDIO_STANDARDS,
  COLOR_STANDARDS,
  CONTRAST_AA_LARGE,
  CONTRAST_AA_NORMAL,
  CONVERSION_STANDARDS,
  EDITORIAL_STANDARDS,
  LAYOUT_STANDARDS,
  LUFS_BROADCAST,
  MODULAR_SCALES,
  MOTION_STANDARDS,
  SAFE_AREAS,
  TITLE_SAFE_INSET,
  TRUE_PEAK_CEILING,
  TYPE_STANDARDS,
  cite,
  containsStatistic,
  contrastFloorInFrame,
  ctaIsVague,
  derivedId,
  displayHost,
  endsDangling,
  firstClause,
  indexStandards,
  isId,
  isLargeText,
  leadingFor,
  loudnessWithinTolerance,
  longestRun,
  modularStep,
  opensOnSubject,
  rhythmVariation,
  superlativesIn,
  trackingScaleFor,
  weaselPhrasesIn,
  withinInset,
} from '../index.ts';

const ALL = [
  COLOR_STANDARDS,
  TYPE_STANDARDS,
  LAYOUT_STANDARDS,
  MOTION_STANDARDS,
  AUDIO_STANDARDS,
  EDITORIAL_STANDARDS,
  CONVERSION_STANDARDS,
];

describe('the standards themselves', () => {
  it('gives every rule an id, a source and a reason', () => {
    for (const group of ALL) {
      for (const [key, standard] of Object.entries(group)) {
        expect(standard.id, key).toMatch(/^[a-z_]+\.[a-z_]+$/);
        expect(standard.source.length, key).toBeGreaterThan(3);
        expect(standard.because.length, key).toBeGreaterThan(20);
      }
    }
  });

  it('keeps ids unique across every area', () => {
    const index = indexStandards(...ALL);
    const declared = ALL.reduce((sum, group) => sum + Object.keys(group).length, 0);
    expect(index.size).toBe(declared);
  });

  it('says how every rule is actually kept', () => {
    // Stated separately from what the rule says, because the two are different
    // claims: a document that quietly describes checks nobody wrote is worse
    // than one that admits which rules are only written down.
    for (const group of ALL) {
      for (const [key, standard] of Object.entries(group)) {
        expect(['checked', 'designed_in', 'documented'], key).toContain(standard.enforcement);
      }
    }
  });

  it('checks the rule that is about harm, not only the ones about taste', () => {
    // Everything else here is quality. This one can hurt somebody, so being
    // merely documented is not good enough for it.
    expect(MOTION_STANDARDS.flashRate.enforcement).toBe('checked');
  });

  it('checks what a customer would be held to legally', () => {
    // Superlatives and unsourced figures are objective claims in advertising
    // law, made in the customer's name. They are not stylistic preferences.
    expect(EDITORIAL_STANDARDS.superlatives.enforcement).toBe('checked');
    expect(EDITORIAL_STANDARDS.numbers.enforcement).toBe('checked');
    expect(EDITORIAL_STANDARDS.attribution.enforcement).toBe('checked');
  });

  it('never claims a published clause for a house rule', () => {
    // The distinction is the whole point: a rule we invented must not be
    // dressed up as one somebody standardised.
    for (const group of ALL) {
      for (const [key, standard] of Object.entries(group)) {
        if (standard.authority !== 'house') continue;
        expect(standard.source, key).toMatch(/Act One|house/i);
      }
    }
  });

  it('never repeats the source inside the clause', () => {
    // A citation reading "EBU R 103 R 103 signal tolerance" looks like a
    // transcription error, which is the opposite of what a citation is for.
    for (const group of ALL) {
      for (const [key, standard] of Object.entries(group)) {
        if (!standard.clause) continue;
        const words = standard.source.split(/[\s/]+/).filter((w: string) => w.length > 1);
        for (const word of words) {
          expect(standard.clause.startsWith(`${word} `), `${key}: ${cite(standard)}`).toBe(false);
        }
      }
    }
  });

  it('cites a normative rule with its clause', () => {
    expect(cite(COLOR_STANDARDS.textContrast)).toBe('WCAG 2.2 SC 1.4.3 (Contrast Minimum, AA)');
    expect(cite(AUDIO_STANDARDS.truePeak)).toBe('EBU R 128 Maximum Permitted True Peak Level');
  });
});

describe('colour', () => {
  it('uses WCAG large text as WCAG defines it, not as 18px', () => {
    // The common mistake applies the weaker 3:1 floor to text that is legally
    // normal-sized, because 18pt is 24px and 18px is not 18pt.
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(18, 400)).toBe(false);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(18, 700)).toBe(false);
  });

  it('applies the stricter floor to type that is small in its frame', () => {
    expect(contrastFloorInFrame(20, 1080)).toBe(CONTRAST_AA_NORMAL);
    expect(contrastFloorInFrame(120, 1080)).toBe(CONTRAST_AA_LARGE);
  });

  it('gives the same answer for a 4K frame as for the 1080p one', () => {
    expect(contrastFloorInFrame(240, 2160)).toBe(contrastFloorInFrame(120, 1080));
  });
});

describe('typography', () => {
  it('tightens leading as type grows', () => {
    const display = leadingFor(1080 * 0.1, 1080);
    const body = leadingFor(1080 * 0.024, 1080);
    expect(display).toBeLessThan(body);
    expect(display).toBeLessThan(1.1);
    expect(body).toBeGreaterThan(1.3);
  });

  it('tracks display type in and small type out', () => {
    expect(trackingScaleFor(1080 * 0.1, 1080)).toBeGreaterThan(1);
    expect(trackingScaleFor(1080 * 0.018, 1080)).toBeLessThan(1);
  });

  it('steps a scale by its ratio in both directions', () => {
    const base = 100;
    expect(modularStep(base, MODULAR_SCALES.perfect_fourth, 1)).toBeCloseTo(133.3, 1);
    expect(modularStep(base, MODULAR_SCALES.perfect_fourth, -1)).toBeCloseTo(75.0, 1);
    expect(modularStep(base, MODULAR_SCALES.major_third, 0)).toBe(base);
  });
});

describe('composition', () => {
  it('keeps every delivered aspect clear of the EBU text-safe inset', () => {
    const frame = { width: 1920, height: 1080 };
    for (const [aspect, area] of Object.entries(SAFE_AREAS)) {
      const box = {
        x: frame.width * area.left,
        y: frame.height * area.top,
        width: frame.width * (1 - area.left - area.right),
        height: frame.height * (1 - area.top - area.bottom),
      };
      expect(withinInset(box, frame, TITLE_SAFE_INSET), aspect).toBe(true);
    }
  });

  it('gives vertical more room at the bottom than at the top', () => {
    // The platforms' caption block, handle and action rail all live down there.
    expect(SAFE_AREAS['9:16'].bottom).toBeGreaterThan(SAFE_AREAS['9:16'].top);
  });
});

describe('editing', () => {
  it('reads equal shot lengths as no rhythm', () => {
    expect(rhythmVariation([3, 3, 3, 3])).toBe(0);
    expect(rhythmVariation([1, 4, 2, 6])).toBeGreaterThan(0.3);
  });

  it('does not accuse a single shot of having no rhythm', () => {
    expect(rhythmVariation([4])).toBe(0);
    expect(rhythmVariation([])).toBe(0);
  });

  it('finds the longest run of one treatment', () => {
    expect(longestRun(['a', 'b', 'b', 'b', 'c'])).toBe(3);
    expect(longestRun(['a', 'b', 'a', 'b'])).toBe(1);
    expect(longestRun([])).toBe(0);
  });
});

describe('loudness', () => {
  it('accepts a broadcast master inside EBU R 128 tolerance and rejects one outside', () => {
    expect(loudnessWithinTolerance(-23.4, 'broadcast')).toBe(true);
    expect(loudnessWithinTolerance(-21.5, 'broadcast')).toBe(false);
    expect(loudnessWithinTolerance(LUFS_BROADCAST, 'broadcast')).toBe(true);
  });

  it('keeps a true-peak ceiling below full scale', () => {
    // Inter-sample peaks rise on the way into a lossy encoder, so a master that
    // peaks at 0 dBFS distorts as the file anybody actually plays.
    expect(TRUE_PEAK_CEILING).toBeLessThan(0);
  });
});

describe('editorial', () => {
  it('catches hedges that imply evidence', () => {
    expect(weaselPhrasesIn('Our industry-leading platform')).toContain('industry-leading');
    expect(weaselPhrasesIn('Close the books in a day')).toEqual([]);
  });

  it('catches superlatives that would need substantiating', () => {
    expect(superlativesIn('The only ledger that closes itself').length).toBeGreaterThan(0);
    expect(superlativesIn("The world's first autonomous close").length).toBeGreaterThan(0);
    expect(superlativesIn('Reconciliation, automated')).toEqual([]);
  });

  it('recognises the shapes a figure takes on screen', () => {
    expect(containsStatistic('3x faster')).toBe(true);
    expect(containsStatistic('40% less time')).toBe(true);
    expect(containsStatistic('400 finance teams')).toBe(true);
    expect(containsStatistic('Close the books')).toBe(false);
  });
});

describe('conversion', () => {
  it('rejects a call to action that names no action', () => {
    expect(ctaIsVague('Learn more')).toBe(true);
    expect(ctaIsVague('Click here')).toBe(true);
    expect(ctaIsVague('Start your first close')).toBe(false);
  });

  it('knows whether a film opens on its subject or on its own logo', () => {
    expect(
      opensOnSubject([
        { visualType: 'logo_reveal', duration: 4 },
        { visualType: 'kinetic_typography', duration: 3 },
      ]),
    ).toBe(false);

    expect(
      opensOnSubject([
        { visualType: 'logo_reveal', duration: 1 },
        { visualType: 'kinetic_typography', duration: 3 },
      ]),
    ).toBe(true);

    expect(opensOnSubject([{ visualType: 'kinetic_typography', duration: 3 }])).toBe(true);
  });
});

describe('stable ids', () => {
  it('gives the same evidence the same id every time we read it', () => {
    // The bug this replaced: a customer authorises their product, research runs
    // again, every excerpt gets a fresh random id, and every storyboard is
    // suddenly citing evidence the project no longer holds. QA then blocks the
    // film correctly, for a reason nobody can act on.
    const a = derivedId('evt', 'page_text', 'https://northwind.example/pricing', 'Close 3x faster');
    const b = derivedId('evt', 'page_text', 'https://northwind.example/pricing', 'Close 3x faster');
    expect(a).toBe(b);
  });

  it('gives different evidence different ids', () => {
    const base = ['page_text', 'https://northwind.example/pricing'] as const;
    const ids = new Set([
      derivedId('evt', ...base, 'Close 3x faster'),
      derivedId('evt', ...base, 'Close 4x faster'),
      derivedId('evt', ...base, 'Close 3x faster.'),
      derivedId('evt', 'heading', ...base.slice(1), 'Close 3x faster'),
      derivedId('evt', 'page_text', 'https://northwind.example/docs', 'Close 3x faster'),
    ]);
    expect(ids.size).toBe(5);
  });

  it('cannot be fooled by moving a boundary between parts', () => {
    // Joined with a separator that cannot appear in a URL or an excerpt, so
    // ("ab", "c") and ("a", "bc") are different inputs rather than one.
    expect(derivedId('evt', 'ab', 'c')).not.toBe(derivedId('evt', 'a', 'bc'));
  });

  it('produces ids the rest of the system recognises', () => {
    expect(isId(derivedId('evt', 'page_text', 'https://x.example/', 'Something'), 'evt')).toBe(true);
    expect(isId(derivedId('mom', 'https://x.example/', 'Connect a bank'), 'mom')).toBe(true);
  });
});

describe('the end card', () => {
  it('reduces a URL to how a company writes its own domain', () => {
    expect(displayHost('https://www.linear.app/')).toBe('linear.app');
    expect(displayHost('linear.app')).toBe('linear.app');
    expect(displayHost('https://app.northwind.example/pricing?a=1')).toBe('app.northwind.example');
  });

  it('gives nothing back for something that is not an address', () => {
    // Better an end card with no line than one carrying a broken string.
    expect(displayHost('')).toBe('');
    expect(displayHost('not a url')).toBe('');
    expect(displayHost('javascript:alert(1)')).toBe('');
  });
});

describe('fitting a line where only one fits', () => {
  it('leaves a line that already fits alone', () => {
    expect(firstClause('Close the books without a week of manual matching.')).toBe(
      'Close the books without a week of manual matching.',
    );
  });

  it('cuts at a sentence end when there is one', () => {
    expect(
      firstClause('Reconciliation, automated. Built for controllers at mid-market companies.'),
    ).toBe('Reconciliation, automated.');
  });

  it('cuts at a comma rather than mid-phrase', () => {
    const result = firstClause(
      'The product development system for teams and agents, purpose-built for planning and building products',
    );
    expect(result).toBe('The product development system for teams and agents');
  });

  it('never ends on a dangling word', () => {
    // The defect this exists to stop: a film ending on "purpose-built for".
    const result = firstClause(
      'A single place for every document your finance team has ever needed to reconcile',
      40,
    );
    expect(endsDangling(result)).toBe(false);
  });

  it('never cuts mid-word', () => {
    const source = 'Reconciliation automation for mid-market finance teams everywhere';
    const result = firstClause(source, 30);
    expect(source.startsWith(result)).toBe(true);
    expect(result.split(' ').every((word) => source.includes(word))).toBe(true);
  });
});
