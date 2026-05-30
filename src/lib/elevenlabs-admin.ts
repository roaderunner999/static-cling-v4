import { env } from "@/env";

/**
 * ElevenLabs usage — the AUTHORITATIVE voice-credit meter for the admin console.
 *
 * The /api/tts route logs an estimate into our own ledger (chars × a price
 * table). This module instead asks ElevenLabs directly how many characters
 * (credits) the account has used this billing period and how many it's allotted,
 * so admin shows ground truth, not just our guess.
 *
 *   GET /v1/user/subscription  (character_count / character_limit, reset date)
 *
 * Uses the same ELEVENLABS_API_KEY the TTS route uses (the key is account-scoped,
 * so subscription info is readable with it). Server-only; never import into a
 * client component. Cached in-memory for 5 minutes — the admin page is
 * force-dynamic, so this keeps reloads from hammering ElevenLabs.
 */

const SUB_URL = "https://api.elevenlabs.io/v1/user/subscription";
// Cache a good result for 5 min (the page is force-dynamic; don't hammer the
// API). Cache a FAILURE only briefly so fixing the key/permission reflects fast
// instead of being stuck behind a 5-minute-old error.
const OK_TTL_MS = 5 * 60_000;
const ERR_TTL_MS = 20_000;

export type VoiceUsage = {
  ok: true;
  tier: string;
  status: string;
  used: number; // characters consumed this billing period
  limit: number; // characters included this period
  remaining: number;
  resetAt: number | null; // unix ms when the period resets
  fetchedAt: number;
};

export type VoiceUsageError = { ok: false; error: string };
export type VoiceUsageResult = VoiceUsage | VoiceUsageError;

type SubResponse = {
  tier?: string;
  status?: string;
  character_count?: number;
  character_limit?: number;
  next_character_count_reset_unix?: number | null;
};

let cached: { at: number; data: VoiceUsageResult } | null = null;

export async function getVoiceUsage(): Promise<VoiceUsageResult> {
  if (!env.ELEVENLABS_API_KEY) {
    return { ok: false, error: "No ElevenLabs key configured." };
  }
  if (cached) {
    const ttl = cached.data.ok ? OK_TTL_MS : ERR_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.data;
  }
  const data = await fetchVoiceUsage();
  cached = { at: Date.now(), data };
  return data;
}

async function fetchVoiceUsage(): Promise<VoiceUsageResult> {
  try {
    const res = await fetch(SUB_URL, {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY as string },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: humanizeError(res.status, body) };
    }
    const j = (await res.json()) as SubResponse;
    const used = j.character_count ?? 0;
    const limit = j.character_limit ?? 0;
    return {
      ok: true,
      tier: j.tier ?? "unknown",
      status: j.status ?? "unknown",
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt: j.next_character_count_reset_unix
        ? j.next_character_count_reset_unix * 1000
        : null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn’t reach ElevenLabs.",
    };
  }
}

function humanizeError(status: number, body: string): string {
  if (status === 401) return "ElevenLabs key rejected (401). Check ELEVENLABS_API_KEY.";
  if (status === 429) return "Rate limited by ElevenLabs (429). Try again shortly.";
  const snippet = body.slice(0, 140).replace(/\s+/g, " ").trim();
  return `ElevenLabs API error ${status}${snippet ? ` — ${snippet}` : ""}.`;
}
