"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import type { TaskRow, ChecklistItem } from "@/lib/task-queries";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }

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
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(id);
      return nextSet;
    });
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
    <main className="w-full flex-1 px-4 py-8 sm:px-8">
      {/* Compact header: title + inline stats + thin progress bar */}
      <div className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Tasks
          </h1>
          <div className="flex items-baseline gap-3 text-sm text-zinc-500">
            <Stat label="active" value={tasks.length - done} />
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Stat label="done" value={done} />
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Stat label="total" value={tasks.length} />
            <span className="ml-1 font-mono text-xs text-violet-500 dark:text-violet-400">
              {pct}%
            </span>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-violet-400 transition-[width] duration-500 dark:bg-violet-500"
            style={{ width: `${pct}%` }}
          />
        </div>
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
        {view === "grid" && (
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            <button
              onClick={() => setExpanded(new Set(filtered.map((t) => t.id)))}
              className="px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
              title="Open every task's details"
            >
              Expand all
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="border-l border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              title="Close all open tasks"
            >
              Collapse all
            </button>
          </div>
        )}
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
        <Grid
          tasks={filtered}
          patch={patch}
          remove={remove}
          expanded={expanded}
          toggleExpand={toggleExpand}
        />
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
  expanded,
  toggleExpand,
}: {
  tasks: Task[];
  patch: (id: string, p: Partial<Task>) => void;
  remove: (id: string) => void;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
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
          {tasks.map((t) => {
            const open = expanded.has(t.id);
            const doneCount = t.checklist.filter((c) => c.done).length;
            return (
              <Fragment key={t.id}>
                <tr
                  className={`border-b border-zinc-100 transition-colors last:border-0 dark:border-zinc-900 ${
                    open ? "bg-violet-50/40 dark:bg-violet-950/20" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpand(t.id)}
                        aria-expanded={open}
                        title={open ? "Hide details" : "Show details"}
                        className="grid h-5 w-5 place-items-center rounded text-zinc-400 transition hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-200"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M7 4l6 6-6 6" />
                        </svg>
                      </button>
                      <input
                        type="checkbox"
                        checked={t.status === "done"}
                        onChange={(e) => patch(t.id, { status: e.target.checked ? "done" : "todo" })}
                        title="Mark done"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        defaultValue={t.title}
                        onBlur={(e) =>
                          e.target.value.trim() !== t.title && patch(t.id, { title: e.target.value })
                        }
                        className={`w-full min-w-[180px] bg-transparent outline-none ${
                          t.status === "done" ? "text-zinc-400 line-through" : ""
                        }`}
                      />
                      {t.checklist.length > 0 && (
                        <button
                          onClick={() => toggleExpand(t.id)}
                          title="Checklist progress"
                          className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                        >
                          ✓ {doneCount}/{t.checklist.length}
                        </button>
                      )}
                    </div>
                    {!open && t.detail && (
                      <div className="mt-0.5 truncate text-xs text-zinc-400">{t.detail}</div>
                    )}
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
                {open && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-900">
                    <td colSpan={7} className="p-0">
                      <TaskPanel task={t} patch={patch} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------- Expanded task details */

function TaskPanel({ task, patch }: { task: Task; patch: (id: string, p: Partial<Task>) => void }) {
  return (
    <div className="border-l-2 border-violet-400/70 bg-violet-50/30 px-4 py-4 dark:border-violet-500/60 dark:bg-violet-950/15">
      <div className="grid gap-5 md:grid-cols-2">
        {/* Notes */}
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Notes
          </p>
          <textarea
            defaultValue={task.detail}
            placeholder="Add a description, context, phone numbers, links…"
            onBlur={(e) => e.target.value !== task.detail && patch(task.id, { detail: e.target.value })}
            rows={4}
            className="w-full resize-y rounded-md border border-zinc-200 bg-white/70 px-3 py-2 text-sm leading-relaxed text-zinc-700 outline-none transition focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200"
          />
        </div>

        {/* Checklist */}
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Checklist
          </p>
          <ChecklistEditor
            items={task.checklist}
            onChange={(items) => patch(task.id, { checklist: items })}
          />
        </div>
      </div>

      <p className="mt-3 font-mono text-[10px] text-zinc-400">
        Added {new Date(task.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}

function ChecklistEditor({
  items,
  onChange,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { text, done: false }]);
    setDraft("");
  }

  return (
    <div>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="group flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) =>
                  onChange(items.map((it, j) => (j === i ? { ...it, done: e.target.checked } : it)))
                }
              />
              <input
                defaultValue={item.text}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.text)
                    onChange(items.map((it, j) => (j === i ? { ...it, text: v } : it)));
                }}
                className={`flex-1 bg-transparent text-sm outline-none ${
                  item.done ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-200"
                }`}
              />
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                title="Remove item"
                className="text-zinc-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Add a sub-task… (Enter)"
          className="flex-1 rounded-md border border-zinc-200 bg-white/70 px-2.5 py-1.5 text-sm outline-none transition focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900/50"
        />
        <button
          onClick={addItem}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm transition hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          +
        </button>
      </div>
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
    <span className="flex items-baseline gap-1">
      <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
    </span>
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
