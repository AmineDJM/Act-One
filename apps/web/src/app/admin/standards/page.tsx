import {
  AUDIO_STANDARDS,
  CAPTION_STANDARDS,
  LOCALIZATION_STANDARDS,
  COLOR_STANDARDS,
  CONVERSION_STANDARDS,
  EDITORIAL_STANDARDS,
  LAYOUT_STANDARDS,
  MOTION_STANDARDS,
  TYPE_STANDARDS,
  briefedStandards,
  cite,
  type Authority,
  type Craft,
  type Enforcement,
  type Standard,
} from '@act-one/core';
import styles from '../admin.module.css';

/*
 * Dynamic, although the content never changes.
 *
 * The layout above this one reads the session to decide whether the caller is
 * staff. Prerendering the page bakes that decision in — the build has no
 * cookies, so every visitor got the signed-out redirect that was computed once,
 * at build time. An authorisation check has to run per request even when
 * everything it guards is a constant.
 */
export const dynamic = 'force-dynamic';

/**
 * What the platform is holding itself to.
 *
 * Every numeric decision the engines make — contrast, measure, shot length,
 * loudness — comes from a rule with a source. This is that list, with the one
 * thing a reader actually needs to know about each: whether it is checked, or
 * only written down.
 *
 * It is a staff page rather than a marketing one on purpose. The claim "we
 * follow WCAG" is worth nothing; the claim "this specific clause is checked on
 * every render and here is the rule that does it" is worth something, and an
 * operator answering a customer's accessibility question needs the second one.
 */
const GROUPS: { title: string; blurb: string; standards: Record<string, Standard> }[] = [
  {
    title: 'Colour',
    blurb: 'The only part of graphic design with a real international standard behind it.',
    standards: COLOR_STANDARDS,
  },
  {
    title: 'Typography',
    blurb: 'Almost none of it standardised, almost all of it settled for centuries.',
    standards: TYPE_STANDARDS,
  },
  {
    title: 'Composition',
    blurb: 'Safe areas are what survives being played somewhere you did not choose.',
    standards: LAYOUT_STANDARDS,
  },
  {
    title: 'Editing & motion',
    blurb: 'One safety standard, and a century of craft that audiences feel without naming.',
    standards: MOTION_STANDARDS,
  },
  {
    title: 'Sound',
    blurb: 'Fully standardised, and still the thing self-produced films get wrong.',
    standards: AUDIO_STANDARDS,
  },
  {
    title: 'Captions',
    blurb: 'Read rather than watched, and almost entirely published by people who measured it.',
    standards: CAPTION_STANDARDS,
  },
  {
    title: 'Another language',
    blurb: 'Mostly a problem of time and room, and only incidentally one of words.',
    standards: LOCALIZATION_STANDARDS,
  },
  {
    title: 'Editorial',
    blurb: 'A launch film makes claims in the customer’s name. That is publishing.',
    standards: EDITORIAL_STANDARDS,
  },
  {
    title: 'Conversion',
    blurb: 'The area with the most folklore, so the one to be most careful about.',
    standards: CONVERSION_STANDARDS,
  },
];

const ENFORCEMENT_LABEL: Record<Enforcement, string> = {
  checked: 'Checked on every render',
  designed_in: 'The engines cannot break it',
  documented: 'Written down, not yet checked',
};

const ENFORCEMENT_BADGE: Record<Enforcement, string> = {
  checked: 'badge badge--ok',
  designed_in: 'badge',
  documented: 'badge badge--warn',
};

const AUTHORITY_LABEL: Record<Authority, string> = {
  normative: 'Standard',
  guidance: 'Guidance',
  convention: 'Convention',
  house: 'Our rule',
};

const CRAFT_LABEL: Record<Craft, string> = {
  direction: 'the director',
  storyboard: 'the storyboard',
  copy: 'the writer',
  narration: 'the narration',
  sound: 'the composer',
  editing: 'the edit',
  short_form: 'the feed cut',
  localization: 'the localiser',
};

/**
 * Which agents are told each rule.
 *
 * The checks are only half of it. Every creative decision here is made by a
 * model, and a model with no standards makes the choice it has seen most
 * often — which is what average work looks like. So the same corpus the checks
 * are written against is what the agents are briefed with, and this says which
 * ones heard which.
 *
 * A rule briefed to nobody is not necessarily wrong: some are enforced by an
 * engine that gives the model no say. It is worth seeing, though, because the
 * other reason a rule reaches nobody is that it was written and forgotten.
 */
function briefedTo(): Map<string, Craft[]> {
  const index = new Map<string, Craft[]>();
  for (const [craft, standards] of briefedStandards()) {
    for (const standard of standards) {
      index.set(standard.id, [...(index.get(standard.id) ?? []), craft]);
    }
  }
  return index;
}

export default function StandardsPage() {
  const all = GROUPS.flatMap((group) => Object.values(group.standards));
  const briefed = briefedTo();
  const counts = {
    checked: all.filter((s) => s.enforcement === 'checked').length,
    designed_in: all.filter((s) => s.enforcement === 'designed_in').length,
    documented: all.filter((s) => s.enforcement === 'documented').length,
  };

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Standards</h1>
          <p className="secondary" style={{ marginTop: 'var(--space-2)' }}>
            {all.length} rules the engines measure against. {counts.checked} are checked on every
            render, {counts.designed_in} cannot be broken by the engines, and {counts.documented}{' '}
            {counts.documented === 1 ? 'is' : 'are'} written down so the system has one answer, not
            yet mechanised. {briefed.size} of them are also written into the briefs the agents work
            from, because a rule the writer never hears is a rule the checks spend their time
            catching.
          </p>
        </div>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className={styles.panel} style={{ marginBottom: 'var(--space-5)' }}>
          <div className={styles.panelHead}>
            <h3>{group.title}</h3>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {group.blurb}
            </span>
          </div>

          <ul className={styles.standardList}>
            {Object.values(group.standards).map((standard) => (
              <li key={standard.id} className={styles.standard}>
                <div className={styles.standardRule}>
                  <strong>{standard.rule}</strong>
                  <span className={ENFORCEMENT_BADGE[standard.enforcement]}>
                    {ENFORCEMENT_LABEL[standard.enforcement]}
                  </span>
                </div>
                <p className="secondary" style={{ fontSize: '0.88rem' }}>
                  {standard.because}
                </p>
                <p className={styles.standardSource}>
                  {AUTHORITY_LABEL[standard.authority]} · {cite(standard)} · <code>{standard.id}</code>
                  {briefed.has(standard.id)
                    ? ` · briefed to ${briefed.get(standard.id)!.map((craft) => CRAFT_LABEL[craft]).join(', ')}`
                    : ' · enforced without asking'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
