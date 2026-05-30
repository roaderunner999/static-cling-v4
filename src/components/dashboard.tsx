import Link from "next/link";
import { DashboardAsk } from "@/components/dashboard-ask";
import { listTasks } from "@/lib/task-queries";
import { listNotes } from "@/lib/note-queries";
import { listConversations } from "@/lib/chat-queries";
import { listAgents } from "@/lib/agent-queries";
import { monthlyMessageCount } from "@/lib/usage";

/**
 * The logged-in landing — a command center across the three faces: at-a-glance
 * counts, your next tasks, recent notes and chats, all from existing data.
 */

const PRIO_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PRIO_CLASS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export async function Dashboard({
  userId,
  name,
  limit,
}: {
  userId: string;
  name: string;
  limit: number;
}) {
  const [tasks, notes, convos, agents, used] = await Promise.all([
    listTasks(userId),
    listNotes(userId),
    listConversations(userId),
    listAgents(userId),
    monthlyMessageCount(userId),
  ]);

  const active = tasks.filter((t) => t.status !== "done");
  const upNext = [...active]
    .sort((a, b) => (PRIO_ORDER[a.priority] ?? 1) - (PRIO_ORDER[b.priority] ?? 1))
    .slice(0, 6);
  const first = name?.trim().split(/\s+/)[0] || "there";

  // First-timer: nothing created yet. Show a calm, semi-blank welcome with a few
  // starting points instead of a grid of empty cards. As they chat / write / add
  // tasks, this page fills itself in with the command-center below.
  const isNew =
    tasks.length === 0 && notes.length === 0 && convos.length === 0 && agents.length === 0;
  if (isNew) {
    return (
      <main className="w-full flex-1 px-4 py-8 sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
          Welcome
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Hi, {first}. This is your dashboard.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
          It’s quiet for now — by design. As you chat, take notes, and add tasks,
          this page fills with what matters most: your next tasks, recent notes, and
          live counts. A good place to start:
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StartCard
            href="/chat"
            emoji="💬"
            title="Start a chat"
            body="Ask Claude anything — it can search the web and read images you drop in."
          />
          <StartCard
            href="/notes"
            emoji="📝"
            title="Write a note"
            body="A rich editor with AI word-processing and a blank, distraction-free Zen mode."
          />
          <StartCard
            href="/tasks"
            emoji="✅"
            title="Add a task"
            body="Track what you’re working on as a grid or a kanban board."
          />
          <StartCard
            href="/agents"
            emoji="🤖"
            title="Build an agent"
            body="A saved task Claude runs for you — prices, headlines, your own notes & tasks."
          />
        </div>

        <div className="mt-8">
          <Link
            href="/chat"
            className="inline-block rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
          >
            Start your first chat →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full flex-1 px-4 py-8 sm:px-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          <span className="bg-gradient-to-r from-violet-500 to-violet-400 bg-clip-text text-transparent">
            ✦
          </span>{" "}
          Back at it, {first}
        </h1>
      </div>

      {/* Slim ask/voice bar — chat is here if you want it, not plastered front. */}
      <div className="mt-4">
        <DashboardAsk />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat href="/tasks" label="Active tasks" value={active.length} />
        <Stat href="/notes" label="Notes" value={notes.length} />
        <Stat href="/chat" label="Conversations" value={convos.length} />
        <Stat href="/profile" label="Messages / mo" value={`${used} / ${limit}`} />
      </div>

      <Link
        href="/agents"
        className="mt-6 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4 transition hover:bg-violet-50 dark:border-violet-900/60 dark:bg-violet-950/20 dark:hover:bg-violet-950/30"
      >
        <span className="text-2xl">🤖</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Agents{agents.length > 0 ? ` · ${agents.length}` : " — new"}
          </span>
          <span className="block text-xs text-zinc-500">
            {agents.length > 0
              ? "Run your saved agents, or build another."
              : "Saved tasks Claude runs for you — prices, headlines, your own notes & tasks, as tidy cards."}
          </span>
        </span>
        <span className="shrink-0 text-xs text-violet-600 dark:text-violet-400">Open →</span>
      </Link>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title="Up next" href="/tasks" cta="All tasks →">
          {upNext.length === 0 ? (
            <Empty>No active tasks — nice.</Empty>
          ) : (
            upNext.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${PRIO_CLASS[t.priority] ?? PRIO_CLASS.medium}`}
                >
                  {t.priority}
                </span>
                <span className="flex-1 truncate">{t.title}</span>
                {t.goal && (
                  <span className="shrink-0 text-xs text-zinc-400">{t.goal}</span>
                )}
              </div>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Recent notes" href="/notes" cta="All notes →">
            {notes.length === 0 ? (
              <Empty>No notes yet.</Empty>
            ) : (
              notes.slice(0, 4).map((n) => (
                <Link
                  key={n.id}
                  href={`/notes?id=${n.id}`}
                  className="block truncate py-1.5 text-sm hover:text-zinc-500"
                >
                  {n.title || "Untitled"}
                </Link>
              ))
            )}
          </Card>

          <Card title="Recent chats" href="/chat" cta="Open chat →">
            {convos.length === 0 ? (
              <Empty>No conversations yet.</Empty>
            ) : (
              convos.slice(0, 4).map((c) => (
                <Link
                  key={c.id}
                  href={`/chat?id=${c.id}`}
                  className="block truncate py-1.5 text-sm hover:text-zinc-500"
                >
                  {c.title}
                </Link>
              ))
            )}
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <Link
          href="/chat?new=1"
          className="inline-block rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
        >
          Start a new chat →
        </Link>
      </div>
    </main>
  );
}

function StartCard({
  href,
  emoji,
  title,
  body,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-zinc-200 p-4 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <div className="text-xl">{emoji}</div>
      <p className="mt-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">{body}</p>
    </Link>
  );
}

function Stat({ href, label, value }: { href: string; label: string; value: number | string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-zinc-200 p-4 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <p className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </Link>
  );
}

function Card({
  title,
  href,
  cta,
  children,
}: {
  title: string;
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <Link href={href} className="text-xs text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200">
          {cta}
        </Link>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-900">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-zinc-400">{children}</p>;
}
