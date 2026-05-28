import { env } from "@/env";

/**
 * Anthropic Admin API — REAL organization spend.
 *
 * The chat path estimates each call's cost from token counts × a price table
 * (see models.ts). That's accurate to the token, but it's still OUR number. This
 * module pulls the ACTUAL billed spend from Anthropic's Usage & Cost API so the
 * admin console can show ground truth and reconcile the two.
 *
 *   GET /v1/organizations/cost_report  (amount = cents, decimal string)
 *
 * Auth is an Admin key (sk-ant-admin…), DISTINCT from the chat key and only
 * mintable by an org admin (Console → Admin keys). The Admin API is org-only —
 * it returns an error on an individual account. Server-only; never import into a
 * client component. Results are cached in-memory (the API recommends ≤1 poll/min;
 * the admin page is force-dynamic, so this keeps reloads from hammering it).
 *
 * NOTE on per-user attribution: this endpoint groups by workspace / model, never
 * by our app's end-users (they all share one key). True per-user-from-Anthropic
 * needs a workspace or key PER user — the foundation for a future "VIP" plan.
 * getOrgCost can already group by workspace_id for exactly that.
 */

const COST_URL = "https://api.anthropic.com/v1/organizations/cost_report";
const CACHE_TTL_MS = 5 * 60_000;
const CENTS_TO_MICROS = 10_000; // $0.01 = 1 cent = 10,000 micro-dollars

export type OrgCostSlice = { key: string; micros: number };

export type OrgCost = {
  ok: true;
  totalMicros: number; // billed spend over the whole window
  monthMicros: number; // calendar-month-to-date (UTC)
  byModel: OrgCostSlice[];
  byCostType: OrgCostSlice[]; // tokens / web_search / code_execution / …
  windowStart: string; // ISO
  windowEnd: string; // ISO
  fetchedAt: number;
};

export type OrgCostError = { ok: false; error: string };
export type OrgCostResult = OrgCost | OrgCostError;

type CostResult = {
  amount: string;
  cost_type?: string | null;
  model?: string | null;
  workspace_id?: string | null;
};
type CostBucket = { starting_at: string; ending_at: string; results: CostResult[] };
type CostResponse = { data: CostBucket[]; has_more: boolean; next_page: string | null };

let cached: { at: number; daysBack: number; data: OrgCostResult } | null = null;

function startOfMonthUTC(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1);
}

/** Real org spend over the last `daysBack` days (default 120 — covers this org's lifetime). */
export async function getOrgCost({
  daysBack = 120,
}: { daysBack?: number } = {}): Promise<OrgCostResult> {
  if (!env.ANTHROPIC_ADMIN_KEY) {
    return { ok: false, error: "No Anthropic Admin key configured." };
  }
  if (cached && cached.daysBack === daysBack && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchOrgCost(daysBack);
  cached = { at: Date.now(), daysBack, data };
  return data;
}

async function fetchOrgCost(daysBack: number): Promise<OrgCostResult> {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const startISO = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  ).toISOString();
  const monthStart = startOfMonthUTC();

  let total = 0;
  let month = 0;
  const byModel = new Map<string, number>();
  const byCostType = new Map<string, number>();

  let page: string | null = null;
  let guard = 0;
  try {
    do {
      const url = new URL(COST_URL);
      url.searchParams.set("starting_at", startISO);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.append("group_by[]", "description");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);

      const res = await fetch(url, {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": env.ANTHROPIC_ADMIN_KEY!,
          "User-Agent": "StaticCling/4.x (https://static-cling.com)",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: humanizeError(res.status, body) };
      }
      const json = (await res.json()) as CostResponse;
      for (const bucket of json.data ?? []) {
        const inMonth = new Date(bucket.starting_at).getTime() >= monthStart;
        for (const r of bucket.results ?? []) {
          const micros = Number.parseFloat(r.amount) * CENTS_TO_MICROS;
          if (!Number.isFinite(micros)) continue;
          total += micros;
          if (inMonth) month += micros;
          const modelKey = r.model || r.cost_type || "other";
          byModel.set(modelKey, (byModel.get(modelKey) ?? 0) + micros);
          const ct = r.cost_type || "tokens";
          byCostType.set(ct, (byCostType.get(ct) ?? 0) + micros);
        }
      }
      page = json.has_more ? json.next_page : null;
      guard += 1;
    } while (page && guard < 20);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn’t reach the Anthropic API.",
    };
  }

  const slices = (m: Map<string, number>): OrgCostSlice[] =>
    [...m.entries()]
      .map(([key, micros]) => ({ key, micros: Math.round(micros) }))
      .sort((a, b) => b.micros - a.micros);

  return {
    ok: true,
    totalMicros: Math.round(total),
    monthMicros: Math.round(month),
    byModel: slices(byModel),
    byCostType: slices(byCostType),
    windowStart: startISO,
    windowEnd: end.toISOString(),
    fetchedAt: Date.now(),
  };
}

function humanizeError(status: number, body: string): string {
  if (status === 401)
    return "Admin key rejected (401). It must be an sk-ant-admin… key, not the chat key.";
  if (status === 403)
    return "Admin key lacks permission (403). Mint one as an org admin in Console → Admin keys.";
  if (status === 400 || status === 404)
    return "The Usage & Cost API isn’t available for this account — it requires an Organization (Console → Settings → Organization).";
  if (status === 429) return "Rate limited by Anthropic (429). Try again shortly.";
  const snippet = body.slice(0, 140).replace(/\s+/g, " ").trim();
  return `Anthropic API error ${status}${snippet ? ` — ${snippet}` : ""}.`;
}
