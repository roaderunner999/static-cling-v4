"use client";

import { useState } from "react";
import type { AgentRow } from "@/lib/agent-queries";
import type { AgentRenderTarget, AgentDataSource } from "@/db/schema";
import {
  createAgent,
  updateAgent,
  deleteAgent,
  reorderAgents,
  runAgent,
} from "@/lib/agent-actions";
import { RENDER_TARGETS, DATA_SOURCES, renderTargetInfo, dataSourceInfo } from "@/lib/agents";
import { MODELS, resolveModel, formatUsd } from "@/lib/models";
import { AgentResultView } from "@/components/agent-renderers";

/**
 * The agent board — the roadmap's Stage 4 surface. A rearrangeable grid of agent
 * cards; each runs a saved Claude task on demand and renders its structured
 * result. Create/edit via a slide-over; drag cards to reorder. Scheduling (the
 * cron executor) is Stage 5 — the schedule field is shown but inert here.
 */

type Draft = {
  title: string;
  instruction: string;
  renderTarget: AgentRenderTarget;
  dataSource: AgentDataSource;
  model: string;
  budgetCents: number;
};

const BLANK: Draft = {
  title: "",
  instruction: "",
  renderTarget: "text",
  dataSource: "claude",
  model: "claude-sonnet-4-6",
  budgetCents: 5,
};

/** One-click starters that show off each data source + render target. */
const STARTERS: (Draft & { emoji: string })[] = [
  {
    emoji: "₿",
    title: "Bitcoin price",
    instruction: "What is the current price of Bitcoin in USD right now?",
    renderTarget: "number",
    dataSource: "web",
    model: "claude-haiku-4-5",
    budgetCents: 3,
  },
  {
    emoji: "📰",
    title: "Today's AI headlines",
    instruction:
      "List the 5 most important artificial-intelligence news headlines from the last 24 hours, each with a one-line summary.",
    renderTarget: "list",
    dataSource: "web",
    model: "claude-sonnet-4-6",
    budgetCents: 5,
  },
  {
    emoji: "🗂️",
    title: "My week at a glance",
    instruction:
      "From my task board, give me a short prioritized list of what I should focus on this week — surface anything overdue or high-priority first.",
    renderTarget: "list",
    dataSource: "tasks",
    model: "claude-sonnet-4-6",
    budgetCents: 3,
  },
  {
    emoji: "💡",
    title: "Themes in my notes",
    instruction:
      "Read across my notes and tell me the recurring themes and the open questions I keep returning to.",
    renderTarget: "text",
    dataSource: "notes",
    model: "claude-sonnet-4-6",
    budgetCents: 4,
  },
];

