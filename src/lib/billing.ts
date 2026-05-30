/**
 * Plans and entitlements — the single source of truth for "what can this user
 * do?" (the canUserDoThis() gate from the roadmap). The numbers are just config;
 * tune them freely. Stripe holds the real price — PRO_PRICE_USD is display only.
 */
export type Plan = "free" | "pro";

/** Monthly price of Pro, in US dollars (for display; Stripe is authoritative). */
export const PRO_PRICE_USD = 8;

export type Feature = "lab" | "scheduledWidgets" | "premiumVoice";

type PlanLimits = {
  /** Claude messages allowed per calendar month. */
  monthlyMessages: number;
  features: Record<Feature, boolean>;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    monthlyMessages: 50,
    // premiumVoice off: free users get the browser's native voice only, so they
    // never spend our ElevenLabs credits. Premium (ElevenLabs) is the Pro upsell.
    features: { lab: false, scheduledWidgets: false, premiumVoice: false },
  },
  pro: {
    monthlyMessages: 2000,
    features: { lab: true, scheduledWidgets: true, premiumVoice: true },
  },
};

/** Minimal shape we need to reason about a user's plan. */
type PlanUser = { plan?: string | null };

export function planOf(user: PlanUser): Plan {
  return user.plan === "pro" ? "pro" : "free";
}

export function isPro(user: PlanUser): boolean {
  return planOf(user) === "pro";
}

/** The entitlement gate: may this user use a given feature? */
export function canUserDoThis(user: PlanUser, feature: Feature): boolean {
  return PLAN_LIMITS[planOf(user)].features[feature];
}

/** This user's monthly Claude-message allowance. */
export function monthlyMessageLimit(user: PlanUser): number {
  return PLAN_LIMITS[planOf(user)].monthlyMessages;
}
