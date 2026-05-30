"use client";

import { useState } from "react";
import { labelForModel, formatUsd } from "@/lib/models";
import type { LabRecentRow } from "@/lib/lab-queries";
import { PaginatedTable } from "@/components/paginated-table";

/**
 * Recent-activity log, loaded on click. Keeps the 500-row wall off the Lab's
 * initial render (Walter: "compact that whole section into button load"). One
 * GET to /api/admin/lab-recent, then the same paginated table as before.
 */
export function LabRecent() {
  const [rows, setRows] = useState<LabRecentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lab-recent");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: LabRecentRow[] };
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load recent activity.");
    } finally {
      setLoading(false);
    }
  }

  const num = (n: number) => Math.round(n).toLocaleString("en-US");

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Recent activity
          </h2>
          <p className="text-xs text-zinc-400">
            {rows ? `${num(rows.length)} most-recent calls · 50 per page` : "Loaded on demand"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {loading ? "Loading…" : rows ? "Refresh" : "Load recent activity"}
        </button>
      </div>

      {error && <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>}

      {rows &&
        (rows.length === 0 ? (
          <p className="text-sm text-zinc-400">Nothing yet — go chat or run a Notes AI action.</p>
        ) : (
          <PaginatedTable
            head={["When", "User", "Model", "Feature", "Tokens", "Cost"]}
            rows={rows.map((r) => [
              new Date(r.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
              r.email ?? "—",
              `${labelForModel(r.model)}${r.auto ? " ✦" : ""}`,
              r.feature,
              num(r.inputTokens + r.outputTokens),
              formatUsd(r.costMicros),
            ])}
            empty="Nothing yet."
          />
        ))}
    </section>
  );
}
