// Edge Function: stripe-checkout
// Creates a Stripe Checkout Session for the user's region and returns the URL.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

// Maps ISO country code → Stripe price lookup key
const PRICE_KEY: Record<string, string> = {
  BR: "paldrivy_brl_annual",
  GB: "paldrivy_gbp_annual",
  IE: "paldrivy_eur_annual",
  ES: "paldrivy_eur_annual",
  PT: "paldrivy_eur_annual",
  DE: "paldrivy_eur_annual",
  FR: "paldrivy_eur_annual",
  IT: "paldrivy_eur_annual",
  AT: "paldrivy_eur_annual",
  BE: "paldrivy_eur_annual",
  NL: "paldrivy_eur_annual",
  FI: "paldrivy_eur_annual",
  GR: "paldrivy_eur_annual",
  SK: "paldrivy_eur_annual",
  SI: "paldrivy_eur_annual",
  HR: "paldrivy_eur_annual",
  LU: "paldrivy_eur_annual",
  MT: "paldrivy_eur_annual",
  EE: "paldrivy_eur_annual",
  LV: "paldrivy_eur_annual",
  LT: "paldrivy_eur_annual",
  CY: "paldrivy_eur_annual",
  MX: "paldrivy_usd_latam_annual",
  CO: "paldrivy_usd_latam_annual",
  AR: "paldrivy_usd_latam_annual",
  CL: "paldrivy_usd_latam_annual",
  PE: "paldrivy_usd_latam_annual",
  EC: "paldrivy_usd_latam_annual",
  VE: "paldrivy_usd_latam_annual",
  BO: "paldrivy_usd_latam_annual",
  PY: "paldrivy_usd_latam_annual",
  UY: "paldrivy_usd_latam_annual",
  GT: "paldrivy_usd_latam_annual",
  HN: "paldrivy_usd_latam_annual",
  SV: "paldrivy_usd_latam_annual",
  NI: "paldrivy_usd_latam_annual",
  CR: "paldrivy_usd_latam_annual",
  PA: "paldrivy_usd_latam_annual",
  DO: "paldrivy_usd_latam_annual",
  CU: "paldrivy_usd_latam_annual",
  PR: "paldrivy_usd_latam_annual",
};

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Fetch profile for country and existing stripe_customer_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, country, stripe_customer_id")
      .eq("id", user.id)
      .single();

    const country = (profile?.country ?? "US").toUpperCase();
    const lookupKey = PRICE_KEY[country] ?? "paldrivy_usd_en_annual";

    // Resolve Stripe price by lookup key
    const priceList = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    const price = priceList.data[0];
    if (!price) return json({ error: `Price not found: ${lookupKey}` }, 400);

    // Get or create Stripe customer
    let customerId: string = profile?.stripe_customer_id ?? "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.name ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Card only for now. Pix is not yet activated on the connected Stripe
    // account (dashboard.stripe.com/account/payments/settings) — requesting
    // it makes checkout.sessions.create reject with "payment method type:
    // pix is invalid" for every BR user. Re-add "pix" to this array once
    // it's enabled there.
    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      ["card"];

    // One-time payment for the full year, not a Stripe auto-renewing
    // Subscription: PalDrivy Premium is paid in full up front and renews
    // manually every 12 months (the app already reminds users to renew via
    // check-subscription-expiry), so there's no need for Stripe to keep
    // charging automatically — which also means no Pix Automático mandate,
    // and boleto/Pix can't leave a subscriber with a dangling auto-charge.
    // mode: "payment" requires a one-time price, so the line item is built
    // from price_data using the same amount/currency/product as the
    // (recurring) Price object we looked up, instead of referencing it directly.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [{
        price_data: {
          currency: price.currency,
          unit_amount: price.unit_amount ?? 0,
          product: price.product as string,
        },
        quantity: 1,
      }],
      payment_method_types: paymentMethodTypes,
      success_url: `https://app.paldrivy.com/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://app.paldrivy.com`,
      allow_promotion_codes: true,
      metadata: { user_id: user.id, country, price_lookup_key: lookupKey },
    });

    return json({ url: session.url, session_id: session.id });
  } catch (e) {
    console.error("stripe-checkout error:", e);
    return json({ error: e.message }, 500);
  }
});
