'use server';

import { requireSession } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import { submitForSelection, withdrawFromSelection } from '@/server/collections.ts';
import type { FormState } from '../../actions.ts';

/** Submits the film for selection, on the customer's explicit consent. */
export async function submitForSelectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    const projectId = String(formData.get('projectId') ?? '');
    const entry = await submitForSelection(session, projectId, {
      consent: formData.get('consent') === 'on',
      tagline: String(formData.get('tagline') ?? ''),
      concept: String(formData.get('concept') ?? ''),
      category: String(formData.get('category') ?? ''),
      launchDate: String(formData.get('launchDate') ?? '') || null,
    });
    return { error: null, message: entry.status === 'published' ? 'Already selected.' : 'Submitted. A person will look at it.' };
  } catch (error) {
    return { error: reportError('submitForSelectionAction', error).publicMessage };
  }
}

export async function withdrawFromSelectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    await withdrawFromSelection(session, String(formData.get('projectId') ?? ''));
    return { error: null, message: 'Withdrawn. The film is no longer shown.' };
  } catch (error) {
    return { error: reportError('withdrawFromSelectionAction', error).publicMessage };
  }
}
