import { getAnthropic } from "@/lib/anthropic";
import { recordUsage } from "@/lib/usage";
import type { ModelId } from "@/lib/models";

/**
 * Auto-Claude routing (the roadmap's AUTO router). A cheap Haiku classification
 * pass reads the user's latest message and decides which model should answer and
 * whether the question needs current/web info — so the app spends Opus money only
 * when the task warrants it, and stays snappy/cheap otherwise. The user keeps the
 * manual picker too; this only runs when they choose "Auto".
 *
 * Fails safe: any error (bad JSON, API hiccup) falls back to Sonnet 4.6, the
 * sensible all-rounder.
 */

export type RouteDecision = { modelId: ModelId; web: boolean; reason: string };

const ROUTER_SYSTEM = [
  "You are a fast routing classifier for a chat app. Decide which Claude model should answer the user's message and whether it needs live web/current info.",
  "Respond with ONLY a JSON object, no prose:",
  '{"model":"haiku"|"sonnet"|"opus","web":boolean,"reason":"<=6 words"}',
  "Guidance: haiku = simple, short, casual, or factual-from-general-knowledge. sonnet = general questions, everyday coding help, summaries, and anything needing current info. opus = hard reasoning, complex/large coding, deep analysis, or long multi-step tasks. Set web=true for weather, news, prices, sports, schedules, recent releases, or anything that may have changed since training. If an image is attached and the ask is non-trivial, prefer sonnet or opus.",
].join(" ");

const CLASS_TO_MODEL: Record<string, ModelId> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};

export async function classifyRoute(
  userId: string,
  text: string,
  hasImages: boolean,
): Promise<RouteDecision> {
  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 120,
      system: ROUTER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Message: ${text || "(no text)"}${hasImages ? "\n[an image is attached]" : ""}`,
        },
      ],
    });

    // The classifier call is cheap but real — log it so the ledger stays honest.
    await recordUsage({
      userId,
      model: "claude-haiku-4-5",
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      meta: { feature: "chat-router" },
    });

    const raw = msg.content.find((b) => b.type === "text");
    const json = JSON.parse(
      (raw && "text" in raw ? raw.text : "{}").match(/\{[\s\S]*\}/)?.[0] ?? "{}",
    ) as { model?: string; web?: boolean; reason?: string };

    return {
      modelId: CLASS_TO_MODEL[json.model ?? ""] ?? "claude-sonnet-4-6",
      web: Boolean(json.web),
      reason: (json.reason ?? "").toString().slice(0, 40) || "best fit",
    };
  } catch {
    return { modelId: "claude-sonnet-4-6", web: false, reason: "default" };
  }
}
