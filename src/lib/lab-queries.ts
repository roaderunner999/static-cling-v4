import { sql, gte, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { usageLedger, user } from "@/db/schema";

/**
 * The Lab's data layer — org-wide aggregates over the usage_ledger (every Claude
 * call this app has made, written since Stage 3). Admin-only surface, so this is
 * the operator view across all users. No new tables: the ledger already holds
 * model, tokens, computed cost, and a meta blob ({feature, auto, action, …}).
 */

function startOfMonthUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}

export type LabData = {
  totals: { calls: number; costMicros: number; inputTokens: number; outputTokens: number };
  monthCostMicros: number;
  byModel: {
    model: string;
    calls: number;
    costMicros: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  byFeature: { feature: string; calls: number; costMicros: number }[];
  autoPicks: { model: string; calls: number }[];
  recent: {
    createdAt: Date;
    email: string | null;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    auto: boolean;
  }[];
};

const featureExpr = sql<string>`coalesce(${usageLedger.meta}->>'feature','other')`;
// Sum micro-dollars as float8 — integer micros stay exact well past any balance
// this app will see, and postgres-js hands float8 back as a JS number (not a string).
const sumMicros = sql<number>`coalesce(sum(${usageLedger.costMicros}),0)::double precision`;

export async function getLabData(): Promise<LabData> {
  const [totals] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      costMicros: sumMicros,
      inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
    })
    .from(usageLedger);

  const [month] = await db
    .select({ costMicros: sumMicros })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, startOfMonthUTC()));

  const byModel = await db
    .select({
      model: usageLedger.model,
      calls: sql<number>`count(*)::int`,
      costMicros: sumMicros,
      inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
    })
    .from(usageLedger)
    .groupBy(usageLedger.model)
    .orderBy(desc(sql`sum(${usageLedger.costMicros})`));

  const byFeature = await db
    .select({
      feature: featureExpr,
      calls: sql<number>`count(*)::int`,
      costMicros: sumMicros,
    })
    .from(usageLedger)
    .groupBy(featureExpr)
    .orderBy(desc(sql`sum(${usageLedger.costMicros})`));

  const autoPicks = await db
    .select({
      model: usageLedger.model,
      calls: sql<number>`count(*)::int`,
    })
    .from(usageLedger)
    .where(
      sql`${usageLedger.meta}->>'feature' = 'chat' and ${usageLedger.meta}->>'auto' = 'true'`,
    )
    .groupBy(usageLedger.model)
    .orderBy(desc(sql`count(*)`));

  const recent = await db
    .select({
      createdAt: usageLedger.createdAt,
      email: user.email,
      model: usageLedger.model,
      feature: featureExpr,
      inputTokens: usageLedger.inputTokens,
      outputTokens: usageLedger.outputTokens,
      costMicros: usageLedger.costMicros,
      auto: sql<boolean>`coalesce(${usageLedger.meta}->>'auto','false') = 'true'`,
    })
    .from(usageLedger)
    .leftJoin(user, eq(usageLedger.userId, user.id))
    .orderBy(desc(usageLedger.createdAt))
    // Pull a deep window so the Lab can paginate (50/page client-side) rather
    // than only ever showing the latest 50.
    .limit(500);

  return {
    totals,
    monthCostMicros: month.costMicros,
    byModel,
    byFeature,
    autoPicks,
    recent,
  };
}
