"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * The signed-in user's menu in the top bar — one compact button (avatar + name)
 * that opens a dropdown with Settings / Profile / Sign out. Replaces the old
 * inline "Settings · email · Sign out" cluster to save header space and keep the
 * bar uniform. Admins additionally get a Lab / Admin group here (the links used
 * to sit on the Profile page). Client component (needs open/close + sign-out).
 */
export function UserMenu({
  name,
  email,
  isAdmin = false,
}: {
  name: string;
  email: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = name?.trim() || email;
  // Two-letter initials (first + last word) for the compact avatar — "Walter
  // Lyons" → "WL". Keeps the top bar tight and leaves room for a future
  // notifications cluster up here.
  const initials =
    label
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-900 text-[11px] font-semibold text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
          {initials}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-900">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{name?.trim() || "Account"}</p>
            <p className="truncate font-mono text-xs text-zinc-400">{email}</p>
          </div>
          <Item href="/settings" onNavigate={() => setOpen(false)}>Settings</Item>
          <Item href="/profile" onNavigate={() => setOpen(false)}>Profile</Item>
          {isAdmin && (
            <div className="border-t border-zinc-100 dark:border-zinc-900">
              <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                Admin
              </p>
              <Item href="/lab" onNavigate={() => setOpen(false)} accent>The Lab</Item>
              <Item href="/admin" onNavigate={() => setOpen(false)} accent>Admin console</Item>
            </div>
          )}
          <div className="border-t border-zinc-100 dark:border-zinc-900">
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={pending}
              className="block w-full px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Item({
  href,
  onNavigate,
  accent = false,
  children,
}: {
  href: string;
  onNavigate: () => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className={`block px-3 py-2 text-sm transition ${
        accent
          ? "text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
          : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </Link>
  );
}
