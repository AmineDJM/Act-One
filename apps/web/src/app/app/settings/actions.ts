'use server';

import { redirect } from 'next/navigation';
import { destroySession } from '@/server/auth.ts';

export async function signOutAction(): Promise<null> {
  await destroySession();
  redirect('/');
}
