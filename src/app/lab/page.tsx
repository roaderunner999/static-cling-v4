import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getLabData } from "@/lib/lab-queries";
import { MODELS, resolveModel } from "@/lib/models";
import { Benchmark } from "@/components/benchmark";
import { PaginatedTable } from "@/components/paginated-table";

export const metadata: Metadata = { title: "Lab · Static Cling" };
export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const num = (n: number) => n.toLocaleString("en-US");
const label = (id: string) => resolveModel(id).label || id;

export default async function LabPage() {
  await requireAdmin();
  const data = await getLabData();

  const autoTotal = data.autoPicks.reduce((s, p) => s + p.calls, 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
            Static Cling · Admin
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            The Lab
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every Claude call this app makes — what it cost, which model, and what
            Auto chose.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/admin" className="rounded-md border border-zinc-300 px-3 py-1.5 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Admin
          </Link>
          <Link href="/chat" className="rounded-md border border-zinc-300 px-3 py-1.5 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Chat
          </Link>
        </nav>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Spend this month" value={money(data.monthCostCents)} />
        <Stat label="All-time spend" value={money(data.totals.costCents)} />
        <Stat label="Total calls" value={num(data.totals.calls)} />
        <Stat
          label="Total tokens"
          value={num(data.totals.inputTokens + data.totals.outputTokens)}
        />
      </div>

      <Benchmark />

      {/* Auto-Claude routing */}
      <Section title="Auto-Claude routing" subtitle={`${num(autoTotal)} messages routed automatically`}>
        {autoTotal === 0 ? (
          <Empty>No Auto-routed messages yet.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {data.autoPicks.map((p) => {
              const pct = Math.round((p.calls / autoTotal) * 100);
              return (
                <div key={p.model} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm">{label(p.model)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-xs text-zinc-500">
                    {num(p.calls)} · {pct}%
                  </span>
                </div>
              );
            })}
            <p className="mt-1 text-xs text-zinc-400">
              Auto sends each message to the cheapest capable model — Opus only when
              the task warrants it.
            </p>
          </div>
        )}
      </Section>

      {/* Cost by model */}
      <Section title="Cost by model">
        <Table
          head={["Model", "Calls", "Input", "Output", "Cost"]}
          rows={data.byModel.map((m) => [
            label(m.model),
            num(m.calls),
            num(m.inputTokens),
            num(m.outputTokens),
            money(m.costCents),
          ])}
          empty="No usage yet."
        />
      </Section>

      {/* Cost by feature */}
      <Section title="Cost by feature">
        <Table
          head={["Feature", "Calls", "Cost"]}
          rows={data.byFeature.map((f) => [f.feature, num(f.calls), money(f.costCents)])}
          empty="No usage yet."
        />
      </Section>

      {/* Model reference */}
      <Section title="Model reference" subtitle="Pricing per 1M tokens · the catalog Auto routes across">
        <Table
          head={["Model", "Input", "Output", "Web", "Effort"]}
          rows={MODELS.map((m) => [
            m.label,
            `$${m.inputPerMtok.toFixed(2)}`,
            `$${m.outputPerMtok.toFixed(2)}`,
            m.webTools.length ? "Yes" : "—",
            m.supportsEffort ? "Yes" : "—",
          ])}
        />
        <p className="mt-2 text-xs text-zinc-400">
          Auto uses Haiku 4.5 to classify each message, then routes to the model
          above. Costs are stored rounded to the nearest cent.
        </p>
      </Section>

      {/* Recent activity */}
      <Section title="Recent activity" subtitle={`${num(data.recent.length)} most-recent calls · 50 per page`}>
        <PaginatedTable
          head={["When", "User", "Model", "Feature", "Tokens", "Cost"]}
          rows={data.recent.map((r) => [
            new Date(r.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }),
            r.email ?? "—",
            `${label(r.model)}${r.auto ? " ✦" : ""}`,
            r.feature,
            num(r.inputTokens + r.outputTokens),
            money(r.costCents),
          ])}
          empty="Nothing yet — go chat or run a Notes AI action."
        />
      </Section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: (string | number)[][];
  empty?: string;
}) {
  if (rows.length === 0) return <Empty>{empty ?? "Nothing yet."}</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 ${i === 0 ? "" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-3 py-2 ${ci === 0 ? "text-zinc-900 dark:text-zinc-50" : "text-right font-mono text-xs text-zinc-600 dark:text-zinc-300"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
