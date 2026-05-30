"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { MySettings } from "@/lib/settings-queries";
import { formatUsd, resolveModel } from "@/lib/models";
import { PRO_PRICE_USD } from "@/lib/billing";
import {
  updateMyProfile,
  updateMyPreferences,
  revokeMyOtherSessions,
  deleteMyAccount,
  type ActionResult,
} from "@/lib/settings-actions";
import { startCheckout, openBillingPortal } from "@/lib/billing-actions";
import { getRailLabelStyle, setRailLabelStyle, type RailLabelStyle } from "@/lib/rail-prefs";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const modelLabel = (id: string) => resolveModel(id).label || id;

function rel(iso: string): string {
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

type Toast = { kind: "ok" | "err"; text: string };

export function SettingsUI({
  settings,
  currentSessionId,
  identity,
  pro,
  admin,
  billingEnabled,
  messageLimit,
  models,
}: {
  settings: MySettings;
  currentSessionId: string;
  identity: { name: string; email: string; emailVerified: boolean; createdAt: string };
  pro: boolean;
  admin: boolean;
  billingEnabled: boolean;
  messageLimit: number;
  models: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await action();
      setToast(res.ok ? { kind: "ok", text: res.message ?? "Done." } : { kind: "err", text: res.error });
      if (res.ok) router.refresh();
      setTimeout(() => setToast(null), 4000);
    });
  }

  return (
    <main className="w-full flex-1 px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Settings
          </h1>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/chat" className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Open chat →
          </Link>
          {admin && (
            <Link href="/admin" className="rounded-md border border-violet-300 px-3 py-1.5 font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40">
              Admin →
            </Link>
          )}
        </nav>
      </div>

      <div className="flex flex-col gap-6">
        <ProfileCard identity={identity} pending={pending} run={run} />
        <UsageCard settings={settings} messageLimit={messageLimit} />
        <BillingCard pro={pro} billingEnabled={billingEnabled} settings={settings} />
        <PreferencesCard
          prefs={settings.preferences}
          models={models}
          pending={pending}
          run={run}
        />
        <AppearanceCard />
        <SecurityCard
          sessions={settings.sessions}
          currentSessionId={currentSessionId}
          pending={pending}
          run={run}
        />
        <DangerCard email={identity.email} pending={pending} run={run} />
      </div>

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

/* -------------------------------- cards -------------------------------- */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProfileCard({
  identity,
  pending,
  run,
}: {
  identity: { name: string; email: string; emailVerified: boolean; createdAt: string };
  pending: boolean;
  run: (a: () => Promise<ActionResult>) => void;
}) {
  const [name, setName] = useState(identity.name);
  const dirty = name.trim() !== identity.name && name.trim().length > 0;
  return (
    <Card title="Profile">
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-500">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
        <span className="font-mono text-xs">{identity.email}</span>
        <span>{identity.emailVerified ? "Verified" : "Unverified"}</span>
        <span>Member since {new Date(identity.createdAt).toLocaleDateString()}</span>
      </div>
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() => run(() => updateMyProfile({ name: name.trim() }))}
        className="mt-4 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </Card>
  );
}

