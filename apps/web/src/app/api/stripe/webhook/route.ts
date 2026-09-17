import { NextResponse } from 'next/server';
import { getStripe, handleStripeEvent } from '@/server/stripe.ts';
import { readProviderCredentials } from '@/server/platform.ts';

export const runtime = 'nodejs';
// Signature verification needs the exact bytes Stripe signed, so this route
// must never be cached or statically analysed into a body-parsed handler.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const stripe = await getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const { webhookSecret } = await readProviderCredentials('stripe');
  if (!webhookSecret) {
    // Refuse rather than trusting an unsigned body: anyone who can reach this
    // URL could otherwise grant themselves credits.
    return NextResponse.json({ error: 'Webhook secret is not configured.' }, { status: 503 });
  }

  const payload = await request.text();

  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    const result = await handleStripeEvent(event);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload.';
    // 400 tells Stripe not to retry a bad signature; a 500 would have it retry
    // a request that can never succeed.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
