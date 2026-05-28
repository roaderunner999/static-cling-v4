"use client";

import { useState } from "react";
import {
  BENCH_MODELS,
  BENCH_PROMPTS,
  type BenchResult,
} from "@/lib/benchmark";
import { runBenchmark } from "@/lib/benchmark-actions";

/**
 * The Lab's Benchmark tool — pit selected models against the same prompts and
 * compare speed, tokens, cost, and output side-by-side (ported from legacy
 * lab.html). Runs are billed to the server's Anthropic key.
 */
export function Benchmark() {
  const [models, setModels] = useState<Set<string>>(
    () => new Set(BENCH_MODELS.map((m) => m.id)),
  );
  const [prompts, setPrompts] = useState<Set<string>>(
    () => new Set(BENCH_PROMPTS.map((p) => p.id)),
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BenchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  async function run() {
    if (models.size === 0 || prompts.size === 0 || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runBenchmark([...models], [...prompts]);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed.");
    } finally {
      setRunning(false);
    }
  }

  const colModels = results
    ? BENCH_MODELS.filter((m) => results.some((r) => r.model === m.id))
    : [];
  const rowPrompts = results
    ? BENCH_PROMPTS.filter((p) => results.some((r) => r.promptId === p.id))
    : [];
  const cell = (model: string, promptId: string) =>
    results?.find((r) => r.model === model && r.promptId === promptId);
  const total = results?.reduce((s, r) => s + r.costUsd, 0) ?? 0;

  const summary = colModels.map((m) => {
    const rows = (results ?? []).filter((r) => r.model === m.id && r.ok);
    const cost = rows.reduce((s, r) => s + r.costUsd, 0);
    const avgMs = rows.length ? rows.reduce((s, r) => s + r.ms, 0) / rows.length : 0;
    const outTok = rows.reduce((s, r) => s + r.outputTokens, 0);
    return { id: m.id, label: m.label, cost, avgMs, outTok };
  });
  const maxCost = Math.max(...summary.map((s) => s.cost), 1e-9);

  return (
    <section className="mb-10">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Benchmark
        </h2>
        <p className="text-xs text-zinc-400">
          Pit models against the same prompts — speed, cost, and output. Billed to
          your key; thinking + web off for a fair comparison.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Models">
          {BENCH_MODELS.map((m) => (
            <Check
              key={m.id}
              checked={models.has(m.id)}
              onChange={() => setModels((s) => toggle(s, m.id))}
              label={m.label}
            />
          ))}
        </Panel>
        <Panel title="Prompts">
          {BENCH_PROMPTS.map((p) => (
            <Check
              key={p.id}
              checked={prompts.has(p.id)}
              onChange={() => setPrompts((s) => toggle(s, p.id))}
              label={p.label}
              hint={`${p.maxTokens} max`}
            />
          ))}
        </Panel>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={run}
          disabled={running || models.size === 0 || prompts.size === 0}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {running
            ? "Running…"
            : `▶ Run benchmark (${models.size} × ${prompts.size})`}
        </button>
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        {results && !running && (
          <span className="font-mono text-xs text-zinc-500">
            total ${total.toFixed(4)}
          </span>
        )}
      </div>

      {results && summary.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Summary · cost compared
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map((s) => (
              <div key={s.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    ${s.cost.toFixed(5)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
                    style={{ width: `${Math.round((s.cost / maxCost) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[11px] text-zinc-500">
                  <span>{(s.avgMs / 1000).toFixed(2)}s avg</span>
                  <span>{s.outTok.toLocaleString()} out</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="w-48 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  Prompt
                </th>
                {colModels.map((m) => (
                  <th
                    key={m.id}
                    className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500"
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowPrompts.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-3">
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">{p.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-400">{p.prompt.slice(0, 90)}…</div>
                  </td>
                  {colModels.map((m) => {
                    const c = cell(m.id, p.id);
                    return (
                      <td key={m.id} className="min-w-[200px] px-3 py-3">
                        {!c ? (
                          <span className="text-zinc-400">—</span>
                        ) : !c.ok ? (
                          <span className="text-xs text-red-600 dark:text-red-400">{c.error}</span>
                        ) : (
                          <div>
                            <div className="font-mono text-xs text-zinc-500">
                              {(c.ms / 1000).toFixed(2)}s · {c.inputTokens} in · {c.outputTokens} out
                            </div>
                            <div className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              ${c.costUsd.toFixed(5)}
                            </div>
                            <OutputText text={c.text} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Benchmark output cell — clamps long text with a more/less toggle (no scrollbars). */
function OutputText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className="mt-1 whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
      {open || !long ? text : `${text.slice(0, 220).trimEnd()}… `}
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="font-medium text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          {open ? " less" : "more"}
        </button>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] text-zinc-400">{hint}</span>}
    </label>
  );
}
