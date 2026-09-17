'use client';

import { useActionState } from 'react';
import { signOutAction } from './actions.ts';

export function SignOutButton() {
  const [, signOut, pending] = useActionState(signOutAction, null);
  return (
    <form action={signOut}>
      <button className="btn btn--secondary" type="submit" disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </form>
  );
}
