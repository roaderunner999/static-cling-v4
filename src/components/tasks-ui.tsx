"use client";

import { useMemo, useRef, useState } from "react";
import type { TaskRow } from "@/lib/task-queries";
import { createTask, updateTask, deleteTask, importTasks } from "@/lib/task-actions";

type Task = TaskRow;

const STATUSES = ["todo", "doing", "done"] as const;
const STATUS_LABEL: Record<string, string> = { todo: "To Do", doing: "Doing", done: "Done" };
const PRIORITIES = ["low", "medium", "high"] as const;

const STATUS_CLASS: Record<string, string> = {
  todo: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  doing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
const PRIORITY_CLASS: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const next = <T,>(arr: readonly T[], cur: T): T => arr[(arr.indexOf(cur) + 1) % arr.length];

function dueStr(d: Date | null) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export function TasksUI({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [view, setView] = useState<"grid" | "board">("grid");
  const [title, setTitle] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [fGoal, setFGoal] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const goals = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.goal).filter(Boolean))).sort(),
    [tasks],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (fGoal && t.goal !== fGoal) return false;
      if (fPriority && t.priority !== fPriority) return false;
      if (hideDone && t.status === "done") return false;
      if (q && !(`${t.title} ${t.detail} ${t.goal}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, fGoal, fPriority, hideDone, search]);

  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  /* ---- mutations (optimistic local + server action) ---- */
  function patch(id: string, p: Partial<Task>) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    void updateTask(id, p as never);
  }

  async function add() {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    const res = await createTask({ title: t, goal: newGoal, priority: newPriority });
    if (!res) return;
    setTasks((ts) => [
      ...ts,
      {
        id: res.id,
        title: t,
        detail: "",
        goal: newGoal.trim(),
        status: "todo",
        priority: newPriority,
        dueAt: null,
        checklist: [],
        createdAt: new Date(),
      },
    ]);
  }

  function remove(id: string) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    void deleteTask(id);
  }

  function exportJson() {
    const data = { version: 1, exportedAt: new Date().toISOString(), tasks };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `static-cling-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File) {
    try {
      const payload = JSON.parse(await file.text());
      const { imported } = await importTasks(payload);
      if (imported > 0) window.location.reload();
      else alert("No tasks found in that file.");
    } catch {
      alert("Couldn't read that file — make sure it's a tasks JSON export.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
          Static Cling
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Tasks
        </h1>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tasks" value={tasks.length} />
        <Stat label="Active" value={tasks.length - done} />
        <Stat label="Done" value={done} />
        <Stat label="Complete" value={`${pct}%`} />
      </div>

      {/* New task */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="What needs doing? (Enter to add)"
          className="min-w-[200px] flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="Goal (optional)"
          list="goal-list"
          className="w-36 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
        >
          + Add
        </button>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["grid", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm capitalize transition ${
                view === v
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="min-w-[140px] flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <select
          value={fGoal}
          onChange={(e) => setFGoal(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={fPriority}
          onChange={(e) => setFPriority(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-500">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide done
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onImport(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          title="Import tasks from a JSON export"
        >
          Import
        </button>
        <button
          onClick={exportJson}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          title="Export tasks as JSON"
        >
          Export
        </button>
      </div>

      <datalist id="goal-list">
        {goals.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">No tasks here yet.</p>
      ) : view === "grid" ? (
        <Grid tasks={filtered} patch={patch} remove={remove} />
      ) : (
        <Board tasks={filtered} patch={patch} />
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- Grid view */

function Grid({
  tasks,
  patch,
  remove,
}: {
  tasks: Task[];
  patch: (id: string, p: Partial<Task>) => void;
  remove: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            {["", "Task", "Goal", "Status", "Priority", "Due", ""].map((h, i) => (
              <th key={i} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={(e) => patch(t.id, { status: e.target.checked ? "done" : "todo" })}
                  title="Mark done"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  defaultValue={t.title}
                  onBlur={(e) =>
                    e.target.value.trim() !== t.title && patch(t.id, { title: e.target.value })
                  }
                  className={`w-full min-w-[180px] bg-transparent outline-none ${
                    t.status === "done" ? "text-zinc-400 line-through" : ""
                  }`}
                />
                {t.detail && <div className="text-xs text-zinc-400">{t.detail}</div>}
              </td>
              <td className="px-3 py-2">
                <input
                  defaultValue={t.goal}
                  list="goal-list"
                  placeholder="—"
                  onBlur={(e) => e.target.value !== t.goal && patch(t.id, { goal: e.target.value })}
                  className="w-28 bg-transparent text-xs text-zinc-500 outline-none"
                />
              </td>
              <td className="px-3 py-2">
                <Pill className={STATUS_CLASS[t.status]} onClick={() => patch(t.id, { status: next(STATUSES, t.status as never) })}>
                  {STATUS_LABEL[t.status]}
                </Pill>
              </td>
              <td className="px-3 py-2">
                <Pill className={PRIORITY_CLASS[t.priority]} onClick={() => patch(t.id, { priority: next(PRIORITIES, t.priority as never) })}>
                  {t.priority}
                </Pill>
              </td>
              <td className="px-3 py-2">
                <input
                  type="date"
                  value={dueStr(t.dueAt)}
                  onChange={(e) => patch(t.id, { dueAt: e.target.value ? new Date(e.target.value) : null })}
                  className="bg-transparent text-xs text-zinc-500 outline-none"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => remove(t.id)} title="Delete" className="text-zinc-400 hover:text-red-600">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- Board view */

function Board({ tasks, patch }: { tasks: Task[]; patch: (id: string, p: Partial<Task>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
            <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {STATUS_LABEL[s]} · {col.length}
            </p>
            <div className="flex flex-col gap-2">
              {col.map((t) => (
                <div key={t.id} className="rounded-lg border border-zinc-200 bg-white p-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className={t.status === "done" ? "text-zinc-400 line-through" : ""}>{t.title}</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {t.goal && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                        {t.goal}
                      </span>
                    )}
                    <Pill className={PRIORITY_CLASS[t.priority]} onClick={() => patch(t.id, { priority: next(PRIORITIES, t.priority as never) })}>
                      {t.priority}
                    </Pill>
                    <button
                      onClick={() => patch(t.id, { status: next(STATUSES, t.status as never) })}
                      className="ml-auto text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      title="Move to next status"
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- shared */

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

function Pill({
  className,
  onClick,
  children,
}: {
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize transition hover:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}
