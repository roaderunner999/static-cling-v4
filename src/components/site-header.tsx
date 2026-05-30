import Link from "next/link";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { HeaderThemeToggle } from "@/components/header-theme-toggle";
import { MainNav } from "@/components/main-nav";
import { UserMenu } from "@/components/user-menu";
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
    <header className="z-20 shrink-0 border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
      <div className="flex w-full items-center justify-between gap-2 px-3 py-1.5 sm:px-4">
        <Link
          href="/"
          title="Static Cling v4"
          aria-label="Static Cling — home"
          className="flex shrink-0 items-center font-mono uppercase text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {/* Phone: a compact lightning mark in the corner so the wordmark can't
              crowd the nav / push the avatar off-screen. Everyone knows they're
              in Static Cling. sm+: the full wordmark returns. */}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-[19px] w-[19px] text-violet-500 sm:hidden"
            aria-hidden
          >
            <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
          </svg>
          <span className="hidden items-baseline gap-1.5 whitespace-nowrap text-xs tracking-[0.22em] sm:flex">
            <span>
              Static Cling <span className="text-zinc-400">v4</span>
            </span>
            <span className="text-[9px] normal-case tracking-normal text-zinc-300 dark:text-zinc-600">
              build {APP_VERSION}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-sm sm:gap-1.5">
          <HeaderThemeToggle />
          {session ? (
            <>
              {/* Renegades lives up here now (pulled off the left rail) — the
                  signature live-rooms feature, in violet so it stands apart. */}
              <Link
                href="/renegades"
                title="Renegades — live rooms"
                className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-violet-600 shadow-[0_0_0_0_rgba(124,58,237,0)] transition hover:bg-violet-50 hover:shadow-[0_0_12px_-2px_rgba(124,58,237,0.45)] sm:flex dark:text-violet-400 dark:hover:bg-violet-950/40"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" aria-hidden>
                  <rect x="3" y="6" width="9" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M12 9l4.5-2.2v6.4L12 11" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                Renegades
              </Link>
              {/* Mobile only — on md+ the left rail is the nav. */}
              <div className="md:hidden">
                <MainNav />
              </div>
              <UserMenu
                name={session.user.name}
                email={session.user.email}
                isAdmin={isAdmin(session.user)}
              />
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
