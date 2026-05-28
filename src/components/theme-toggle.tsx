"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Flips the `.dark` class on <html> and remembers the choice
 * in localStorage. The no-flash script in layout.tsx applies it before paint;
 * this just lets the user override the OS default. `dark` starts null until we
 * can read the DOM on the client (avoids an SSR/hydration mismatch on the icon).
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Client-only: read the class the no-flash script set. Must run post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const d = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("theme", d ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(d);
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle theme"
      className="rounded-md px-1.5 py-1 text-[11px] leading-none transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
    >
      {dark === null ? "" : dark ? "☀️" : "🌙"}
    </button>
  );
}
