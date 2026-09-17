'use client';

import { useActionState } from 'react';
import { acceptInviteAction, type FormState } from './actions.ts';

export function AcceptInvite({ token, organizationName }: { token: string; organizationName: string }) {
  const [state, accept, pending] = useActionState<FormState, FormData>(acceptInviteAction, {
    error: null,
  });

  return (
    <form action={accept}>
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem', marginBottom: 'var(--space-3)' }}>
          {state.error}
        </p>
      ) : null}
      <button className="btn btn--lg" type="submit" disabled={pending}>
        {pending ? 'Joining…' : `Join ${organizationName}`}
      </button>
    </form>
  );
}