function relTime(d: Date | string | null): string {
  if (!d) return "never";
  const t = new Date(d).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AgentsUI({ initial }: { initial: AgentRow[] }) {
  const [agents, setAgents] = useState<AgentRow[]>(initial);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  function patch(id: string, p: Partial<AgentRow>) {
    setAgents((a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function run(id: string) {
    setRunning((r) => new Set(r).add(id));
    try {
      const out = await runAgent(id);
      patch(id, {
        lastResult: out.result,
        lastRunAt: new Date(out.ranAt),
        lastModel: out.model,
        lastCostMicros: out.costMicros,
      });
    } finally {
      setRunning((r) => {
        const n = new Set(r);
        n.delete(id);
        return n;
      });
    }
  }

  async function createFrom(draft: Draft) {
    const res = await createAgent(draft);
    if (!res) return;
    setAgents((a) => [
      ...a,
      {
        id: res.id,
        title: draft.title || "New agent",
        instruction: draft.instruction,
        renderTarget: draft.renderTarget,
        dataSource: draft.dataSource,
        model: draft.model,
        schedule: "manual",
        budgetCents: draft.budgetCents,
        position: a.length,
        enabled: true,
        lastResult: null,
        lastRunAt: null,
        lastModel: null,
        lastCostMicros: 0,
        createdAt: new Date(),
      },
    ]);
    return res.id;
  }

  async function save(draft: Draft) {
    if (editing && editing !== "new") {
      patch(editing.id, draft);
      await updateAgent(editing.id, draft);
    } else {
      await createFrom(draft);
    }
    setEditing(null);
  }

  async function remove(id: string) {
    if (!confirm("Delete this agent?")) return;
    setAgents((a) => a.filter((x) => x.id !== id));
    await deleteAgent(id);
  }

  async function addStarter(s: Draft) {
    const id = await createFrom(s);
    if (id) void run(id);
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    setAgents((a) => {
      const from = a.findIndex((x) => x.id === dragId);
      const to = a.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0) return a;
      const next = [...a];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      void reorderAgents(next.map((x) => x.id));
      return next;
    });
    setDragId(null);
  }

  return (
    <main className="w-full flex-1 px-4 py-8 sm:px-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Agents
          </h1>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
        >
          + New agent
        </button>
      </div>

      {agents.length === 0 ? (
        <Empty onAdd={addStarter} onBlank={() => setEditing("new")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              running={running.has(a.id)}
              onRun={() => run(a.id)}
              onEdit={() => setEditing(a)}
              onDelete={() => remove(a.id)}
              dragging={dragId === a.id}
              onDragStart={() => setDragId(a.id)}
              onDragEnd={() => setDragId(null)}
              onDropCard={() => onDrop(a.id)}
            />
          ))}
        </div>
      )}

      {editing && (
        <AgentDrawer
          initial={editing === "new" ? BLANK : draftOf(editing)}
          isNew={editing === "new"}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </main>
  );
}

function draftOf(a: AgentRow): Draft {
  return {
    title: a.title,
    instruction: a.instruction,
    renderTarget: a.renderTarget,
    dataSource: a.dataSource,
    model: a.model,
    budgetCents: a.budgetCents,
  };
}

/* ------------------------------------------------------------------- card */

function AgentCard({
  agent,
  running,
  onRun,
  onEdit,
  onDelete,
  dragging,
  onDragStart,
  onDragEnd,
  onDropCard,
}: {
  agent: AgentRow;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropCard: () => void;
}) {
  const rt = renderTargetInfo(agent.renderTarget);
  const ds = dataSourceInfo(agent.dataSource);
  const overBudget = agent.lastCostMicros > agent.budgetCents * 10_000;

  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropCard}
      className={`flex flex-col rounded-xl border bg-white p-4 transition dark:bg-zinc-950 ${
        dragging
          ? "border-violet-400 opacity-50"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {agent.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip>{ds.label}</Chip>
            <Chip>{rt.label}</Chip>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-zinc-400">
          <button onClick={onEdit} title="Edit" className="rounded p-1 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            ✎
          </button>
          <button onClick={onDelete} title="Delete" className="rounded p-1 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800">
            ×
          </button>
        </div>
      </div>

      <div className="min-h-[64px] flex-1 py-2">
        {running ? (
          <div className="flex items-center gap-2 text-sm text-violet-500">
            <Spinner /> Running…
          </div>
        ) : (
          <AgentResultView result={agent.lastResult} />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-900">
        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
          <span>{relTime(agent.lastRunAt)}</span>
          {agent.lastRunAt && (
            <span className={overBudget ? "text-red-500" : ""}>
              {formatUsd(agent.lastCostMicros)}
            </span>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
        >
          {agent.lastRunAt ? "Refresh" : "Run"}
        </button>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- drawer */

function AgentDrawer({
  initial,
  isNew,
  onClose,
  onSave,
}: {
  initial: Draft;
  isNew: boolean;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {isNew ? "New agent" : "Edit agent"}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            ×
          </button>
        </div>

        <Field label="Name">
          <input
            value={d.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Bitcoin price"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700"
          />
        </Field>

        <Field label="What should it do?">
          <textarea
            value={d.instruction}
            onChange={(e) => set("instruction", e.target.value)}
            rows={3}
            placeholder="Describe the task in plain language — Claude runs this each time."
            className="w-full resize-y rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-violet-400 dark:border-zinc-700"
          />
        </Field>

        <Field label="Where does it pull from?">
          <Select value={d.dataSource} onChange={(v) => set("dataSource", v as AgentDataSource)}>
            {DATA_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <Hint>{dataSourceInfo(d.dataSource).blurb}</Hint>
        </Field>

        <Field label="How should the result look?">
          <Select value={d.renderTarget} onChange={(v) => set("renderTarget", v as AgentRenderTarget)}>
            {RENDER_TARGETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Hint>{renderTargetInfo(d.renderTarget).blurb}</Hint>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Model">
            <Select value={d.model} onChange={(v) => set("model", v)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Budget / run">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-400">¢</span>
              <input
                type="number"
                min={1}
                max={500}
                value={d.budgetCents}
                onChange={(e) => set("budgetCents", Number(e.target.value) || 1)}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700"
              />
            </div>
          </Field>
        </div>

        <div className="mt-2 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-700">
          ⏰ Scheduling (run automatically each morning) arrives in the next stage. For
          now agents run when you hit <span className="font-medium">Run</span>.
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => onSave({ ...d, model: resolveModel(d.model).id })}
            disabled={!d.title.trim() && !d.instruction.trim()}
            className="flex-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isNew ? "Create agent" : "Save changes"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- empty state */

function Empty({ onAdd, onBlank }: { onAdd: (d: Draft) => void; onBlank: () => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
      <div className="text-2xl">🤖</div>
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Build your first agent
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-zinc-500">
        An agent is a saved task Claude runs for you — pulling from the web or your own
        notes and tasks — and shows the answer as a tidy card. Start from one of these,
        or build your own.
      </p>
      <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button
            key={s.title}
            onClick={() => onAdd(s)}
            className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-zinc-800 dark:hover:border-violet-700 dark:hover:bg-violet-950/20"
          >
            <span className="text-xl">{s.emoji}</span>
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {s.title}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-400">
                {dataSourceInfo(s.dataSource).label} · {renderTargetInfo(s.renderTarget).label}
              </span>
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={onBlank}
        className="mt-6 text-sm text-violet-600 hover:underline dark:text-violet-400"
      >
        …or start from scratch →
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-zinc-400">{children}</p>;
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
    >
      {children}
    </select>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}
