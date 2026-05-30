"use client";

import { useEffect, useState } from "react";

/**
 * The filter box that sits at the top of a slide-out list (chat conversations,
 * notes, …). Pure presentational: the parent owns the query string and does the
 * actual filtering, so the same control reads identically everywhere. A ⌕ affix
 * and a clear (×) button when there's text.
 */
export function SidebarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mx-3 mb-2">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400"
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-md border border-zinc-200 bg-transparent py-1.5 pl-7 pr-7 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Debounced content search. `query` is the live input; `search` is a server
 * action that matches inside bodies and returns `{id, snippet}` per hit. Returns
 * a `hits` map (id → snippet) — null when the query is too short to search — so
 * the caller can union body matches with its own instant title filter and show
 * the snippet under a result. Stale results from a superseded keystroke are
 * dropped via a cancel flag.
 */
export function useContentSearch(
  query: string,
  search: (needle: string) => Promise<{ id: string; snippet: string }[]>,
) {
  const [hits, setHits] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      // Reset to "no body search" once the box is cleared/too short.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await search(needle);
        if (!cancelled) setHits(new Map(rows.map((r) => [r.id, r.snippet])));
      } catch {
        if (!cancelled) setHits(new Map());
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  return { hits };
}

/** Renders `text` with case-insensitive matches of `needle` accented in violet. */
export function Highlight({ text, needle }: { text: string; needle: string }) {
  const n = needle.trim();
  if (!n) return <>{text}</>;
  const safe = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${safe})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === n.toLowerCase() ? (
          <mark
            key={i}
            className="bg-transparent font-semibold text-violet-600 dark:text-violet-400"
          >
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}
