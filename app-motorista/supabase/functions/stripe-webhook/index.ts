// Edge Function: stripe-webhook
// Handles Stripe events: activates Premium from a one-time annual payment.
//
// PalDrivy Premium is paid in full up front and renews manually every 12
// months (the app reminds users via check-subscription-expiry) — there is no
// Stripe Subscription object involved, just a one-time Checkout Session
// (mode: "payment") each time someone subscribes or renews.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return new Response("Webhook Error", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Activates (or renews) Premium for a full year from a paid Checkout Session.
  // Shared by the synchronous path (card: checkout.session.completed with
  // payment_status "paid") and the async path (Pix: checkout.session.async_payment_succeeded,
  // fired once the Pix payment actually clears).
  async function activateSubscriptionFromSession(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.user_id;
    if (!userId) { console.error(`${event.type}: no user_id in metadata`); return; }

    const { data: plans } = await supabase
      .from("plans")
      .select("id")
      .ilike("name", "%premium%")
      .eq("is_active", true)
      .limit(1);

    const planId = plans?.[0]?.id;
    if (!planId) { console.error("Premium plan not found in plans table"); return; }

    const now = new Date();
    const periodStart = now.toISOString();
    const periodEnd   = new Date(now.getTime() + ONE_YEAR_MS).toISOString();

    await supabase.from("subscriptions").upsert(
      {
        user_id:                userId,
        plan_id:                planId,
        status:                 "active",
        // No Stripe Subscription object exists anymore (one-time payment) —
        // this column now just records which Checkout Session paid for the
        // current period, for reference/support lookups.
        stripe_subscription_id: session.id,
        stripe_customer_id:     session.customer as string,
        current_period_start:   periodStart,
        current_period_end:     periodEnd,
        payment_method:         "stripe",
        notes: `Stripe · ${(session.currency ?? "brl").toUpperCase()} ${((session.amount_total ?? 0) / 100).toFixed(2)}/yr`,
      },
      { onConflict: "user_id" }
    );

    console.log(`✅ Premium activated for user ${userId} until ${periodEnd}`);
  }

  try {
    switch (event.type) {
      // ── Checkout completed ────────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "payment") break;

        // For async payment methods (Pix), this event fires the moment the
        // customer generates the QR code/copy-paste string — payment_status
        // is "unpaid" at that point, since no money has moved yet. Only
        // activate here when Stripe confirms the payment already cleared
        // (always true for card); the async case is handled by
        // checkout.session.async_payment_succeeded below.
        if (session.payment_status !== "paid") {
          console.log(`⏳ Checkout completed but unpaid (async payment method) — session ${session.id}, waiting for confirmation`);
          break;
        }

        await activateSubscriptionFromSession(session);
        break;
      }

      // ── Async payment (Pix) confirmed paid ────────────────────────────────────
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "payment") break;
        await activateSubscriptionFromSession(session);
        break;
      }

      // ── Async payment (Pix) failed or expired unpaid ──────────────────────────
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        console.log(`❌ Async payment (Pix) failed/expired for user ${userId ?? "unknown"}, session ${session.id}`);
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return new Response("Internal error", { status: 500 });
  }
});
