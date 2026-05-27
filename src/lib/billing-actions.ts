"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { env } from "@/env";

/**
 * Server actions for billing. These are submitted from <form action={…}> on the
 * profile page, so they travel through `/` → :3000 (no custom /api route, and
 * thus no nginx /api/ conflict). Each ends in a redirect to a Stripe-hosted page.
 */

/** Start a Stripe Checkout session for the Pro subscription and go to it. */
export async function startCheckout() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/profile");
  if (!env.STRIPE_PRICE_ID) {
    throw new Error("STRIPE_PRICE_ID is not configured.");
  }
  const stripe = getStripe();
  const { id: userId, email } = session.user;

  const customerId = await ensureStripeCustomer(userId, email);

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: userId,
    allow_promotion_codes: true,
    success_url: `${env.BETTER_AUTH_URL}/profile?upgraded=1`,
    cancel_url: `${env.BETTER_AUTH_URL}/profile`,
  });

  if (!checkout.url) throw new Error("Stripe did not return a checkout URL.");
  redirect(checkout.url);
}

/** Open the Stripe Customer Portal so a Pro user can manage / cancel billing. */
export async function openBillingPortal() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/profile");
  const stripe = getStripe();

  const rows = await db
    .select({ customerId: userTable.stripeCustomerId })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) redirect("/profile");

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.BETTER_AUTH_URL}/profile`,
  });
  redirect(portal.url);
}

/** Find or create this user's Stripe customer, persisting the id on first use. */
async function ensureStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const stripe = getStripe();
  const rows = await db
    .select({ customerId: userTable.stripeCustomerId })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const existing = rows[0]?.customerId;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  await db
    .update(userTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(userTable.id, userId));
  return customer.id;
}
