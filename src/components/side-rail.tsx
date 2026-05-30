"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  RAIL_LABELS_EVENT,
  getRailLabelStyle,
  type RailLabelStyle,
} from "@/lib/rail-prefs";

/**
 * The Claude-style left rail (desktop only — `hidden md:flex`; phones use the
 * top dropdown nav instead). A thin, fixed icon column — NO expanding overlay
 * panel (the old hover-to-w52 slid out over the chat/notes column). Each icon
 * carries a tiny label beneath it (Walter's pick from build 4.6.7): always shown
 * for the active route, revealed on hover for the rest. The label sits INSIDE
 * the rail width (reserved, so nothing reflows) and never covers the content.
 *
 * Built to grow: add an entry to NAV and it shows up here.
 */

const ICON = "h-[18px] w-[18px]";

const Home = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <path d="M3.5 9.5 10 4l6.5 5.5M5 8.5V16h10V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Chat = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <path d="M3.5 9c0-2.6 2.7-4.6 6.5-4.6s6.5 2 6.5 4.6-2.7 4.6-6.5 4.6c-.7 0-1.4-.06-2-.2L4.5 15l.5-2.8C4 11.4 3.5 10.2 3.5 9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const Rooms = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <circle cx="7" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="13" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3.5 15c0-1.9 1.6-3 3.5-3s3.5 1.1 3.5 3M9.5 15c0-1.9 1.6-3 3.5-3s3.5 1.1 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const Notes = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <rect x="4.5" y="3" width="11" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const Tasks = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="m6.8 10 2 2 4.4-4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Agents = (
  <svg viewBox="0 0 20 20" fill="none" className={ICON} aria-hidden>
    <path d="M10 3l1.5 3.8L15.3 8l-3.8 1.5L10 13l-1.5-3.5L4.7 8l3.8-1.2L10 3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

const NAV: { href: string; label: string; icon: ReactNode; accent?: boolean }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: Chat },
  { href: "/rooms", label: "Rooms", icon: Rooms },
  { href: "/notes", label: "Notes", icon: Notes },
  { href: "/tasks", label: "Tasks", icon: Tasks },
  { href: "/agents", label: "Agents", icon: Agents },
];

export function SideRail() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // Label style preference (default "under"); updates live when changed in
  // Settings via the rail-labels event.
  const [style, setStyle] = useState<RailLabelStyle>("hover");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStyle(getRailLabelStyle());
    const onChange = (e: Event) =>
      setStyle((e as CustomEvent<RailLabelStyle>).detail === "hover" ? "hover" : "under");
    window.addEventListener(RAIL_LABELS_EVENT, onChange);
    return () => window.removeEventListener(RAIL_LABELS_EVENT, onChange);
  }, []);

  const hover = style === "hover";

  return (
    <nav className="hidden w-[52px] shrink-0 flex-col gap-1 border-r border-zinc-200 bg-white p-1.5 md:flex dark:border-zinc-800 dark:bg-zinc-950">
      {NAV.map((n) => {
        const active = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            title={n.label}
            className={`group/item relative flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 transition ${
              active
                ? "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            } ${n.accent && !active ? "text-violet-500/80 dark:text-violet-400/80" : ""}`}
          >
            <span className="grid h-[18px] w-[18px] place-items-center">{n.icon}</span>
            {hover ? (
              /* Hover-box: a small semi-transparent label beside this icon only. */
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900/90 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md backdrop-blur-sm transition-opacity duration-150 group-hover/item:opacity-100 dark:bg-zinc-100/90 dark:text-zinc-900">
                {n.label}
              </span>
            ) : (
              /* Default: tiny label under the icon, always reserved (no reflow):
                 shown for the active route, revealed on hover for the rest. */
              <span
                className={`w-full truncate text-center text-[9px] font-medium leading-none transition-opacity duration-150 ${
                  active ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
                }`}
              >
                {n.label}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