function UsageCard({
  settings,
  messageLimit,
}: {
  settings: MySettings;
  messageLimit: number;
}) {
  const { usage, messagesThisMonth } = settings;
  const pct = messageLimit > 0 ? Math.min(100, Math.round((messagesThisMonth / messageLimit) * 100)) : 0;
  return (
    <Card title="Usage">
      <div className="mb-4">
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">Messages this month</span>
          <span className="tabular-nums text-zinc-500">
            {num(messagesThisMonth)} / {num(messageLimit)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-amber-500" : "bg-zinc-900 dark:bg-zinc-100"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Spend this month" value={formatUsd(usage.spendMicrosMonth)} />
        <Stat label="Spend all time" value={formatUsd(usage.spendMicros)} />
        <Stat label="Claude calls" value={num(usage.calls)} />
        <Stat label="Tokens" value={num(usage.inputTokens + usage.outputTokens)} />
      </div>

      {usage.byModel.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left font-mono text-[10px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 font-normal">Model</th>
                <th className="px-3 py-2 text-right font-normal">Calls</th>
                <th className="px-3 py-2 text-right font-normal">Spend</th>
              </tr>
            </thead>
            <tbody>
              {usage.byModel.map((m) => (
                <tr key={m.model} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2 text-zinc-800 dark:text-zinc-100">{modelLabel(m.model)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{num(m.calls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatUsd(m.spendMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-400">
        Spend is computed from real token counts at micro-dollar precision — the same
        ledger your account is metered against.
      </p>
    </Card>
  );
}

function BillingCard({
  pro,
  billingEnabled,
  settings,
}: {
  pro: boolean;
  billingEnabled: boolean;
  settings: MySettings;
}) {
  return (
    <Card title="Plan & billing">
      {!billingEnabled ? (
        <p className="text-sm text-zinc-500">Billing isn’t configured on this server yet.</p>
      ) : pro ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            You’re on <strong>Pro</strong>
            {settings.subscriptionStatus ? ` (${settings.subscriptionStatus})` : ""}.
            {settings.currentPeriodEnd
              ? ` Renews ${new Date(settings.currentPeriodEnd).toLocaleDateString()}.`
              : ""}
          </p>
          <form action={openBillingPortal}>
            <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
              Manage billing
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            You’re on the <strong>Free</strong> plan. Pro unlocks the Lab, scheduled
            agents, and a much higher monthly limit.
          </p>
          <form action={startCheckout}>
            <button type="submit" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900">
              Upgrade to Pro — ${PRO_PRICE_USD}/mo
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}

function PreferencesCard({
  prefs,
  models,
  pending,
  run,
}: {
  prefs: MySettings["preferences"];
  models: { id: string; label: string }[];
  pending: boolean;
  run: (a: () => Promise<ActionResult>) => void;
}) {
  const [defaultModel, setDefaultModel] = useState(prefs.defaultModel ?? "auto");
  const [defaultView, setDefaultView] = useState(prefs.defaultView ?? "dashboard");
  const dirty =
    defaultModel !== (prefs.defaultModel ?? "auto") ||
    defaultView !== (prefs.defaultView ?? "dashboard");

  return (
    <Card title="Preferences">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-500">Default chat model</span>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="auto">✦ Auto (let Claude pick)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-zinc-400">
            New chats open to this. Auto routes each message to the cheapest capable model.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-500">Open to</span>
          <select
            value={defaultView}
            onChange={(e) => setDefaultView(e.target.value as "dashboard" | "chat")}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="dashboard">Dashboard</option>
            <option value="chat">Chat</option>
          </select>
          <span className="mt-1 block text-xs text-zinc-400">
            Where the home page lands you when you’re signed in.
          </span>
        </label>
      </div>
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() => run(() => updateMyPreferences({ defaultModel, defaultView }))}
        className="mt-4 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </Card>
  );
}

const THEME_HEADER_KEY = "staticcling_theme_header";

function AppearanceCard() {
  const [dark, setDark] = useState<boolean | null>(null);
  const [inHeader, setInHeader] = useState(false);
  const [railStyle, setRailStyle] = useState<RailLabelStyle>("under");

  useEffect(() => {
    // Client-only: reflect the theme the no-flash script already applied + the
    // saved header-toggle preference. Post-mount reads, so the setState is fine.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDark(document.documentElement.classList.contains("dark"));
    try {
      setInHeader(localStorage.getItem(THEME_HEADER_KEY) === "1");
    } catch {
      /* ignore */
    }
    setRailStyle(getRailLabelStyle());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function chooseRail(v: RailLabelStyle) {
    setRailStyle(v);
    setRailLabelStyle(v); // persists + tells the live rail to re-render
  }

  function setTheme(d: boolean) {
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("theme", d ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(d);
  }

  function toggleHeader(v: boolean) {
    setInHeader(v);
    try {
      localStorage.setItem(THEME_HEADER_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    // Let the header's toggle appear/disappear live (same page).
    window.dispatchEvent(new Event("sc-theme-header"));
  }

  return (
    <Card title="Appearance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-zinc-600 dark:text-zinc-300">Theme</span>
        <div className="flex overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700">
          {([
            ["light", "☀️ Light", false],
            ["dark", "🌙 Dark", true],
          ] as const).map(([key, label, isDark]) => {
            const active = dark === null ? false : dark === isDark;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(isDark)}
                className={`px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={inHeader}
          onChange={(e) => toggleHeader(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        Show a quick light/dark toggle in the top bar
      </label>
      <p className="mt-1 text-xs text-zinc-400">
        Off by default — most people set the theme once. Turn this on if you like to
        flip it on the fly.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-900">
        <span className="text-sm text-zinc-600 dark:text-zinc-300">Sidebar labels</span>
        <div className="flex overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700">
          {([
            ["under", "Under icon"],
            ["hover", "Hover box"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseRail(key)}
              className={`px-3 py-1.5 font-medium transition ${
                railStyle === key
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        The desktop left rail: a tiny label under each icon (default), or a small
        label box that appears beside an icon on hover.
      </p>
    </Card>
  );
}

function SecurityCard({
  sessions,
  currentSessionId,
  pending,
  run,
}: {
  sessions: MySettings["sessions"];
  currentSessionId: string;
  pending: boolean;
  run: (a: () => Promise<ActionResult>) => void;
}) {
  const active = sessions.filter((s) => s.active);
  const others = active.filter((s) => s.id !== currentSessionId).length;
  return (
    <Card title="Security">
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {active.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-3 py-2.5">
                  <span className="text-zinc-800 dark:text-zinc-100">{s.device ?? "Unknown device"}</span>
                  {s.id === currentSessionId && (
                    <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-green-700 dark:bg-green-950 dark:text-green-400">
                      this device
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">{s.ip ?? "—"}</td>
                <td className="px-3 py-2.5 text-right text-xs text-zinc-500">{rel(s.createdAt)}</td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-sm text-zinc-500">No active sessions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={pending || others === 0}
        onClick={() => run(() => revokeMyOtherSessions())}
        className="mt-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Sign out other devices{others > 0 ? ` (${others})` : ""}
      </button>
    </Card>
  );
}

function DangerCard({
  email,
  pending,
  run,
}: {
  email: string;
  pending: boolean;
  run: (a: () => Promise<ActionResult>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  return (
    <section className="rounded-xl border border-red-200 p-5 dark:border-red-900/50">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-red-500">
        Danger zone
      </h2>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
        >
          Delete my account…
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500">
            This permanently deletes your account and all your chats, notes, tasks, and
            usage. Type <span className="font-mono">{email}</span> to confirm.
          </p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={email}
            className="w-full rounded-md border border-red-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-red-500 dark:border-red-900"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirm("");
              }}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || confirm.trim().toLowerCase() !== email.toLowerCase()}
              onClick={() => run(() => deleteMyAccount(confirm))}
              className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              Delete forever
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}
