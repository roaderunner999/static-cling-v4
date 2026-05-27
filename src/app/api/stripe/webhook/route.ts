import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { env } from "@/env";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";

/**
 * Stripe webhook. Stripe authenticates by signing the request — we verify the
 * signature against STRIPE_WEBHOOK_SECRET — so this route is intentionally NOT
 * behind the site password (it has its own auth-free nginx location). The raw
 * request body is required for signature verification, hence `req.text()`.
 *
 * Subscription lifecycle events are the source of truth for a user's plan.
 */
export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Stripe webhook not configured.", { status: 503 });
  }
  const stripe = getStripe();

  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header.", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return new Response("Signature verification failed.", { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    default:
      break;
  }

  return new Response("ok", { status: 200 });
}

/** Mirror a Stripe subscription's state onto the matching user row. */
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const active = sub.status === "active" || sub.status === "trialing";

  // current_period_end lives on the subscription item in recent API versions.
  const periodEndUnix = sub.items.data[0]?.current_period_end;
  const currentPeriodEnd = periodEndUnix
    ? new Date(periodEndUnix * 1000)
    : null;

  await db
    .update(userTable)
    .set({
      plan: active ? "pro" : "free",
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(userTable.stripeCustomerId, customerId));
}
