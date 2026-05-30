import { z } from "zod";

/**
 * Validated environment variables.
 *
 * We validate at the point of first use and fail fast with a readable error if
 * anything required is missing or malformed. Import this `env` object instead
 * of reading `process.env` directly so that a typo or a missing secret surfaces
 * immediately rather than as a runtime `undefined` three layers deep.
 *
 * This module is server-only by convention — do not import it into client
 * components (it would leak secrets into the browser bundle). The Better Auth
 * client reads nothing from here; it talks to /api/auth on the same origin.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Postgres connection string. Stage 0 runs a local Postgres on the
  // DigitalOcean droplet (no external pooler yet — PgBouncer is deferred until
  // traffic warrants it). Local dev -> staticcling_dev, prod -> staticcling_v4.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // --- Better Auth (Stage 1) ---
  // Signs sessions/tokens. Generate with: openssl rand -base64 32
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  // Public base URL of the app. Dev default below; in prod set this to
  // https://static-cling.com so callback URLs and cookies resolve correctly.
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // --- Admin console ---
  // Comma-separated allowlist of emails that always have admin access,
  // independent of the `user.role` column. A safety net so the owner can never
  // be locked out of /admin even if the role gets toggled. Defaults to the
  // owner account; override on the box to add/replace admins.
  ADMIN_EMAILS: z.string().default("admin@lyons.net"),

  // --- Optional providers (drop-in: present a value to activate) ---
  // Google OAuth — social sign-in lights up automatically when both are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Resend — transactional email (magic links, verification, password reset).
  // When RESEND_API_KEY is set, the email-backed flows activate.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Static Cling <onboarding@static-cling.com>"),

  // --- Stripe billing (Stage 2) ---
  // Server-side secret key (sk_test_… in dev, sk_live_… at launch).
  STRIPE_SECRET_KEY: z.string().optional(),
  // Webhook signing secret (whsec_…) for /api/stripe/webhook.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Stripe Price ID for the Pro plan (price_…), created in the dashboard.
  STRIPE_PRICE_ID: z.string().optional(),

  // --- Claude chat (Stage 3) ---
  // Server-side Anthropic API key (sk-ant-…). The legacy app held this in the
  // browser; v4 keeps it here and all Claude calls go through /api/chat. When
  // set, chat lights up (see `chatEnabled`).
  ANTHROPIC_API_KEY: z.string().optional(),

  // --- Anthropic Admin / billing (real spend) ---
  // Organization Admin key (sk-ant-admin…) — DISTINCT from the chat key above and
  // only mintable by an org admin in Console → Admin keys. When set, the admin
  // console pulls the org's ACTUAL billed spend from the Usage & Cost API and
  // reconciles it against our own estimate (see `adminApiEnabled`). Never used for
  // chat. The Admin API is org-only; it won't work on an individual account.
  ANTHROPIC_ADMIN_KEY: z.string().optional(),

  // --- Voice output (ElevenLabs, premium TTS) — drop-in like the others ---
  // Server-side ElevenLabs key. When set, the "Premium" voice option lights up
  // in chat (see `voiceEnabled`) and /api/tts streams ElevenLabs audio; the key
  // never reaches the browser. Without it, chat still has free native voice
  // (the browser's built-in speech) for both input and output — voice never
  // hard-depends on a paid key. Voice INPUT (dictation) is 100% browser-native
  // and needs no env at all.
  ELEVENLABS_API_KEY: z.string().optional(),
  // Which ElevenLabs voice to speak in (a voice_id from your ElevenLabs library).
  // Defaults to "Rachel", a clear neutral narrator. `preprocess` maps an empty
  // string (golive writes `ELEVENLABS_VOICE_ID=` when unset) to undefined so the
  // default actually applies — zod's .default() only fires on undefined, not "".
  ELEVENLABS_VOICE_ID: z
    .preprocess((v) => (v === "" ? undefined : v), z.string().default("21m00Tcm4TlvDq8ikWAM")),
  // ElevenLabs model. Turbo v2.5 is the low-latency choice — the "race car"
  // pick: near-instant first audio, still natural. Swap to eleven_multilingual_v2
  // for max fidelity if latency stops mattering.
  ELEVENLABS_MODEL_ID: z
    .preprocess((v) => (v === "" ? undefined : v), z.string().default("eleven_turbo_v2_5")),

  // --- Voice bake-off contenders (admin /lab testing — drop-in like ElevenLabs) ---
  // Low-latency TTS engines we A/B against native + ElevenLabs in /lab. Each
  // lights up its bench card when its key is present; an absent key shows an
  // "add the key" hint instead of a Play button. These power /api/tts/bench only
  // (admin-gated). Production chat voice still goes through /api/tts.
  //
  // Cartesia (Sonic) — state-space model, ~90ms first audio: the 2026 latency
  // leader, and it does custom/cloned voices. Prime candidate for a fast tier.
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_VOICE_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("a0e99841-438c-4a64-b679-ae501e7d6091"),
  ),
  CARTESIA_MODEL_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("sonic-2"),
  ),
  // Deepgram Aura — fast TTS built for voice agents.
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_TTS_MODEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("aura-2-thalia-en"),
  ),

  // --- /renegades realtime rooms (LiveKit) — drop-in like the others ---
  // The social layer: group rooms with presence + text chat + mic/cam, powered
  // by LiveKit. Lights up when all three are set (see `renegadesEnabled`). The
  // URL is the only one the browser needs (passed as a prop, not NEXT_PUBLIC);
  // the key/secret stay server-side and only mint room tokens in /api/renegades.
  // Get them free at cloud.livekit.io (or self-host the LiveKit server).
  LIVEKIT_URL: z.string().optional(), // wss://<project>.livekit.cloud
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  // --- Abuse guards (the site is public) ---
  // Per-user burst limit: max chat messages in any 60s window.
  CHAT_RATE_PER_MIN: z.coerce.number().int().positive().default(15),
  // Global wallet guard: max chat messages across all users per UTC day. A blunt
  // ceiling that caps total spend if the site gets hammered. Raise as you grow.
  CHAT_DAILY_GLOBAL_CAP: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "\n❌ Invalid or missing environment variables:\n" +
      JSON.stringify(parsed.error.issues, null, 2) +
      "\n",
  );
  throw new Error("Invalid environment variables — see the log above.");
}

export const env = parsed.data;

/**
 * Normalized admin allowlist (lowercased, trimmed, de-duped). The union of this
 * and the `user.role = 'admin'` column decides admin access — see isAdmin().
 */
