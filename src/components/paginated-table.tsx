"use client";

import { useState } from "react";

/**
 * A table that pages through its rows 50 at a time (configurable). Used by the
 * Lab's "Recent activity" so the operator can walk back past the latest 50 calls
 * to page 2, 3, … instead of being capped. Pure client component — the parent
 * (a server component) formats the rows; this just slices and renders.
 */
export function PaginatedTable({
  head,
  rows,
  pageSize = 50,
  empty,
}: {
  head: string[];
  rows: (string | number)[][];
  pageSize?: number;
  empty?: string;
}) {
  const [page, setPage] = useState(0);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">{empty ?? "Nothing yet."}</p>;
  }

  const pages = Math.ceil(rows.length / pageSize);
  const clamped = Math.min(page, pages - 1);
  const start = clamped * pageSize;
  const slice = rows.slice(start, start + pageSize);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 ${i === 0 ? "" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, ri) => (
              <tr key={start + ri} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-2 ${ci === 0 ? "text-zinc-900 dark:text-zinc-50" : "text-right font-mono text-xs text-zinc-600 dark:text-zinc-300"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          <PageBtn disabled={clamped === 0} onClick={() => setPage(clamped - 1)}>
            ‹ Prev
          </PageBtn>
          {Array.from({ length: pages }, (_, i) => (
            <PageBtn key={i} active={i === clamped} onClick={() => setPage(i)}>
              {i + 1}
            </PageBtn>
          ))}
          <PageBtn disabled={clamped >= pages - 1} onClick={() => setPage(clamped + 1)}>
            Next ›
          </PageBtn>
          <span className="ml-auto font-mono text-xs text-zinc-400">
            {start + 1}–{start + slice.length} of {rows.length}
          </span>
        </div>
      )}
    </>
  );
}

function PageBtn({
  children,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-8 rounded-md border px-2.5 py-1 font-mono text-xs transition disabled:opacity-30 ${
        active
          ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}
