"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * The signed-in user's menu in the top bar — one compact button (avatar + name)
 * that opens a dropdown with Settings / Profile / Sign out. Replaces the old
 * inline "Settings · email · Sign out" cluster to save header space and keep the
 * bar uniform. Client component (needs open/close + sign-out interactivity).
 */
export function UserMenu({ name, email }: { name: string; email: string }) {
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
  const initial = (label[0] || "?").toUpperCase();

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
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-900 text-xs font-semibold text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
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
  children,
}: {
  href: string;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="block px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {children}
    </Link>
  );
}
