"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Primary nav as THREE icon dropdown buttons (+ the user menu = 4 slots) so the
 * bar fits an iPhone 13 mini without crowding. Styled to feel alive: rounded
 * pills with a soft violet hover-glow (matching the app's AI glow), a chevron
 * that flips, a press-scale, and a spring "pop" on the menu (see .nav-pop).
 *
 *   Chat   → Chat (1:1), Rooms (group + AI), Renegades (live video)
 *   Notes  → Notes, Tasks
 *   Agents → Agents
 *
 * One menu open at a time; closes on outside-click / Escape / navigation. The
 * button lights violet when you're on one of its routes.
 */

const ChatIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M2.5 7.2c0-2.2 2.2-3.9 5.5-3.9s5.5 1.7 5.5 3.9-2.2 3.9-5.5 3.9c-.6 0-1.2-.05-1.7-.16L3.5 12.5l.4-2.3C3 9.5 2.5 8.4 2.5 7.2Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);
const NotesIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="3.2" y="2.5" width="9.6" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.6 5.5h4.8M5.6 8h4.8M5.6 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const AgentsIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 1.8l1.2 3.1 3.1 1.2-3.1 1.2L8 10.4 6.8 7.3 3.7 6.1l3.1-1.2L8 1.8Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M12.4 10.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
  </svg>
);

type NavItem = { href: string; label: string; desc: string; accent?: boolean };
type Group = { id: string; label: string; icon: ReactNode; items: NavItem[] };

const GROUPS: Group[] = [
  {
    id: "chat",
    label: "Chat",
    icon: ChatIcon,
    items: [
      { href: "/chat", label: "Chat", desc: "1:1 with Claude" },
      { href: "/rooms", label: "Rooms", desc: "Group chat + Claude & Claudette" },
      { href: "/renegades", label: "Renegades", desc: "Live voice & video", accent: true },
    ],
  },
  {
    id: "notes",
    label: "Notes",
    icon: NotesIcon,
    items: [
      { href: "/notes", label: "Notes", desc: "Rich-text notes" },
      { href: "/tasks", label: "Tasks", desc: "To-dos & checklists" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    icon: AgentsIcon,
    items: [{ href: "/agents", label: "Agents", desc: "Your AI automations" }],
  },
];

export function MainNav() {
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  return (
    <div ref={ref} className="flex items-center gap-1">
      {GROUPS.map((g) => {
        const open = openId === g.id;
        const active = g.items.some(
          (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
        );
        return (
          <div key={g.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : g.id)}
              aria-haspopup="menu"
              aria-expanded={open}
              className={`group flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-medium transition-all duration-150 active:scale-95 ${
                active || open
                  ? "border-violet-300 bg-violet-50 text-violet-700 shadow-[0_0_0_3px_rgba(124,58,237,0.10)] dark:border-violet-500/60 dark:bg-violet-950/50 dark:text-violet-300"
                  : "border-transparent text-zinc-700 hover:border-violet-200 hover:bg-violet-50/60 hover:text-violet-700 hover:shadow-[0_0_0_3px_rgba(124,58,237,0.07)] dark:text-zinc-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
              }`}
            >
              <span className="shrink-0 opacity-90 transition-transform duration-150 group-hover:scale-110">
                {g.icon}
              </span>
              {/* Phones (<sm): icon-only so 3 buttons + avatar fit a 375px bar.
                  sm+: the label returns. */}
              <span className="hidden sm:inline">{g.label}</span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                className={`shrink-0 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                aria-hidden
              >
                <path
                  d="M3 4.5 6 7.5 9 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {open && (
              <div
                role="menu"
                // Mobile: pin to the screen's right edge (fixed) so a left-most
                // button's menu can't shoot off the left of a 375px screen.
                // sm+: drop straight under the button (absolute).
                className="nav-pop fixed right-2 top-14 z-40 w-[calc(100vw-1rem)] max-w-xs overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-60 dark:border-zinc-800 dark:bg-zinc-950"
              >
                {g.items.map((i) => {
                  const cur = pathname === i.href;
                  return (
                    <Link
                      key={i.href}
                      href={i.href}
                      role="menuitem"
                      onClick={() => setOpenId(null)}
                      className={`block px-3 py-2.5 transition ${
                        cur
                          ? "bg-violet-50/70 dark:bg-violet-950/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <div
                        className={`text-sm font-medium ${
                          i.accent
                            ? "text-violet-600 dark:text-violet-400"
                            : "text-zinc-900 dark:text-zinc-50"
                        }`}
                      >
                        {i.label}
                      </div>
                      <div className="text-xs text-zinc-400">{i.desc}</div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
