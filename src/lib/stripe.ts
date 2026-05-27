import Stripe from "stripe";
import { env } from "@/env";

/**
 * Server-only Stripe client. It is `null` when STRIPE_SECRET_KEY is absent, so
 * the app still builds and runs with billing unconfigured. Call `getStripe()`
 * at the point of use — it throws a clear error if Stripe isn't set up.
 */
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }
  return stripe;
}
