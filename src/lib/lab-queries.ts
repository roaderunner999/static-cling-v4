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
  totals: { calls: number; costCents: number; inputTokens: number; outputTokens: number };
  monthCostCents: number;
  byModel: {
    model: string;
    calls: number;
    costCents: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  byFeature: { feature: string; calls: number; costCents: number }[];
  autoPicks: { model: string; calls: number }[];
  recent: {
    createdAt: Date;
    email: string | null;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    auto: boolean;
  }[];
};

const featureExpr = sql<string>`coalesce(${usageLedger.meta}->>'feature','other')`;

export async function getLabData(): Promise<LabData> {
  const [totals] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      costCents: sql<number>`coalesce(sum(${usageLedger.costCents}),0)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::int`,
    })
    .from(usageLedger);

  const [month] = await db
    .select({
      costCents: sql<number>`coalesce(sum(${usageLedger.costCents}),0)::int`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, startOfMonthUTC()));

  const byModel = await db
    .select({
      model: usageLedger.model,
      calls: sql<number>`count(*)::int`,
      costCents: sql<number>`coalesce(sum(${usageLedger.costCents}),0)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::int`,
    })
    .from(usageLedger)
    .groupBy(usageLedger.model)
    .orderBy(desc(sql`sum(${usageLedger.costCents})`));

  const byFeature = await db
    .select({
      feature: featureExpr,
      calls: sql<number>`count(*)::int`,
      costCents: sql<number>`coalesce(sum(${usageLedger.costCents}),0)::int`,
    })
    .from(usageLedger)
    .groupBy(featureExpr)
    .orderBy(desc(sql`sum(${usageLedger.costCents})`));

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
      costCents: usageLedger.costCents,
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
    monthCostCents: month.costCents,
    byModel,
    byFeature,
    autoPicks,
    recent,
  };
}
