// Edge Function: stripe-webhook
// Handles Stripe events: activates / cancels / expires subscriptions in Supabase.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

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

  // Activates (or reactivates) a subscription from a completed+paid Checkout Session.
  // Shared by the synchronous path (card: checkout.session.completed with
  // payment_status "paid") and the async path (boleto: checkout.session.async_payment_succeeded,
  // fired once the boleto is actually settled, which can take 1-3 business days).
  async function activateSubscriptionFromSession(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.user_id;
    if (!userId) { console.error(`${event.type}: no user_id in metadata`); return; }

    const sub = await stripe.subscriptions.retrieve(session.subscription as string);
    const price = sub.items.data[0].price;

    // Find the Premium plan in Supabase
    const { data: plans } = await supabase
      .from("plans")
      .select("id")
      .ilike("name", "%premium%")
      .eq("is_active", true)
      .limit(1);

    const planId = plans?.[0]?.id;
    if (!planId) { console.error("Premium plan not found in plans table"); return; }

    const periodStart = new Date(sub.current_period_start * 1000).toISOString();
    const periodEnd   = new Date(sub.current_period_end   * 1000).toISOString();

    await supabase.from("subscriptions").upsert(
      {
        user_id:                userId,
        plan_id:                planId,
        status:                 "active",
        stripe_subscription_id: sub.id,
        stripe_customer_id:     session.customer as string,
        stripe_price_id:        price.id,
        current_period_start:   periodStart,
        current_period_end:     periodEnd,
        payment_method:         "stripe",
        notes: `Stripe · ${price.currency.toUpperCase()} ${((price.unit_amount ?? 0) / 100).toFixed(2)}/yr`,
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
        if (session.mode !== "subscription") break;

        // For async payment methods (Boleto), this event fires the moment the
        // customer generates the voucher — payment_status is "unpaid" at that
        // point, since no money has moved yet (settlement takes 1-3 business
        // days). Only activate here when Stripe confirms the payment already
        // cleared (always true for card); the async case is handled by
        // checkout.session.async_payment_succeeded below.
        if (session.payment_status !== "paid") {
          console.log(`⏳ Checkout completed but unpaid (async payment method) — session ${session.id}, waiting for confirmation`);
          break;
        }

        await activateSubscriptionFromSession(session);
        break;
      }

      // ── Async payment (Boleto) confirmed paid ─────────────────────────────────
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        await activateSubscriptionFromSession(session);
        break;
      }

      // ── Async payment (Boleto) failed or expired unpaid ───────────────────────
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        console.log(`❌ Async payment (Boleto) failed/expired for user ${userId ?? "unknown"}, session ${session.id}`);
        break;
      }

      // ── Subscription renewed (invoice paid) ───────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = sub.metadata?.user_id;
        if (!userId) break;

        await supabase.from("subscriptions").update({
          status:             "active",
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq("stripe_subscription_id", sub.id);

        console.log(`🔄 Subscription renewed for user ${userId}`);
        break;
      }

      // ── Payment failed ────────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        await supabase.from("subscriptions").update({ status: "expired" })
          .eq("stripe_subscription_id", invoice.subscription as string);

        console.log(`⚠️ Payment failed — subscription ${invoice.subscription} marked expired`);
        break;
      }

      // ── Subscription cancelled ────────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        await supabase.from("subscriptions").update({
          status:       "cancelled",
          cancelled_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", sub.id);

        console.log(`❌ Subscription cancelled: ${sub.id}`);
        break;
      }

      // ── Subscription updated (e.g. downgrade / trial end) ────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        const status =
          sub.status === "active"   ? "active"  :
          sub.status === "past_due" ? "expired" :
          sub.status === "canceled" ? "cancelled" : "expired";

        await supabase.from("subscriptions").update({
          status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq("stripe_subscription_id", sub.id);
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
