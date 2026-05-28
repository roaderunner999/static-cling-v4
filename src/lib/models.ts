/**
 * The Claude model catalog the chat exposes, plus per-model pricing and the
 * cost calculation that feeds the usage ledger.
 *
 * Pricing is US dollars per 1,000,000 tokens, current as of the Claude model
 * catalog (Opus 4.7 / Sonnet 4.6 / Haiku 4.5). It's config — if Anthropic's
 * prices move, edit the table here and the ledger follows. Cache reads bill at
 * ~0.1× the base input rate and cache writes (5-minute ephemeral) at ~1.25×,
 * which is why estimateCostCents() takes the cache token counts too.
 */

export type ModelId = "claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5";

/** An Anthropic server-side tool, declared on a request as `{ type, name }`. */
export type ServerTool = { type: string; name: string };

export type ModelInfo = {
  id: ModelId;
  label: string;
  /** One-line "when to reach for this" shown under the picker. */
  blurb: string;
  /** USD per 1M input tokens. */
  inputPerMtok: number;
  /** USD per 1M output tokens. */
  outputPerMtok: number;
  /**
   * Whether the model accepts output_config.effort. Haiku 4.5 and the older
   * Sonnet 4.5 reject it with a 400; Sonnet 4.6 and the Opus tier accept it.
   * Used to pass a cheap/snappy effort only where it's legal.
   */
  supportsEffort: boolean;
  /**
   * Server-side web tools enabled for this model — gives Claude live web access
   * (the legacy app had this). Sonnet 4.6 / Opus 4.7 get the dynamic-filtering
   * versions (search + fetch); Haiku 4.5 gets the standard web search. These run
   * on Anthropic's infra — we just declare them and Claude does the rest.
   */
  webTools: ServerTool[];
};

const WEB_SEARCH_NEW: ServerTool = { type: "web_search_20260209", name: "web_search" };
const WEB_FETCH_NEW: ServerTool = { type: "web_fetch_20260209", name: "web_fetch" };
const WEB_SEARCH_STD: ServerTool = { type: "web_search_20250305", name: "web_search" };

/** Order here is the order shown in the model picker. */
export const MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    blurb: "Best balance of speed and smarts — the everyday default.",
    inputPerMtok: 3,
    outputPerMtok: 15,
    supportsEffort: true,
    webTools: [WEB_SEARCH_NEW, WEB_FETCH_NEW],
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    blurb: "The most capable model — for the hard, long-horizon stuff.",
    inputPerMtok: 5,
    outputPerMtok: 25,
    supportsEffort: true,
    webTools: [WEB_SEARCH_NEW, WEB_FETCH_NEW],
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    blurb: "Fastest and cheapest — quick questions and light work.",
    inputPerMtok: 1,
    outputPerMtok: 5,
    supportsEffort: false,
    webTools: [WEB_SEARCH_STD],
  },
];

/** The chat's default model when a conversation doesn't specify one. */
export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";

const BY_ID = new Map<string, ModelInfo>(MODELS.map((m) => [m.id, m]));

/** Pricing for models that may appear in the ledger but aren't user-selectable. */
const EXTRA_PRICING: Record<string, { inputPerMtok: number; outputPerMtok: number }> = {
  "claude-opus-4-6": { inputPerMtok: 5, outputPerMtok: 25 },
};

/** Narrow an arbitrary string to a known model id, falling back to the default. */
export function resolveModel(id: string | null | undefined): ModelInfo {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_MODEL)!;
}

/** True when `id` is one of the user-selectable models. */
export function isKnownModel(id: string): id is ModelId {
  return BY_ID.has(id);
}

type UsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

/**
 * Cost of a single Claude call in whole US cents (rounded). Splits the four
 * token classes Anthropic bills separately:
 *   - input         → base input rate
 *   - cache writes   → 1.25× input rate (5-minute ephemeral)
 *   - cache reads    → 0.10× input rate
 *   - output         → output rate
 */
/** Exact cost of a call in US dollars (unrounded) — for fine-grained display. */
export function costOf(model: string, usage: UsageTokens): number {
  const price =
    BY_ID.get(model) ?? EXTRA_PRICING[model] ?? { inputPerMtok: 0, outputPerMtok: 0 };

  const inRate = price.inputPerMtok / 1_000_000;
  const outRate = price.outputPerMtok / 1_000_000;

  return (
    usage.inputTokens * inRate +
    (usage.cacheCreationInputTokens ?? 0) * inRate * 1.25 +
    (usage.cacheReadInputTokens ?? 0) * inRate * 0.1 +
    usage.outputTokens * outRate
  );
}

/** Cost rounded to whole US cents — the unit stored in the usage ledger. */
export function estimateCostCents(model: string, usage: UsageTokens): number {
  return Math.round(costOf(model, usage) * 100);
}
