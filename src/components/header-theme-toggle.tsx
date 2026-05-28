"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The header's light/dark toggle — only shown if the user opted in via
 * Settings → Appearance (localStorage `staticcling_theme_header`). Off by
 * default: most people set the theme once, so the bar stays uncluttered.
 *
 * Starts hidden (server + initial client render agree → no hydration mismatch),
 * then reveals after mount if the preference is set. Listens for the live event
 * the settings checkbox fires so it appears/disappears without a reload.
 */
const THEME_HEADER_KEY = "staticcling_theme_header";

export function HeaderThemeToggle() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setShow(localStorage.getItem(THEME_HEADER_KEY) === "1");
      } catch {
        setShow(false);
      }
    };
    read();
    window.addEventListener("sc-theme-header", read);
    return () => window.removeEventListener("sc-theme-header", read);
  }, []);

  if (!show) return null;
  return <ThemeToggle />;
}