export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** True when Google OAuth credentials are configured. */
export const googleEnabled = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

/** True when transactional email (Resend) is configured. */
export const emailEnabled = Boolean(env.RESEND_API_KEY);

/** True when Stripe billing is fully configured (secret key + Pro price). */
export const billingEnabled = Boolean(
  env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID,
);

/** True when the Claude chat is configured (server-side API key present). */
export const chatEnabled = Boolean(env.ANTHROPIC_API_KEY);

/**
 * True when premium voice (ElevenLabs) is configured. Native browser voice
 * works regardless; this only gates the higher-fidelity ElevenLabs option and
 * the /api/tts route. Dark until an ElevenLabs key is added.
 */
export const voiceEnabled = Boolean(env.ELEVENLABS_API_KEY);

/**
 * Voice bake-off contenders, each dark until its key is dropped in. Used by the
 * admin /lab TTS bench (/api/tts/bench) to A/B latency against native +
 * ElevenLabs. Native always works (browser) and ElevenLabs follows `voiceEnabled`.
 */
export const cartesiaEnabled = Boolean(env.CARTESIA_API_KEY);
export const deepgramVoiceEnabled = Boolean(env.DEEPGRAM_API_KEY);

/**
 * True when /renegades (LiveKit realtime rooms) is fully configured — needs the
 * server URL plus the API key/secret to mint join tokens. Dark (honest "set it
 * up" panel) until all three are present.
 */
export const renegadesEnabled = Boolean(
  env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET,
);

/**
 * True when an Anthropic Admin key is configured, so the admin console can pull
 * real org spend from the Usage & Cost API. Dark (honest "connect billing"
 * prompt) until an sk-ant-admin key is added.
 */
export const adminApiEnabled = Boolean(env.ANTHROPIC_ADMIN_KEY);
