import Link from "next/link";
import { getSession } from "@/lib/session";
import { monthlyMessageLimit } from "@/lib/billing";
import { SiteHeader } from "@/components/site-header";
import { Dashboard } from "@/components/dashboard";

export default async function Home() {
  const session = await getSession();

  return (
    <>
      <SiteHeader />
      {session ? (
        <Dashboard
          userId={session.user.id}
          name={session.user.name}
          limit={monthlyMessageLimit(session.user)}
        />
      ) : (
        <Landing />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Landing -- */

function Landing() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
          Lyons Software
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          Chat with Claude.
          <br />
          Plus notes and live dashboards.
        </h1>
        <p className="max-w-xl text-base text-zinc-500">
          Static Cling is your AI workspace — a fast Claude chat with live web
          search and image understanding. Notes and a dashboard are on the way.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
          >
            Start chatting — free
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
        <p className="font-mono text-xs text-zinc-400">
          Free plan: 50 messages / month · Pro $8/mo
        </p>
      </section>

      <section className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto grid w-full max-w-5xl gap-px px-6 py-px sm:grid-cols-3">
          <Feature
            badge="Live"
            title="Chat"
            body="Claude with live web search and image understanding. Drag in a screenshot, ask about the news, switch models on the fly."
          />
          <Feature
            badge="Live"
            title="Notes"
            body="A rich editor that keeps your thinking next to the AI — and feeds it straight into chat."
          />
          <Feature
            badge="Soon"
            title="Dashboard"
            body="Small AI-powered widgets that update themselves on a schedule, for pennies."
          />
        </div>
      </section>
    </main>
  );
}

function Feature({
  badge,
  title,
  body,
}: {
  badge: string;
  title: string;
  body: string;
}) {
  return (
    <div className="px-2 py-6 sm:px-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            badge === "Live"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
          }`}
        >
          {badge}
        </span>
      </div>
      <p className="text-sm text-zinc-500">{body}</p>
    </div>
  );
}
