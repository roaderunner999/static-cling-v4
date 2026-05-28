import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

/**
 * Server-side Anthropic client (Stage 3).
 *
 * The legacy app read the API key from localStorage in the browser; v4 keeps it
 * server-side as ANTHROPIC_API_KEY and every Claude call goes through the
 * /api/chat route. Never import this into a client component.
 *
 * Lazily constructed so a build / boot without the key still succeeds — the key
 * is an env-gated drop-in like Stripe and Google (see env.ts `chatEnabled`).
 */
let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env to enable chat.",
    );
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}
