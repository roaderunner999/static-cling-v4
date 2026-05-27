"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type {
  AdminData,
  AdminStats,
  AdminUserRow,
  SecurityEvent,
} from "@/lib/admin-queries";
import {
  updateUserAction,
  revokeSessionsAction,
  sendPasswordResetAction,
  deleteUserAction,
  type ActionResult,
} from "@/lib/admin-actions";

/* ----------------------------- formatting ------------------------------ */

function rel(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const fullDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/* ------------------------------- console ------------------------------- */

type Toast = { kind: "ok" | "err"; text: string };

export function AdminConsole({
  data,
  selfId,
  adminEmail,
  emailEnabled,
}: {
  data: AdminData;
  selfId: string;
  adminEmail: string;
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setToast({ kind: "ok", text: res.message ?? "Done." });
        onOk?.();
        router.refresh();
      } else {
        setToast({ kind: "err", text: res.error });
      }
      setTimeout(() => setToast(null), 4000);
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.lastLoginIp ?? "").includes(q),
    );
  }, [query, data.users]);

  const selected = data.users.find((u) => u.id === selectedId) ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
            Static Cling
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Admin console
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Signed in as {adminEmail}
          </p>
        </div>
        <Link
          href="/profile"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          ← Your profile
        </Link>
      </div>

      {/* Stats */}
      <StatsRow stats={data.stats} />

      {/* Toolbar */}
      <div className="mb-3 mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Users · {filtered.length}
          {filtered.length !== data.users.length ? ` of ${data.users.length}` : ""}
        </h2>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, IP…"
            className="w-56 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="button"
            onClick={() => exportCsv(data.users)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Users table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left font-mono text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
              <Th>User</Th>
              <Th>Plan</Th>
              <Th>Last login</Th>
              <Th>IP · device</Th>
              <Th className="text-right">Sessions</Th>
              <Th className="text-right">Spend</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                className="cursor-pointer border-b border-zinc-100 transition last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {u.name || "—"}
                    </span>
                    {u.role === "admin" && <Badge tone="violet">admin</Badge>}
                    {u.id === selfId && <Badge tone="zinc">you</Badge>}
                    {!u.emailVerified && <Badge tone="amber">unverified</Badge>}
                  </div>
                  <div className="font-mono text-xs text-zinc-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={u.plan === "pro" ? "green" : "zinc"}>{u.plan}</Badge>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                  {rel(u.lastLoginAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                    {u.lastLoginIp ?? "—"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {u.lastLoginDevice ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {u.activeSessions > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      {u.activeSessions}
                    </span>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {money(u.spendCents)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  No users match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Security log */}
      <SecurityLog events={data.securityLog} />

      {/* Edit drawer */}
      {selected && (
        <EditDrawer
          key={selected.id}
          user={selected}
          selfId={selfId}
          emailEnabled={emailEnabled}
          pending={pending}
          onClose={() => setSelectedId(null)}
          run={run}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${
            toast.kind === "ok"
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </main>
  );
}

/* -------------------------------- stats -------------------------------- */

function StatsRow({ stats }: { stats: AdminStats }) {
  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Users", value: String(stats.totalUsers), hint: `${stats.admins} admin` },
    { label: "Pro", value: String(stats.proUsers), hint: `$${stats.mrrUsd}/mo MRR` },
    { label: "Verified", value: `${stats.verifiedUsers}/${stats.totalUsers}` },
    { label: "New · 7d", value: String(stats.newUsers7d) },
    { label: "Active sessions", value: String(stats.activeSessions) },
    { label: "Claude spend", value: money(stats.totalSpendCents), hint: "all time" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            {c.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {c.value}
          </p>
          {c.hint && <p className="mt-0.5 text-xs text-zinc-400">{c.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- security log ----------------------------- */

function SecurityLog({ events }: { events: SecurityEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-zinc-500">
        Recent logins
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {events.map((e) => (
              <tr
                key={e.sessionId}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
              >
                <td className="px-4 py-2.5">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">
                    {e.email}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-zinc-500">{rel(e.at)}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {e.ip ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {e.device ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {e.active ? (
                    <Badge tone="green">active</Badge>
                  ) : (
                    <Badge tone="zinc">expired</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------- edit drawer ------------------------------ */

function EditDrawer({
  user,
  selfId,
  emailEnabled,
  pending,
  onClose,
  run,
}: {
  user: AdminUserRow;
  selfId: string;
  emailEnabled: boolean;
  pending: boolean;
  onClose: () => void;
  run: (action: () => Promise<ActionResult>, onOk?: () => void) => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role === "admin" ? "admin" : "user");
  const [plan, setPlan] = useState(user.plan === "pro" ? "pro" : "free");
  const [verified, setVerified] = useState(user.emailVerified);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const isSelf = user.id === selfId;
  const dirty =
    name !== user.name ||
    email !== user.email ||
    role !== (user.role === "admin" ? "admin" : "user") ||
    plan !== (user.plan === "pro" ? "pro" : "free") ||
    verified !== user.emailVerified;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      {/* panel */}
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Edit user
            </p>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {user.name || user.email}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900"
          >
            ✕
          </button>
        </div>

        {/* editable fields */}
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </Field>
          <Field label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSelf}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            <Field label="Plan">
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              >
                <option value="free">free</option>
                <option value="pro">pro</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Email verified
          </label>
        </div>

        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() =>
            run(
              () =>
                updateUserAction({
                  userId: user.id,
                  name,
                  email,
                  role: role as "user" | "admin",
                  plan: plan as "free" | "pro",
                  emailVerified: verified,
                }),
              onClose,
            )
          }
          className="mt-5 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>

        {/* read-only facts */}
        <dl className="mt-6 divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-900 dark:border-zinc-800">
          <Fact label="User ID" value={user.id} mono />
          <Fact label="Member since" value={fullDate(user.createdAt)} />
          <Fact label="Last seen" value={rel(user.lastSeenAt)} />
          <Fact label="Last login" value={fullDate(user.lastLoginAt)} />
          <Fact label="Last IP" value={user.lastLoginIp ?? "—"} mono />
          <Fact label="Device" value={user.lastLoginDevice ?? "—"} />
          <Fact label="Active sessions" value={String(user.activeSessions)} />
          <Fact
            label="Subscription"
            value={user.subscriptionStatus ?? "—"}
          />
          <Fact label="Renews / ends" value={fullDate(user.currentPeriodEnd)} />
          <Fact
            label="Claude usage"
            value={`${money(user.spendCents)} · ${user.messages} msg`}
          />
        </dl>

        {/* account actions */}
        <div className="mt-6 space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Account actions
          </p>
          <button
            type="button"
            disabled={pending || !emailEnabled}
            title={
              emailEnabled
                ? "Email the user a password-reset link"
                : "Needs Resend (email) — see deploy/STAGE-1-AUTH.md"
            }
            onClick={() => run(() => sendPasswordResetAction(user.id))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Send password-reset email
            {!emailEnabled && " (email not configured)"}
          </button>
          <button
            type="button"
            disabled={pending || user.activeSessions === 0}
            onClick={() => run(() => revokeSessionsAction(user.id))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Force sign-out ({user.activeSessions})
          </button>
        </div>

        {/* danger zone */}
        {!isSelf && (
          <div className="mt-6 rounded-lg border border-red-200 p-3 dark:border-red-900/50">
            <p className="font-mono text-[11px] uppercase tracking-wider text-red-500">
              Danger zone
            </p>
            {!showDelete ? (
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="mt-2 w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
              >
                Delete this account…
              </button>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-zinc-500">
                  This permanently deletes the user and all their sessions and
                  usage. Type <span className="font-mono">{user.email}</span> to
                  confirm.
                </p>
                <input
                  value={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value)}
                  placeholder={user.email}
                  className="w-full rounded-md border border-red-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-red-500 dark:border-red-900"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDelete(false);
                      setConfirmDelete("");
                    }}
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending || confirmDelete !== user.email}
                    onClick={() => run(() => deleteUserAction(user.id), onClose)}
                    className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ primitives ----------------------------- */

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-4 py-2.5 font-normal ${className}`}>{children}</th>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd
        className={`text-right text-zinc-800 dark:text-zinc-100 ${mono ? "break-all font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

type Tone = "zinc" | "green" | "violet" | "amber";
function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const tones: Record<Tone, string> = {
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
    violet:
      "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------- export -------------------------------- */

function exportCsv(users: AdminUserRow[]) {
  const headers = [
    "name",
    "email",
    "role",
    "plan",
    "emailVerified",
    "createdAt",
    "lastLoginAt",
    "lastLoginIp",
    "lastLoginDevice",
    "activeSessions",
    "spendUsd",
    "messages",
  ];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const u of users) {
    lines.push(
      [
        u.name,
        u.email,
        u.role,
        u.plan,
        u.emailVerified ? "yes" : "no",
        u.createdAt,
        u.lastLoginAt ?? "",
        u.lastLoginIp ?? "",
        u.lastLoginDevice ?? "",
        String(u.activeSessions),
        (u.spendCents / 100).toFixed(2),
        String(u.messages),
      ]
        .map((v) => esc(String(v)))
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `static-cling-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
