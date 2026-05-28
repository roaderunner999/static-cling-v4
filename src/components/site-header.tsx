import Link from "next/link";
import { getSession } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_VERSION } from "@/lib/version";

/**
 * The shared top bar for the marketing / account pages (home, profile, …).
 * Renders the brand plus an auth-aware nav: signed-in users always see Chat,
 * their email, and a Sign out button (so logout is reachable everywhere, not
 * buried in Profile); signed-out visitors see Sign in / Create account.
 *
 * Server component so it can read the session directly. The chat app has its
 * own full-height chrome, so it surfaces these in its sidebar instead.
 */
export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
      <div className="flex w-full items-center justify-between px-5 py-3">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Static Cling <span className="text-zinc-400">v4</span>
          <span className="ml-2 text-[9px] normal-case tracking-normal text-zinc-300 dark:text-zinc-600">
            build {APP_VERSION}
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          <ThemeToggle />
          {session ? (
            <>
              <Link
                href="/chat"
                className="rounded-md px-3 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Chat
              </Link>
              <Link
                href="/notes"
                className="rounded-md px-3 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Notes
              </Link>
              <Link
                href="/tasks"
                className="rounded-md px-3 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Tasks
              </Link>
              <Link
                href="/profile"
                className="rounded-md px-3 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Profile
              </Link>
              <span className="mx-1 hidden font-mono text-xs text-zinc-400 sm:inline">
                {session.user.email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
