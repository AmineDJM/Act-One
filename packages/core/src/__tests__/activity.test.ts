import { describe, it, expect } from 'vitest';
import { GENERATION_STEPS, newId, timelineFor, type Job, type JobEvent } from '../index.ts';

/**
 * The generation, read off the jobs and what they wrote: what is complete,
 * what is building, what stopped, and what is still to come.
 */
function job(kind: Job['kind'], state: Job['state'], createdAt: string): Job {
  return {
    id: newId('job'), organizationId: 'org_1', projectId: 'prj_1', kind, state, payload: {}, progress: state === 'completed' ? 1 : 0.4,
    statusMessage: '', attempts: 1, maxAttempts: 3, lastError: null, runAfter: createdAt, lockedBy: null, lockedAt: null,
    startedAt: createdAt, priority: 0, createdAt, updatedAt: createdAt,
  };
}

function event(jobId: string, over: Partial<JobEvent>): JobEvent {
  return {
    id: newId('jev'), organizationId: 'org_1', projectId: 'prj_1', jobId, at: '2026-01-01T00:00:00.000Z',
    step: null, kind: 'step', label: '', detail: null, status: 'done', index: null, ...over,
  };
}

describe('the generation timeline', () => {
  it('has nine steps in the order a customer sees them', () => {
    expect(GENERATION_STEPS.map((step) => step.label)).toEqual([
      'Product discovery', 'Identity', 'Creative direction', 'Three directions', 'Storyboard',
      'Source material', 'Voice', 'Motion', 'The master',
    ]);
    const empty = timelineFor({ jobs: [], events: [] });
    expect(empty.steps.every((step) => step.status === 'waiting')).toBe(true);
    expect(empty.active).toBeNull();
  });

  it('marks what completed jobs covered and what the running one is on', () => {
    const research = job('research_product', 'completed', '2026-01-01T00:00:00.000Z');
    const concepts = job('generate_concepts', 'researching', '2026-01-01T00:05:00.000Z');
    const events = [
      event(research.id, { step: 'research', kind: 'page', label: 'homepage', index: 0 }),
      event(research.id, { step: 'research', kind: 'page', label: '/pricing', index: 1 }),
      event(research.id, { step: 'research', kind: 'step', label: '2 pages read' }),
      event(research.id, { step: 'brand', kind: 'step', label: 'brand measured from 2 pages' }),
      event(concepts.id, { step: 'strategy', kind: 'step', label: 'developing three directions', status: 'active' }),
    ];
    const timeline = timelineFor({ jobs: [research, concepts], events, details: { research: ['4 core differentiators found'] } });
    const status = Object.fromEntries(timeline.steps.map((step) => [step.key, step.status]));
    expect(status).toMatchObject({ research: 'complete', brand: 'complete', strategy: 'building', concepts: 'waiting', storyboard: 'waiting' });
    expect(timeline.active).toBe('strategy');
    expect(timeline.steps[0]!.details).toEqual(['4 core differentiators found', '2 pages visited']);
    expect(timeline.steps[2]!.activity.map((line) => line.label)).toEqual(['developing three directions']);
  });

  it('moves the building step with the job’s own step events, and fails the step it was on', () => {
    const render = job('render_film', 'rendering_motion', '2026-01-01T00:10:00.000Z');
    const events = [
      event(render.id, { step: 'motion', kind: 'step', label: '21 scenes rendered', status: 'done' }),
      event(render.id, { step: 'voice', kind: 'step', label: 'reading the narration', status: 'active' }),
    ];
    const building = timelineFor({ jobs: [render], events });
    const status = Object.fromEntries(building.steps.map((step) => [step.key, step.status]));
    // Everything before a reached step happened, whether or not a job wrote it down.
    expect(status).toMatchObject({ research: 'complete', storyboard: 'complete', captures: 'complete', motion: 'complete', voice: 'building', composition: 'waiting' });

    const failed = timelineFor({ jobs: [{ ...render, state: 'failed' }], events });
    expect(failed.steps.find((step) => step.key === 'voice')?.status).toBe('failed');
    expect(failed.steps.find((step) => step.key === 'motion')?.status).toBe('complete');
  });

  it('calls everything complete once the film exists', () => {
    const timeline = timelineFor({ jobs: [job('render_film', 'completed', '2026-01-01T00:00:00.000Z')], events: [], filmReady: true });
    expect(timeline.complete).toBe(true);
    expect(timeline.steps.every((step) => step.status === 'complete')).toBe(true);
  });
});
