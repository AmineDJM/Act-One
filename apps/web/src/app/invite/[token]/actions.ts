'use server';

import { redirect } from 'next/navigation';
import { requireSession, switchWorkspace } from '@/server/auth.ts';
import { acceptInvitation } from '@/server/team.ts';
import { reportError } from '@/server/report.ts';

export type FormState = { error: string | null };

export async function acceptInviteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const invitation = await acceptInvitation(String(formData.get('token') ?? ''), session.user.id);

    // Join and then land in the workspace you joined. Without this the session
    // keeps pointing at whichever membership happens to sort first, and the
    // invitation appears to have done nothing.
    await switchWorkspace(invitation.organizationId);
  } catch (error) {
    return { error: reportError('acceptInviteAction', error).publicMessage };
  }

  redirect('/app');
}
