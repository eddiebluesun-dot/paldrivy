import { supabase } from '../lib/supabase';

export interface CheckoutResult {
  url: string;
  session_id: string;
}

export async function createStripeCheckout(): Promise<CheckoutResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/stripe-checkout`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Checkout failed');
  return data as CheckoutResult;
}
