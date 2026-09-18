import { describe, it, expect } from 'vitest';
import {
  JobKind,
  ProjectStage,
  SIDE_ERRAND_JOBS,
  jobAdvancesProject,
  primaryCtaFor,
  stageReached,
} from '../index.ts';

/**
 * Two questions the product kept getting wrong: what is this project waiting
 * on, and how far has it got.
 */
describe('what the customer is waiting on', () => {
  it('treats a timing preview, the launch copy and another language as side errands', () => {
    expect(jobAdvancesProject('render_animatic')).toBe(false);
    expect(jobAdvancesProject('generate_copy')).toBe(false);
    // A master in another language runs beside a film that is already
    // finished and delivered. It must not take over the page while it runs,
    // and its failure is not the project's failure.
    expect(jobAdvancesProject('localise_film')).toBe(false);
  });

  it('treats everything that changes the project as work to wait on', () => {
    const advancing = JobKind.options.filter(jobAdvancesProject);
    expect(advancing).toContain('render_film');
    expect(advancing).toContain('generate_campaign');
    expect(advancing).toContain('render_variant');
    expect(advancing).toContain('build_storyboard');
    expect(advancing).toContain('research_product');
  });

  it('names only real job kinds as side errands', () => {
    for (const kind of SIDE_ERRAND_JOBS) {
      expect(JobKind.options, `${kind} is not a job kind`).toContain(kind);
    }
  });
});

describe('stage order', () => {
  it('knows a finished project has gone past reading the website', () => {
    expect(stageReached('film_ready', 'concepting')).toBe(true);
    expect(stageReached('storyboard_ready', 'concepting')).toBe(true);
    expect(stageReached('understanding_ready', 'concepting')).toBe(false);
    expect(stageReached('created', 'concepting')).toBe(false);
  });

  it('counts a stage as reached', () => {
    expect(stageReached('concepting', 'concepting')).toBe(true);
  });

  it('treats a failed project as having gone past nothing', () => {
    // A failure is a stop, not a position. Comparing it against a stage would
    // let a re-run decide a broken project was further along than it is.
    for (const stage of ProjectStage.options) {
      expect(stageReached('failed', stage), `failed vs ${stage}`).toBe(false);
    }
  });

  it('is consistent with the CTA: nothing past film_ready', () => {
    const past = ProjectStage.options.filter(
      (stage) => stage !== 'failed' && stageReached(stage, 'film_ready'),
    );
    expect(past).toEqual(['film_ready']);
    expect(primaryCtaFor('film_ready')).toBe('create_variants');
  });
});
